// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical byte-budget cache; immutable object sizes in each trace.
const assert=require('node:assert/strict');
const {trace}=require('./nexusvi_cache_policies.js');
const POLICIES=['fifo','lru','largest4'];
class WeightedCache {
  constructor(cap,policy){
    assert(Number.isSafeInteger(cap)&&cap>0&&cap<=1048576&&POLICIES.includes(policy));
    this.cap=cap;this.policy=policy;this.used=0;this.peak=0;this.inspections=0;this.entries=new Map();
  }
  access(key,size){
    assert(Number.isSafeInteger(key)&&key>=0&&Number.isSafeInteger(size)&&size>0&&size<=2097152);
    const old=this.entries.get(key);
    if(old!==undefined){
      assert.equal(size,old,'resident size changed');
      if(this.policy!=='fifo'){this.entries.delete(key);this.entries.set(key,size);}
      return {hit:true,bypass:false,evicted:[]};
    }
    if(size>this.cap)return {hit:false,bypass:true,evicted:[]};
    const evicted=[];
    while(this.used+size>this.cap){
      let victim=null,largest=0,n=0;
      for(const [k,bytes] of this.entries){
        this.inspections++;if(bytes>largest){victim=k;largest=bytes;}
        if(++n===(this.policy==='largest4'?4:1))break;
      }
      assert(victim!==null);this.entries.delete(victim);this.used-=largest;evicted.push(victim);
    }
    this.entries.set(key,size);this.used+=size;this.peak=Math.max(this.peak,this.used);
    return {hit:false,bypass:false,evicted};
  }
}
// Independent timestamp model: sort residents by admission/access time.
function reference(cap,policy,state,key,size,time){
  const found=state.find(x=>x.key===key);
  if(found){
    assert.equal(found.size,size);if(policy!=='fifo')found.time=time;
    return {hit:true,bypass:false,evicted:[]};
  }
  if(size>cap)return {hit:false,bypass:true,evicted:[]};
  const evicted=[];
  while(state.reduce((sum,x)=>sum+x.size,0)+size>cap){
    const ordered=state.slice().sort((a,b)=>a.time-b.time);
    const eligible=ordered.slice(0,policy==='largest4'?4:1);
    eligible.sort((a,b)=>b.size-a.size||a.time-b.time);
    const victim=eligible[0];evicted.push(victim.key);state.splice(state.indexOf(victim),1);
  }
  state.push({key,size,time});return {hit:false,bypass:false,evicted};
}
function replay(cap,policy,requests){
  const c=new WeightedCache(cap,policy),s=[];
  let hits=0,hitBytes=0,requestedBytes=0,evictions=0,bypasses=0;
  for(let i=0;i<requests.length;i++){
    const {key,size}=requests[i],want=reference(cap,policy,s,key,size,i),got=c.access(key,size);
    assert.deepEqual(got,want);
    const order=s.slice().sort((a,b)=>a.time-b.time).map(x=>[x.key,x.size]);
    assert.deepEqual([...c.entries],order);
    assert.equal(c.used,s.reduce((sum,x)=>sum+x.size,0));
    assert(c.used<=cap&&c.used>=0&&new Set(s.map(x=>x.key)).size===s.length);
    requestedBytes+=size;if(got.hit){hits++;hitBytes+=size;}
    evictions+=got.evicted.length;if(got.bypass)bypasses++;
  }
  return {requests:requests.length,hits,requestedBytes,hitBytes,evictions,bypasses,
    peakLogicalBytes:c.peak,victimInspections:c.inspections};
}
function objectSize(key,cap,profile){
  // Stable unsigned integer mixing; no random size changes for a repeated key.
  const h=Math.imul(key+1,0x9e3779b1)>>>0;
  if(key%47===0)return cap+1;
  if(profile==='small_hot'&&key<cap/128/4)return 32;
  const sizes=[32,64,128,256,512,1024];
  return sizes[h%6];
}
function workload(cap,profile,seed){
  const slots=cap/128,pattern=profile==='small_hot'?'hot_scan':profile;
  return trace(slots,pattern,seed,4000).map(key=>({key,size:objectSize(key,cap,profile)}));
}
function tests(){
  const c=new WeightedCache(10,'lru');
  c.access(0,3);c.access(1,3);c.access(2,4);c.access(0,3);
  assert.deepEqual(c.access(3,7).evicted,[1,2]);
  const d=new WeightedCache(10,'largest4');
  d.access(0,2);d.access(1,6);d.access(2,2);
  assert.deepEqual(d.access(3,6).evicted,[1]);
  const before=[...d.entries];assert(d.access(4,11).bypass);assert.deepEqual([...d.entries],before);
  let rejected=false;try{d.access(0,3);}catch{rejected=true;}assert(rejected);assert.deepEqual([...d.entries],before);
  const f=new WeightedCache(4,'largest4');f.access(0,2);f.access(1,2);assert.deepEqual(f.access(2,2).evicted,[0]);
  const x=workload(4096,'small_hot',42);assert.deepEqual(x,workload(4096,'small_hot',42));assert.notDeepEqual(x,workload(4096,'small_hot',43));
  let histories=0;
  for(const cap of [5,7])for(let n=0;n<4096;n++){
    let k=n;const seq=[];for(let j=0;j<6;j++){const key=k%4;k=Math.floor(k/4);seq.push({key,size:[1,2,3,8][key]});}
    for(const p of POLICIES){replay(cap,p,seq);histories++;}
  }
  return {crafted:6,exhaustive_histories:histories};
}
function experiment(){
  const test=tests(),results=[];
  for(const cap of [4096,16384])for(const profile of ['uniform','hot_scan','small_hot','phase_shift'])for(const seed of [271828,314159]){
    const req=workload(cap,profile,seed);
    results.push({cap,profile,seed,policies:Object.fromEntries(POLICIES.map(p=>[p,replay(cap,p,req)]))});
  }
  return {scope:'independent_weighted_logical_cache_only',tests:test,results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={WeightedCache,replay,workload,tests,experiment,reference};
