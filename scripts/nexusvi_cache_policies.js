// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent bounded logical key cache, no external assets or runtime.
const assert=require('node:assert/strict');
const POLICIES=['fifo','lru','slru'];
class Cache {
  constructor(cap,policy){
    assert(Number.isInteger(cap)&&cap>=2&&cap<=4096&&POLICIES.includes(policy));
    this.cap=cap;this.policy=policy;this.limit=Math.floor(cap/2);
    this.probation=new Map();this.protected=new Map();
  }
  access(k){
    assert(Number.isSafeInteger(k)&&k>=0);
    const p=this.probation,q=this.protected;
    if(q.has(k)){q.delete(k);q.set(k,true);return {hit:true,evicted:null};}
    if(p.has(k)){
      if(this.policy==='lru'){p.delete(k);p.set(k,true);}
      else if(this.policy==='slru'){
        p.delete(k);q.set(k,true);
        if(q.size>this.limit){const old=q.keys().next().value;q.delete(old);p.set(old,true);}
      }
      return {hit:true,evicted:null};
    }
    let evicted=null;
    if(p.size+q.size===this.cap){assert(p.size>0);evicted=p.keys().next().value;p.delete(evicted);}
    p.set(k,true);return {hit:false,evicted};
  }
  snapshot(){return {probation:[...this.probation.keys()],protected:[...this.protected.keys()]};}
}
// Independent array oracle, oldest to newest. No Map implementation shared.
function reference(cap,policy,state,k){
  const p=state.probation,q=state.protected;
  let j=q.indexOf(k);
  if(j>=0){q.push(q.splice(j,1)[0]);return {hit:true,evicted:null};}
  j=p.indexOf(k);
  if(j>=0){
    if(policy==='lru')p.push(p.splice(j,1)[0]);
    else if(policy==='slru'){q.push(p.splice(j,1)[0]);if(q.length>Math.floor(cap/2))p.push(q.shift());}
    return {hit:true,evicted:null};
  }
  const evicted=p.length+q.length===cap?p.shift():null;p.push(k);
  return {hit:false,evicted};
}
function replay(cap,policy,keys){
  const c=new Cache(cap,policy),state={probation:[],protected:[]};let hits=0,evictions=0;
  for(const k of keys){
    const want=reference(cap,policy,state,k),got=c.access(k);
    assert.deepEqual(got,want);assert.deepEqual(c.snapshot(),state);
    const all=[...state.probation,...state.protected];
    assert(all.length<=cap&&new Set(all).size===all.length);
    assert(state.protected.length<=Math.floor(cap/2));
    if(got.hit)hits++;if(got.evicted!==null)evictions++;
  }
  return {requests:keys.length,hits,misses:keys.length-hits,evictions,hit_rate:hits/keys.length};
}
function trace(cap,profile,seed,steps=6000){
  assert(Number.isInteger(seed)&&seed>0&&seed<=0xffffffff);
  let x=seed>>>0;function next(){x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
  const hot=Math.max(1,Math.floor(cap/4)),keys=[];
  for(let i=0;i<steps;i++){
    const r=next();
    if(profile==='uniform')keys.push(r%(cap*4));
    else if(profile==='hot_scan'){
      const phase=i%256;keys.push(phase<128?r%hot:cap*8+i);
    }else if(profile==='phase_shift'){
      const base=Math.floor(i/500)%4*cap*4;keys.push(base+(r%10<8?next()%hot:hot+next()%(cap*3)));
    }else if(profile==='cyclic')keys.push(i%(cap+1));
    else throw Error('unknown profile');
  }
  return keys;
}
function tests(){
  const f=new Cache(2,'fifo');f.access(0);f.access(1);f.access(0);assert.equal(f.access(2).evicted,0);
  const l=new Cache(2,'lru');l.access(0);l.access(1);l.access(0);assert.equal(l.access(2).evicted,1);
  const s=new Cache(4,'slru');for(const k of [0,1,2,3,0,1,2])s.access(k);
  assert.deepEqual(s.snapshot(),{probation:[3,0],protected:[1,2]});assert.equal(s.access(4).evicted,3);
  for(const p of POLICIES){const r=replay(3,p,[0,1,2,0,3,1,0,4]);assert.equal(r.requests,8);assert.equal(r.hits+r.misses,8);}
  assert.deepEqual(trace(32,'hot_scan',42,500),trace(32,'hot_scan',42,500));
  assert.notDeepEqual(trace(32,'uniform',42,500),trace(32,'uniform',43,500));
  // Exhaust every length-six sequence over four keys at capacities 2 and 3.
  let histories=0;
  for(const cap of [2,3])for(let n=0;n<4096;n++){
    let x=n;const seq=[];for(let j=0;j<6;j++){seq.push(x%4);x=Math.floor(x/4);}
    for(const p of POLICIES){replay(cap,p,seq);histories++;}
  }
  return {crafted:6,exhaustive_histories:histories};
}
function experiment(){
  const tests_result=tests(),results=[];
  for(const cap of [32,128])for(const profile of ['uniform','hot_scan','phase_shift','cyclic'])for(const seed of [104729,130363]){
    const keys=trace(cap,profile,seed);
    results.push({cap,profile,seed,policies:Object.fromEntries(POLICIES.map(p=>[p,replay(cap,p,keys)]))});
  }
  return {scope:'independent_logical_key_cache_only',tests:tests_result,results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={Cache,replay,trace,tests,experiment};
