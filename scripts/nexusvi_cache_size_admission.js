// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent size-sensitive admission for immutable logical objects.
const assert=require('node:assert/strict');
const {WeightedCache,replay:fixed,workload}=require('./nexusvi_cache_weighted.js');
const {replay:second}=require('./nexusvi_cache_admission.js');
class SizeAdmission {
  constructor(cap,limit){
    assert(Number.isInteger(limit)&&limit>=1&&limit<=4096);
    this.cache=new WeightedCache(cap,'lru');this.limit=limit;
    this.history=new Map();this.peakHistory=0;
  }
  access(key,size){
    assert(Number.isSafeInteger(key)&&key>=0&&Number.isSafeInteger(size)&&size>0&&size<=2097152);
    const c=this.cache;
    if(c.entries.has(key)||size>c.cap)return {...c.access(key,size),filtered:false};
    const required=size<=64?1:size<=256?2:3;
    const count=(this.history.get(key)||0)+1;
    this.history.delete(key);
    if(count>=required)return {...c.access(key,size),filtered:false};
    this.history.set(key,count);
    if(this.history.size>this.limit)this.history.delete(this.history.keys().next().value);
    this.peakHistory=Math.max(this.peakHistory,this.history.size);
    return {hit:false,bypass:false,filtered:true,evicted:[]};
  }
}
function reference(cap,limit,s,key,size,time){
  const resident=s.entries.find(x=>x.key===key);
  if(resident){assert.equal(resident.size,size);resident.time=time;return {hit:true,bypass:false,filtered:false,evicted:[]};}
  if(size>cap)return {hit:false,bypass:true,filtered:false,evicted:[]};
  const index=s.history.findIndex(x=>x[0]===key);
  let count=1;if(index>=0)count+=s.history.splice(index,1)[0][1];
  if((size>256&&count<3)||(size>64&&count<2)){
    s.history.push([key,count]);if(s.history.length>limit)s.history.shift();
    return {hit:false,bypass:false,filtered:true,evicted:[]};
  }
  const evicted=[];
  while(s.entries.reduce((n,x)=>n+x.size,0)+size>cap){
    const v=s.entries.reduce((a,b)=>a.time<b.time?a:b);
    s.entries.splice(s.entries.indexOf(v),1);evicted.push(v.key);
  }
  s.entries.push({key,size,time});return {hit:false,bypass:false,filtered:false,evicted};
}
function replay(cap,limit,requests){
  const c=new SizeAdmission(cap,limit),s={entries:[],history:[]};
  let hits=0,hitBytes=0,requestedBytes=0,evictions=0,bypasses=0,filtered=0;
  for(let i=0;i<requests.length;i++){
    const {key,size}=requests[i],want=reference(cap,limit,s,key,size,i),got=c.access(key,size);
    assert.deepEqual(got,want);
    assert.deepEqual([...c.cache.entries],s.entries.slice().sort((a,b)=>a.time-b.time).map(x=>[x.key,x.size]));
    assert.deepEqual([...c.history],s.history);
    assert.equal(c.cache.used,s.entries.reduce((n,x)=>n+x.size,0));
    const keys=[...c.cache.entries.keys(),...c.history.keys()];
    assert(c.cache.used>=0&&c.cache.used<=cap&&c.history.size<=limit&&new Set(keys).size===keys.length);
    assert([...c.history.values()].every(n=>n===1||n===2));
    requestedBytes+=size;if(got.hit){hits++;hitBytes+=size;}
    evictions+=got.evicted.length;if(got.bypass)bypasses++;if(got.filtered)filtered++;
  }
  return {requests:requests.length,hits,requestedBytes,hitBytes,evictions,bypasses,filtered,peakHistory:c.peakHistory};
}
function tests(){
  const c=new SizeAdmission(1024,2);
  assert(!c.access(0,64).filtered);assert(c.access(0,64).hit);
  assert(c.access(1,65).filtered);assert(!c.access(1,65).filtered);assert(c.access(1,65).hit);
  assert(c.access(2,257).filtered);assert(c.access(2,257).filtered);assert(!c.access(2,257).filtered);assert(c.access(2,257).hit);
  const d=new SizeAdmission(1024,1);
  d.access(0,512);d.access(1,512);assert(d.access(0,512).filtered);assert.equal(d.history.get(0),1);
  const before=[...d.history];assert(d.access(9,1025).bypass);assert.deepEqual([...d.history],before);
  const e=new SizeAdmission(1024,2);e.access(0,256);assert(!e.access(0,256).filtered);
  let histories=0;
  for(const cap of [384,768])for(const limit of [1,3])for(let n=0;n<4096;n++){
    let x=n;const seq=[];for(let j=0;j<6;j++){const key=x%4;x=Math.floor(x/4);seq.push({key,size:[64,65,257,800][key]});}
    replay(cap,limit,seq);histories++;
  }
  return {crafted:6,exhaustive_histories:histories};
}
function experiment(){
  const test=tests(),results=[];
  for(const cap of [4096,16384])for(const profile of ['uniform','hot_scan','small_hot','phase_shift'])for(const seed of [271828,314159,104729,130363]){
    const req=workload(cap,profile,seed);
    results.push({cap,profile,seed,group:seed===130363?'additional':'prior',
      policies:{lru:fixed(cap,'lru',req),second:second(cap,cap/128,req),size:replay(cap,cap/128,req)}});
  }
  return {scope:'independent_size_sensitive_cache_admission_only',tests:test,results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={SizeAdmission,replay,tests,experiment};
