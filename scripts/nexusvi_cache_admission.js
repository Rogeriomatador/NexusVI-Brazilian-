// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical byte cache: bounded second-touch admission.
const assert=require('node:assert/strict');
const {WeightedCache,replay:fixed,workload}=require('./nexusvi_cache_weighted.js');
class AdmissionCache {
  constructor(cap,limit){
    assert(Number.isSafeInteger(limit)&&limit>=1&&limit<=4096);
    this.cache=new WeightedCache(cap,'lru');this.limit=limit;
    this.history=new Map();this.peakHistory=0;
  }
  access(key,size){
    assert(Number.isSafeInteger(key)&&key>=0&&Number.isSafeInteger(size)&&size>0&&size<=2097152);
    const c=this.cache;
    if(c.entries.has(key)||size>c.cap)return {...c.access(key,size),filtered:false};
    if(this.history.has(key)){
      this.history.delete(key);return {...c.access(key,size),filtered:false};
    }
    this.history.set(key,true);
    if(this.history.size>this.limit)this.history.delete(this.history.keys().next().value);
    this.peakHistory=Math.max(this.peakHistory,this.history.size);
    return {hit:false,bypass:false,filtered:true,evicted:[]};
  }
}
function reference(cap,limit,s,key,size,time){
  const resident=s.entries.find(x=>x.key===key);
  if(resident){assert.equal(resident.size,size);resident.time=time;return {hit:true,bypass:false,filtered:false,evicted:[]};}
  if(size>cap)return {hit:false,bypass:true,filtered:false,evicted:[]};
  const i=s.history.indexOf(key);
  if(i<0){
    s.history.push(key);if(s.history.length>limit)s.history.shift();
    return {hit:false,bypass:false,filtered:true,evicted:[]};
  }
  s.history.splice(i,1);const evicted=[];
  while(s.entries.reduce((n,x)=>n+x.size,0)+size>cap){
    const v=s.entries.reduce((a,b)=>a.time<b.time?a:b);
    s.entries.splice(s.entries.indexOf(v),1);evicted.push(v.key);
  }
  s.entries.push({key,size,time});return {hit:false,bypass:false,filtered:false,evicted};
}
function replay(cap,limit,requests){
  const c=new AdmissionCache(cap,limit),s={entries:[],history:[]};
  let hits=0,hitBytes=0,requestedBytes=0,evictions=0,bypasses=0,filtered=0;
  for(let i=0;i<requests.length;i++){
    const {key,size}=requests[i],want=reference(cap,limit,s,key,size,i),got=c.access(key,size);
    assert.deepEqual(got,want);
    assert.deepEqual([...c.cache.entries],s.entries.slice().sort((a,b)=>a.time-b.time).map(x=>[x.key,x.size]));
    assert.deepEqual([...c.history.keys()],s.history);
    assert.equal(c.cache.used,s.entries.reduce((n,x)=>n+x.size,0));
    const keys=[...c.cache.entries.keys(),...c.history.keys()];
    assert(c.cache.used>=0&&c.cache.used<=cap&&c.history.size<=limit&&new Set(keys).size===keys.length);
    requestedBytes+=size;if(got.hit){hits++;hitBytes+=size;}
    evictions+=got.evicted.length;if(got.bypass)bypasses++;if(got.filtered)filtered++;
  }
  return {requests:requests.length,hits,requestedBytes,hitBytes,evictions,bypasses,filtered,
    peakLogicalBytes:c.cache.peak,victimInspections:c.cache.inspections,peakHistory:c.peakHistory,historyLimit:limit};
}
function tests(){
  const c=new AdmissionCache(4,2);
  assert(c.access(0,4).filtered);assert(!c.access(0,4).filtered);assert(c.access(0,4).hit);
  assert(c.access(1,4).filtered);assert.equal(c.cache.used,4);assert(c.access(0,4).hit);
  assert.deepEqual(c.access(1,4).evicted,[0]);assert(c.access(0,4).filtered);
  const d=new AdmissionCache(4,1);d.access(1,1);d.access(2,1);assert(d.access(1,1).filtered);
  const before=[...d.history];assert(d.access(3,5).bypass);assert.deepEqual([...d.history],before);
  let rejected=false;try{d.access(4,0);}catch{rejected=true;}assert(rejected);
  let histories=0;
  for(const cap of [5,7])for(const limit of [1,3])for(let n=0;n<4096;n++){
    let x=n;const seq=[];for(let j=0;j<6;j++){const key=x%4;x=Math.floor(x/4);seq.push({key,size:[1,2,3,8][key]});}
    replay(cap,limit,seq);histories++;
  }
  return {crafted:6,exhaustive_histories:histories};
}
function experiment(){
  const test=tests(),results=[];
  for(const cap of [4096,16384])for(const profile of ['uniform','hot_scan','small_hot','phase_shift'])for(const seed of [271828,314159,104729]){
    const req=workload(cap,profile,seed);
    results.push({cap,profile,seed,group:seed===104729?'additional':'prior',policies:{lru:fixed(cap,'lru',req),
      second:replay(cap,cap/128,req),second4:replay(cap,cap/32,req)}});
  }
  return {scope:'independent_weighted_cache_admission_only',tests:test,results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={AdmissionCache,replay,tests,experiment};
