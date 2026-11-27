// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical model: deterministic traces, no real memory mapping.
const assert = require('node:assert/strict');
const CAP = 8192, STEPS = 2000;
const POLICIES = ['first','best','hybrid2','hybrid4','hybrid8','hybrid16'];
const LIMITS = new Map([['first',1],['best',Infinity],['hybrid2',2],['hybrid4',4],['hybrid8',8],['hybrid16',16]]);
function rng(seed) { let x=seed>>>0; return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}; }
function trace(seed,profile,steps=STEPS) {
  const next=rng(seed), requests=[];
  for(let id=0;id<steps;id++) {
    const x=next(), y=next(), z=next();
    const len=profile==='mixed'?(x%5===0?256+x%769:8+x%121):profile==='small'?8+x%121:64+x%449;
    const life=profile==='mixed'?(x%5===0?80+z%241:3+z%32):profile==='small'?12+z%100:8+z%48;
    requests.push({id,len,align:2**(y%7),end:id+life});
  }
  return requests;
}
class Arena {
  constructor(cap,policy){assert(LIMITS.has(policy));this.cap=cap;this.policy=policy;this.free=[[0,cap]];this.live=new Map();this.probes=0;}
  allocate(id,len,align){
    assert(!this.live.has(id));
    let choice=-1,offset=0,best=Infinity,eligible=0;
    for(let i=0;i<this.free.length;i++){
      this.probes++;
      const [s,e]=this.free[i],p=Math.ceil(s/align)*align;
      if(p+len>e)continue;
      if(this.policy==='first'){choice=i;offset=p;break;}
      // Best-fit minimizes total leftover bytes (both alignment prefix and suffix).
      const waste=e-s-len;
      if(waste<best){choice=i;offset=p;best=waste;}
      if(++eligible===LIMITS.get(this.policy))break;
    }
    if(choice<0)return false;
    const [s,e]=this.free[choice],parts=[];
    if(s<offset)parts.push([s,offset]);
    if(offset+len<e)parts.push([offset+len,e]);
    this.free.splice(choice,1,...parts);this.live.set(id,[offset,offset+len]);return true;
  }
  release(id){
    const r=this.live.get(id);if(!r)return false;
    this.live.delete(id);this.free.push(r);this.free.sort((a,b)=>a[0]-b[0]);
    const merged=[];for(const [s,e] of this.free){const last=merged.at(-1);if(last&&last[1]===s)last[1]=e;else merged.push([s,e]);}
    this.free=merged;return true;
  }
  measure(){let total=0,largest=0;for(const [s,e] of this.free){total+=e-s;largest=Math.max(largest,e-s);}return {total,largest};}
  check(){
    const ranges=[...this.free,...this.live.values()].sort((a,b)=>a[0]-b[0]);let cursor=0;
    for(const [s,e] of ranges){assert.equal(s,cursor);assert(e>s);cursor=e;}assert.equal(cursor,this.cap);
    for(let i=1;i<this.free.length;i++)assert(this.free[i-1][1]<this.free[i][0]);
  }
}
// Independent byte-occupancy oracle: reconstruct maximal free runs, evaluate fit.
function oracle(bits,len,align,policy){
  const candidates=[];
  for(let s=0;s<bits.length;){if(bits[s]){s++;continue;}let e=s+1;while(e<bits.length&&!bits[e])e++;
    const p=Math.ceil(s/align)*align;
    if(p+len<=e){candidates.push({offset:p,waste:e-s-len});if(policy==='first')return p;if(candidates.length===LIMITS.get(policy))break;}s=e;}
  candidates.sort((a,b)=>a.waste-b.waste||a.offset-b.offset);
  return candidates.length?candidates[0].offset:-1;
}
function replay(requests,policy,cap=CAP){
  const a=new Arena(cap,policy),bits=new Uint8Array(cap),expirations=new Map();
  let accepted=0,failed=0,fragmented=0,alignmentOnly=0,insufficient=0,fragSum=0,peak=0,acceptedBytes=0;
  function release(id){const [s,e]=a.live.get(id);assert(bits.subarray(s,e).every(x=>x===1));bits.fill(0,s,e);assert(a.release(id));}
  for(const r of requests){
    for(const id of expirations.get(r.id)||[])release(id);expirations.delete(r.id);
    const before=a.measure(),expected=oracle(bits,r.len,r.align,policy);
    const ok=a.allocate(r.id,r.len,r.align);assert.equal(ok,expected>=0);
    if(ok){const [s,e]=a.live.get(r.id);assert.equal(s,expected);assert.equal(s%r.align,0);assert(bits.subarray(s,e).every(x=>x===0));bits.fill(1,s,e);
      accepted++;acceptedBytes+=r.len;if(!expirations.has(r.end))expirations.set(r.end,[]);expirations.get(r.end).push(r.id);
    }else{failed++;if(before.total<r.len)insufficient++;else if(before.largest<r.len)fragmented++;else alignmentOnly++;}
    a.check();const m=a.measure();let freeCount=0;for(let i=0;i<bits.length;i++)if(bits[i]===0)freeCount++;assert.equal(m.total,freeCount);
    fragSum+=m.total?1-m.largest/m.total:0;peak=Math.max(peak,cap-m.total);
  }
  for(const id of [...a.live.keys()])release(id);a.check();assert.deepEqual(a.free,[[0,cap]]);assert(bits.every(x=>x===0));
  assert.equal(accepted+failed,requests.length);assert.equal(fragmented+alignmentOnly+insufficient,failed);
  return {policy,requests:requests.length,accepted,failed,fragmented,alignmentOnly,insufficient,acceptedBytes,meanFragmentation:fragSum/requests.length,peakLiveBytes:peak,rangeProbes:a.probes,reclaimedBytes:cap};
}
function tests(){
  for(const policy of ['first','best','hybrid4']){
    const a=new Arena(64,policy);assert(a.allocate(0,3,1));assert(a.allocate(1,8,16));assert.deepEqual(a.live.get(1),[16,24]);assert(a.release(0));assert(a.release(1));assert.deepEqual(a.free,[[0,64]]);assert(!a.release(1));
    assert(a.allocate(2,64,1));const before=JSON.stringify(a.free);assert(!a.allocate(3,1,1));assert.equal(JSON.stringify(a.free),before);assert(a.release(2));a.check();
  }
  // Fit choice must differ on this known free-range layout.
  for(const policy of ['first','best','hybrid4']){const a=new Arena(64,policy);for(const [i,n] of [20,4,12,28].entries())assert(a.allocate(i,n,1));a.release(0);a.release(2);assert(a.allocate(4,10,1));assert.equal(a.live.get(4)[0],policy==='first'?0:24);a.check();}
  // Five fitting gaps: hybrid4 must ignore the fifth, even if it is exact.
  for(const policy of ['first','best','hybrid4']){
    const a=new Arena(100,policy);
    for(const [i,n] of [16,1,14,1,12,1,10,1,8,36].entries())assert(a.allocate(i,n,1));
    for(const id of [0,2,4,6,8])assert(a.release(id));
    assert(a.allocate(10,8,1));assert.equal(a.live.get(10)[0],{first:0,best:56,hybrid4:45}[policy]);a.check();
  }
  // The first four examined ranges are not necessarily eligible.
  for(const policy of ['first','best','hybrid4']){
    const a=new Arena(64,policy);
    for(const [i,n] of [1,1,1,1,1,1,1,1,16,40].entries())assert(a.allocate(i,n,1));
    for(const id of [0,2,4,6,8])assert(a.release(id));
    assert(a.allocate(10,8,1));assert.equal(a.live.get(10)[0],8);a.check();
  }
  // 17 eligible gaps, descending sizes, with the exact fit last.
  for(const policy of POLICIES){
    const sizes=Array.from({length:17},(_,i)=>24-i),cap=sizes.reduce((s,n)=>s+n+1,0);
    const a=new Arena(cap,policy), starts=[];let cursor=0;
    for(let i=0;i<sizes.length;i++){starts.push(cursor);assert(a.allocate(i*2,sizes[i],1));assert(a.allocate(i*2+1,1,1));cursor+=sizes[i]+1;}
    for(let i=0;i<sizes.length;i++)assert(a.release(i*2));
    assert(a.allocate(100,8,1));assert.equal(a.live.get(100)[0],starts[Math.min(17,LIMITS.get(policy))-1]);a.check();
  }
  assert.deepEqual(trace(42,'mixed'),trace(42,'mixed'));
  assert.notDeepEqual(trace(42,'mixed'),trace(43,'mixed'));
}
function holdout(){
  const results=[];
  for(const capacity of [4096,8192])for(const profile of ['small','mixed','large'])for(const seed of [271828,314159]){
    const requests=trace(seed,profile,800);
    results.push({capacity,profile,seed,results:POLICIES.map(p=>replay(requests,p,capacity))});
  }
  return {scope:'independent_logical_arena_holdout_only',stepsPerTrace:800,results};
}
function main(){tests();if(process.argv.length===3&&process.argv[2]==='--holdout'){console.log(JSON.stringify(holdout(),null,2));return;}assert.equal(process.argv.length,2);const results=[];for(const profile of ['small','mixed','large'])for(const seed of [42,1337,20261127]){const requests=trace(seed,profile);results.push({profile,seed,results:['first','best','hybrid4'].map(p=>replay(requests,p))});}console.log(JSON.stringify({scope:'independent_logical_arena_only',capacityBytes:CAP,stepsPerTrace:STEPS,results},null,2));}
if(require.main===module)main();
module.exports={Arena,trace,replay,tests,holdout};
