// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent instrumented byte-cache replay, no actual payload or I/O.
const assert=require('node:assert/strict');
const {WeightedCache,workload,reference:refLru}=require('./nexusvi_cache_weighted.js');
const {AdmissionCache,reference:refAdmission}=require('./nexusvi_cache_admission.js');
const names=['lru','second','second4'];
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]].map(o=>o.map(i=>names[i]));
const profiles=['uniform','hot_scan','small_hot','phase_shift'];
function record(r){return [r.hit?1:0,r.bypass?1:0,r.filtered?1:0,...r.evicted];}
function limit(cap,name){return name==='second'?cap/128:cap/32;}
function plan(cap,requests,name){
  const s={entries:[],history:[]},events=[];
  for(let i=0;i<requests.length;i++){
    const {key,size}=requests[i];
    const r=name==='lru'?refLru(cap,'lru',s.entries,key,size,i):refAdmission(cap,limit(cap,name),s,key,size,i);
    events.push(record(r));
  }
  return {events,entries:s.entries.slice().sort((a,b)=>a.time-b.time).map(x=>[x.key,x.size]),history:s.history,
    used:s.entries.reduce((n,x)=>n+x.size,0)};
}
function suite(){
  const out=[];
  for(const cap of [4096,16384])for(const profile of profiles)for(const seed of [271828,314159,104729]){
    const requests=workload(cap,profile,seed);
    out.push({cap,profile,seed,requests,expected:Object.fromEntries(names.map(n=>[n,plan(cap,requests,n)]))});
  }
  return out;
}
function execute(cases,name){
  return cases.map(c=>{
    const cache=name==='lru'?new WeightedCache(c.cap,'lru'):new AdmissionCache(c.cap,limit(c.cap,name));
    const events=[];
    for(const {key,size} of c.requests)events.push(record(cache.access(key,size)));
    return {events,cache};
  });
}
function verify(cases,name,out){
  assert.equal(out.length,cases.length);
  for(let i=0;i<cases.length;i++){
    const c=cases[i],want=c.expected[name],{events,cache}=out[i],resident=name==='lru'?cache:cache.cache;
    assert.deepEqual(events,want.events);assert.deepEqual([...resident.entries],want.entries);
    assert.equal(resident.used,want.used);assert(resident.used<=c.cap);
    assert.deepEqual(name==='lru'?[]:[...cache.history.keys()],want.history);
  }
}
function median(v){assert(v.length===18);const s=v.slice().sort((a,b)=>a-b);return (s[8]+s[9])/2;}
function summarize(samples){
  assert.equal(samples.length,18);
  for(let i=0;i<18;i++){
    const s=samples[i];assert.equal(s.round,i+1);assert.deepEqual(s.order,orders[i%6]);
    assert.deepEqual(Object.keys(s.ns).sort(),names.slice().sort());
    for(const n of names)assert(Number.isSafeInteger(s.ns[n])&&s.ns[n]>0&&s.ns[n]<=1e12);
  }
  return {median_ns:Object.fromEntries(names.map(n=>[n,median(samples.map(s=>s.ns[n]))])),
    paired:Object.fromEntries(names.slice(1).map(n=>{
      const ratios=samples.map(s=>s.ns.lru/s.ns[n]);
      return [n,{median_lru_over_candidate:median(ratios),faster:ratios.filter(x=>x>1).length,
        slower:ratios.filter(x=>x<1).length,ties:ratios.filter(x=>x===1).length}];
    }))};
}
function measure(cases,clock){
  for(let i=0;i<3;i++)for(const n of names)verify(cases,n,execute(cases,n));
  const samples=[];
  for(let i=0;i<18;i++){
    const order=orders[i%6].slice(),ns={};
    for(const n of order){
      const start=clock(),out=execute(cases,n),end=clock();
      ns[n]=end-start;verify(cases,n,out);
    }
    samples.push({round:i+1,order,ns});
  }
  return {requests_per_sample:cases.reduce((n,c)=>n+c.requests.length,0),...summarize(samples),samples};
}
function tests(){
  const req=[{key:0,size:128},{key:0,size:128},{key:0,size:128},{key:1,size:129}];
  const c={cap:128,requests:req,expected:Object.fromEntries(names.map(n=>[n,plan(128,req,n)]))};
  for(const n of names)verify([c],n,execute([c],n));
  assert.deepEqual(c.expected.second.events,[[0,0,1],[0,0,0],[1,0,0],[0,1,0]]);
  let tick=0;const t=measure([c],()=>{tick+=100;return tick;});assert.equal(t.paired.second.ties,18);
  const out=execute([c],'lru');out[0].events[0][0]=1;
  let rejected=false;try{verify([c],'lru',out);}catch{rejected=true;}assert(rejected);
  const sample=()=>Array.from({length:18},(_,i)=>({round:i+1,order:orders[i%6],ns:{lru:200,second:100,second4:400}}));
  const s=summarize(sample());assert.equal(s.paired.second.median_lru_over_candidate,2);assert.equal(s.paired.second4.slower,18);
  for(const change of [s=>s.pop(),s=>s[0].ns.lru=0,s=>s[1].round=1,s=>s[2].order=['lru','second','second4']]){
    const x=sample();change(x);let bad=false;try{summarize(x);}catch{bad=true;}assert(bad);
  }
  return 9;
}
if(require.main===module){
  assert.equal(process.argv.length,2);const self_tests=tests(),cases=suite(),origin=process.hrtime.bigint();
  console.log(JSON.stringify({scope:'independent_instrumented_weighted_cache_timing_only',self_tests,warmup_rounds:3,
    platform:process.platform,node:process.version,results:profiles.map(profile=>({profile,...measure(cases.filter(c=>c.profile===profile),()=>Number(process.hrtime.bigint()-origin))}))},null,2));
}
module.exports={suite,measure,tests,summarize};
