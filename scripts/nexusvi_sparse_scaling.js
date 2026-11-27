// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical allocator scaling: bounded, synthetic traces only.
const assert=require('node:assert/strict');
const {trace}=require('./nexusvi_fragmentation.js');
const {SparseArenaV2,plan,checked,timing}=require('./nexusvi_sparse_arena_v2.js');
const {SparseArenaV4}=require('./nexusvi_sparse_arena_v4.js');
const CAPACITIES=[8192,16384],SEEDS=[104729,130363];
function fragmented(cap,seed){
  assert(CAPACITIES.includes(cap));const n=cap/32,requests=[];
  // Fill capacity with 32-byte allocations; free alternating blocks together.
  // The remaining blocks expire later, forcing fragmentation then coalescing.
  for(let i=0;i<n;i++)requests.push({id:i,len:32,align:1,end:i%2===0?n:n+400});
  for(const r of trace(seed,'mixed',800))requests.push({...r,id:n+r.id,end:n+r.end});
  return requests;
}
function suite(){
  const cases=[];
  for(const cap of CAPACITIES)for(const seed of SEEDS){
    cases.push({cap,seed,profile:'mixed',plan:plan(cap,trace(seed,'mixed',1200))});
    cases.push({cap,seed,profile:'fragmented',plan:plan(cap,fragmented(cap,seed))});
  }
  return cases;
}
function compare(c){
  const baseline=checked(SparseArenaV2,c.plan),candidate=checked(SparseArenaV4,c.plan);
  for(const k of Object.keys(baseline))if(k!=='mutations')assert.equal(candidate[k],baseline[k]);
  assert(candidate.mutations<=baseline.mutations);
  if(c.profile==='fragmented')assert(baseline.peakNodes>=c.cap/64);
  return {cap:c.cap,seed:c.seed,profile:c.profile,requests:c.plan.events.length,baseline,candidate};
}
function tests(){
  for(const cap of CAPACITIES){
    const r=fragmented(cap,SEEDS[0]),n=cap/32;
    assert.equal(r.length,n+800);
    for(let i=0;i<r.length;i++){assert.equal(r[i].id,i);assert(r[i].end>i);}
    assert.equal(r[n-2].end,n);assert.equal(r[n-1].end,n+400);
    const p=plan(cap,r.slice(0,n+1));
    for(let i=0;i<n;i++)assert.equal(p.events[i].expected,i*32);
    assert.equal(p.events[n].releases.length,n/2);
  }
  assert.deepEqual(fragmented(8192,SEEDS[0]),fragmented(8192,SEEDS[0]));
  assert.notDeepEqual(fragmented(8192,SEEDS[0]),fragmented(8192,SEEDS[1]));
  return 4;
}
function experiment(cases=suite()){
  return {scope:'independent_sparse_avl_scaling_only',tests:tests(),results:cases.map(compare)};
}
function measure(cases,clock){
  return CAPACITIES.map(cap=>{
    const group=cases.filter(c=>c.cap===cap);assert.equal(group.length,4);
    return {cap,requests_per_sample:group.reduce((n,c)=>n+c.plan.events.length,0),...timing(group,clock,[SparseArenaV2,SparseArenaV4])};
  });
}
if(require.main===module){
  assert.equal(process.argv.length,2);const cases=suite(),result=experiment(cases);
  const origin=process.hrtime.bigint();
  console.log(JSON.stringify({...result,timing:measure(cases,()=>Number(process.hrtime.bigint()-origin)),node:process.version,platform:process.platform},null,2));
}
module.exports={experiment,suite,measure,tests};
