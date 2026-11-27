// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent snapshot-only adaptive batch model.
const assert=require('node:assert/strict');
const {Batch,replay,trace}=require('./nexusvi_batch_coalesce.js');
class AdaptiveBatch extends Batch {
  constructor(){super(16,true);this.changes=0;this.lag=0;this.maxQueued=0;}
  flush(){
    const n=this.queued,u=this.pending.size,full=n===this.limit;
    if(n){this.lag+=n*(n-1)/2;this.maxQueued=Math.max(this.maxQueued,n);}
    super.flush();
    if(!full)return;
    const next=2*(n-u)>=n?Math.min(64,this.limit*2):
      8*(n-u)<=n?Math.max(16,this.limit/2):this.limit;
    if(next!==this.limit)this.changes++;
    this.limit=next;
  }
}
function checked(ops){
  const c=new AdaptiveBatch(),raw=Array(256).fill(null);
  let updates=0,checks=0,target=16,queued=0,pending=new Set(),lag=0,maxQueued=0;
  function verify(){assert.deepEqual([...c.state].sort((a,b)=>a[0]-b[0]),raw.flatMap((v,k)=>v===null?[]:[[k,v]]));checks++;}
  for(const op of ops){
    if(op.kind!=='barrier'){
      raw[op.key]=op.kind==='set'?op.value:null;updates++;queued++;pending.add(op.key);
    }
    const full=queued===target,flush=full||op.kind==='barrier';
    c.push(op);
    if(flush){
      lag+=queued*(queued-1)/2;maxQueued=Math.max(maxQueued,queued);
      if(full){
        const duplicates=queued-pending.size;
        if(duplicates>=queued/2)target=Math.min(64,target*2);
        else if(duplicates<=queued/8)target=Math.max(16,target/2);
      }
      queued=0;pending.clear();
    }
    assert.equal(c.limit,target);assert.equal(c.queued,queued);assert.equal(c.pending.size,pending.size);
    assert(c.queued<c.limit&&c.limit>=16&&c.limit<=64);
    if(!queued)verify();
  }
  lag+=queued*(queued-1)/2;maxQueued=Math.max(maxQueued,queued);
  c.flush();assert.equal(c.limit,target);assert.equal(c.queued,0);verify();
  assert.equal(c.lag,lag);assert.equal(c.maxQueued,maxQueued);
  assert(c.writes<=c.reads&&c.reads<=updates);
  return {updates,writes:c.writes,reads:c.reads,flushes:c.flushes,checks,changes:c.changes,peakPending:c.peak,maxQueued,lagUpdates:lag};
}
function fixed(ops,limit){
  const v=replay(ops,limit);
  let n=0,lag=0,maxQueued=0;
  function flush(){lag+=n*(n-1)/2;maxQueued=Math.max(maxQueued,n);n=0;}
  for(const op of ops){if(op.kind==='barrier')flush();else if(++n===limit)flush();}
  flush();
  return {updates:v.updates,writes:v.filteredWrites,reads:v.filterReads,flushes:v.flushes,checks:v.checks,peakPending:v.peakPending,maxQueued,lagUpdates:lag};
}
function mixed(seed){
  const t=['uniform','hot','repeated'].map(p=>trace(p,seed)),out=[];
  for(let i=0;i<32;i++)out.push(...t[Math.floor(i/4)%3].slice(i*129,(i+1)*129));
  return out;
}
function tests(){
  const set=(key,value)=>({kind:'set',key,value}),bar={kind:'barrier'};
  const c=new AdaptiveBatch();
  for(let i=0;i<16;i++)c.push(set(0,i));assert.equal(c.limit,32);
  for(let i=0;i<32;i++)c.push(set(0,i));assert.equal(c.limit,64);
  for(let i=0;i<64;i++)c.push(set(i,i));assert.equal(c.limit,32);
  for(let i=0;i<32;i++)c.push(set(i,i));assert.equal(c.limit,16);
  for(let i=0;i<8;i++)c.push(set(0,i));c.push(bar);assert.equal(c.limit,16);
  assert.equal(c.maxQueued,64);assert.equal(c.changes,4);
  const r=checked([set(0,0),set(0,1),bar,set(0,1)]);
  assert.equal(r.writes,1);assert.equal(r.lagUpdates,1);
  assert.equal(checked([bar,bar]).flushes,0);
  assert.equal(mixed(42).filter(x=>x.kind==='barrier').length,32);
  const alphabet=[set(0,0),set(0,1),{kind:'delete',key:0},set(1,0),bar];
  let histories=0;
  for(let i=0;i<3125;i++){
    let n=i;const ops=[];for(let j=0;j<5;j++){ops.push(alphabet[n%5]);n=Math.floor(n/5);}
    checked(ops);histories++;
  }
  return {crafted:9,exhaustive_histories:histories};
}
function experiment(){
  const results=[];
  for(const profile of ['uniform','hot','repeated','mixed'])for(const seed of [271828,314159,104729]){
    const ops=profile==='mixed'?mixed(seed):trace(profile,seed);
    results.push({profile,seed,policies:{fixed16:fixed(ops,16),fixed64:fixed(ops,64),adaptive:checked(ops)}});
  }
  return {scope:'independent_adaptive_snapshot_batch_only',tests:tests(),results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={AdaptiveBatch,checked,mixed,tests,experiment};
