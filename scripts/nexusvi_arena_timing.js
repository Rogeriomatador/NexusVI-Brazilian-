// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Compare existing instrumented logical allocators, not physical memory or GPU.
const assert=require('node:assert/strict');
const {Arena,trace}=require('./nexusvi_fragmentation.js');
const {IndexedArena}=require('./nexusvi_indexed_arena.js');
const {SparseArena}=require('./nexusvi_sparse_arena.js');
const names=['linear','dense','sparse'];
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const ROUNDS=18,WARMUP=3;
function plan(cap,requests){
  const bits=new Uint8Array(cap),live=new Map(),expires=new Map(),events=[];
  function release(id){const [s,e]=live.get(id);bits.fill(0,s,e);live.delete(id);}
  for(const r of requests){
    const releases=expires.get(r.id)||[];for(const id of releases)release(id);
    expires.delete(r.id);let p=-1;
    // Independent occupancy reference; checks each aligned address.
    for(let s=0;s+r.len<=cap;s+=r.align){
      let ok=true;for(let j=s;j<s+r.len;j++)if(bits[j]){ok=false;break;}
      if(ok){p=s;break;}
    }
    if(p>=0){bits.fill(1,p,p+r.len);live.set(r.id,[p,p+r.len]);
      if(!expires.has(r.end))expires.set(r.end,[]);expires.get(r.end).push(r.id);}
    events.push({...r,releases,expected:p});
  }
  const finalReleases=[...live.keys()];for(const id of finalReleases)release(id);
  assert(bits.every(x=>x===0));
  return {cap,events,finalReleases};
}
function suite(){
  const out=[];for(const cap of [4096,8192])for(const profile of ['small','mixed','large'])
    for(const seed of [271828,314159])out.push(plan(cap,trace(seed,profile,800)));
  return out;
}
function make(name,cap){
  if(name==='linear')return new Arena(cap,'first');
  if(name==='dense')return new IndexedArena(cap);
  if(name==='sparse')return new SparseArena(cap);
  throw Error('unknown policy');
}
function execute(name,plans){
  const outputs=[];
  for(const p of plans){
    const a=make(name,p.cap),offsets=new Int32Array(p.events.length);
    let badReleases=0;
    for(let i=0;i<p.events.length;i++){
      const r=p.events[i];for(const id of r.releases)if(!a.release(id))badReleases++;
      const v=a.allocate(r.id,r.len,r.align);
      offsets[i]=name==='linear'?(v?a.live.get(r.id)[0]:-1):(v===null?-1:v);
    }
    for(const id of p.finalReleases)if(!a.release(id))badReleases++;
    outputs.push({a,offsets,badReleases});
  }
  return outputs;
}
function verify(name,plans,outputs){
  assert.equal(outputs.length,plans.length);
  let accepted=0;
  for(let j=0;j<plans.length;j++){
    const p=plans[j],{a,offsets,badReleases}=outputs[j];assert.equal(badReleases,0);assert.equal(a.live.size,0);
    assert.equal(offsets.length,p.events.length);
    for(let i=0;i<offsets.length;i++){assert.equal(offsets[i],p.events[i].expected);if(offsets[i]>=0)accepted++;}
    if(name==='linear'){a.check();assert.deepEqual(a.free,[[0,p.cap]]);}
    else {a.check(new Uint8Array(p.cap));if(name==='dense')assert.equal(a.tree[1],p.cap);else assert.equal(a.nodes,1);}
  }
  return accepted;
}
function summary(values){
  assert(values.length>0&&values.every(v=>Number.isSafeInteger(v)&&v>0));
  const a=values.slice().sort((x,y)=>x-y),n=a.length;
  return {median_ns:n%2?a[n>>1]:(a[n/2-1]+a[n/2])/2,p95_ns:a[Math.ceil(n*.95)-1],min_ns:a[0],max_ns:a[n-1]};
}
function benchmark(clock,plans=suite(),rounds=ROUNDS,warmup=WARMUP){
  assert(Number.isInteger(rounds)&&rounds>=6&&rounds<=60&&rounds%6===0);
  assert(Number.isInteger(warmup)&&warmup>=0&&warmup<=12);
  const expected=plans.reduce((n,p)=>n+p.events.filter(r=>r.expected>=0).length,0);
  for(let i=0;i<warmup;i++)for(const name of names)assert.equal(verify(name,plans,execute(name,plans)),expected);
  const samples=[];
  for(let r=0;r<rounds;r++){
    const order=orders[r%6].map(i=>names[i]),ns={};
    // End-to-end instrumented replay, including construction, event dispatch,
    // allocation, release, result writes and cleanup. Oracle and checks outside.
    for(const name of order){
      const start=clock(),outputs=execute(name,plans),stop=clock();
      const elapsed=stop-start;assert(Number.isSafeInteger(elapsed)&&elapsed>0);
      assert.equal(verify(name,plans,outputs),expected);ns[name]=elapsed;
    }
    samples.push({round:r+1,order,ns});
  }
  const statistics={};for(const name of names)statistics[name]=summary(samples.map(s=>s.ns[name]));
  return {scope:'independent_instrumented_logical_allocator_timing_only',rounds,warmup_rounds:warmup,
    traces:plans.length,requests_per_sample:plans.reduce((n,p)=>n+p.events.length,0),
    accepted_per_sample:expected,statistics,samples};
}
function tests(){
  const p=plan(32,[{id:0,len:3,align:1,end:2},{id:1,len:8,align:16,end:3},{id:2,len:32,align:1,end:4},{id:3,len:32,align:1,end:5}]);
  assert.deepEqual(p.events.map(r=>r.expected),[0,16,-1,0]);
  for(const name of names)assert.equal(verify(name,[p],execute(name,[p])),3);
  assert.deepEqual(summary([6,2,4,8]),{median_ns:5,p95_ns:8,min_ns:2,max_ns:8});
  let t=0;const result=benchmark(()=>{t+=100;return t;},[p],6,1);
  assert.equal(result.samples.length,6);assert.equal(new Set(result.samples.map(s=>s.order.join(','))).size,6);
  for(const name of names)assert.equal(result.statistics[name].median_ns,100);
  const bad=execute('linear',[p]);bad[0].offsets[0]=1;
  let rejected=false;try{verify('linear',[p],bad);}catch(e){rejected=true;}assert(rejected);
  rejected=false;try{benchmark(()=>0,[p],6,0);}catch(e){rejected=true;}assert(rejected);
  return 5;
}
if(require.main===module){
  assert.equal(process.argv.length,2);
  const count=tests();
  const context=require('./nexusvi_timing_context.js').observe();
  const origin=process.hrtime.bigint();
  const result=benchmark(()=>Number(process.hrtime.bigint()-origin));
  console.log(JSON.stringify({...result,context,self_tests:count,platform:process.platform,arch:process.arch,node:process.version},null,2));
}
module.exports={tests,suite,benchmark};
