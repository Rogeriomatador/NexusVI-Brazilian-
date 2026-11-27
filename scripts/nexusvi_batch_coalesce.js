// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent snapshot-only logical batch processing; no external side effects.
const assert=require('node:assert/strict');
const MAX_KEY=255;
function validate(op){
  assert(op&&typeof op==='object');
  if(op.kind==='barrier'){assert.deepEqual(Object.keys(op),['kind']);return;}
  assert(Number.isInteger(op.key)&&op.key>=0&&op.key<=MAX_KEY);
  if(op.kind==='set'){
    assert.deepEqual(Object.keys(op).sort(),['key','kind','value']);
    assert(Number.isSafeInteger(op.value)&&op.value>=0&&op.value<=65535);
  }else{assert.equal(op.kind,'delete');assert.deepEqual(Object.keys(op).sort(),['key','kind']);}
}
class Batch {
  constructor(limit,skip){
    assert(Number.isInteger(limit)&&limit>=1&&limit<=256);
    this.limit=limit;this.skip=skip;this.state=new Map();this.pending=new Map();
    this.queued=0;this.writes=0;this.reads=0;this.flushes=0;this.peak=0;
  }
  push(op){
    validate(op);
    if(op.kind==='barrier'){this.flush();return;}
    this.pending.set(op.key,op.kind==='set'?op.value:null);this.queued++;
    this.peak=Math.max(this.peak,this.pending.size);
    if(this.queued===this.limit)this.flush();
  }
  flush(){
    if(!this.queued)return;
    for(const [key,value] of this.pending){
      if(this.skip){
        const current=this.state.get(key);this.reads++;
        if(value===null?current===undefined:current===value)continue;
      }
      if(value===null)this.state.delete(key);else this.state.set(key,value);
      this.writes++;
    }
    this.pending.clear();this.queued=0;this.flushes++;
  }
}
function snapshot(m){return [...m].sort((a,b)=>a[0]-b[0]);}
function replay(ops,limit){
  const raw=new Array(MAX_KEY+1).fill(null),eager=new Map();
  const a=new Batch(limit,false),b=new Batch(limit,true);
  let updates=0,barriers=0,checks=0;
  function verify(){
    const expected=raw.flatMap((v,k)=>v===null?[]:[[k,v]]);
    assert.deepEqual(snapshot(eager),expected);
    assert.deepEqual(snapshot(a.state),expected);assert.deepEqual(snapshot(b.state),expected);
    assert.equal(a.queued,0);assert.equal(b.queued,0);checks++;
  }
  for(const op of ops){
    validate(op);
    if(op.kind==='barrier')barriers++;
    else{
      updates++;raw[op.key]=op.kind==='set'?op.value:null;
      if(op.kind==='set')eager.set(op.key,op.value);else eager.delete(op.key);
    }
    a.push(op);b.push(op);
    assert(a.pending.size<=limit&&b.pending.size<=limit);
    assert.equal(a.queued,b.queued);
    if(a.queued===0)verify();
  }
  a.flush();b.flush();verify();
  assert(b.writes<=a.writes&&a.writes<=updates);assert.equal(b.reads,a.writes);
  return {updates,barriers,checks,eagerWrites:updates,coalescedWrites:a.writes,
    filteredWrites:b.writes,filterReads:b.reads,flushes:a.flushes,peakPending:a.peak};
}
function trace(profile,seed){
  let x=seed>>>0;function next(){x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
  const ops=[];
  for(let i=0;i<4096;i++){
    const r=next(),key=profile==='uniform'?r%256:profile==='hot'?r%8:Math.floor(i/16)%64;
    const value=profile==='repeated'?Math.floor(i/64)%4:next()%256;
    ops.push(r%5===0?{kind:'delete',key}:{kind:'set',key,value});
    if((i+1)%128===0)ops.push({kind:'barrier'});
  }
  return ops;
}
function tests(){
  const set=(key,value)=>({kind:'set',key,value}),del=key=>({kind:'delete',key}),bar={kind:'barrier'};
  let r=replay([set(1,1),set(1,2),del(1)],16);
  assert.equal(r.coalescedWrites,1);assert.equal(r.filteredWrites,0);
  r=replay([set(1,0),bar,set(1,0),bar,del(1),del(1)],16);
  assert.equal(r.coalescedWrites,3);assert.equal(r.filteredWrites,2);
  r=replay([set(0,1),set(0,2),set(0,3)],1);assert.equal(r.filteredWrites,3);
  r=replay([bar,bar],4);assert.equal(r.flushes,0);
  const c=new Batch(4,true);c.push(set(0,0));let rejected=false;
  try{c.push(set(256,1));}catch{rejected=true;}assert(rejected);assert.equal(c.queued,1);
  assert.deepEqual(trace('hot',42),trace('hot',42));assert.notDeepEqual(trace('hot',42),trace('hot',43));
  const alphabet=[set(0,0),set(0,1),del(0),set(1,0),del(1),bar];let histories=0;
  for(const limit of [1,3])for(let n=0;n<7776;n++){
    let x=n;const ops=[];for(let i=0;i<5;i++){ops.push(alphabet[x%6]);x=Math.floor(x/6);}
    replay(ops,limit);histories++;
  }
  return {crafted:6,exhaustive_histories:histories};
}
function experiment(){
  const results=[];
  for(const profile of ['uniform','hot','repeated'])for(const seed of [271828,314159])for(const limit of [16,64]){
    results.push({profile,seed,limit,...replay(trace(profile,seed),limit)});
  }
  return {scope:'independent_snapshot_batch_coalescing_only',tests:tests(),results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={Batch,replay,trace,tests,experiment};
