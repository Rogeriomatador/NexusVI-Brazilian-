// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent descriptive sensitivity analysis; weights are not measured time.
const assert=require('node:assert/strict');
const {experiment}=require('./nexusvi_cache_size_admission.js');
const names=['lru','second','size'];
const profiles=['uniform','hot_scan','small_hot','phase_shift'];
const metrics=['misses','missBytes','evictions'];
function vector(x){
  for(const k of ['requests','hits','requestedBytes','hitBytes','evictions'])
    assert(Number.isSafeInteger(x[k])&&x[k]>=0);
  assert(x.hits<=x.requests&&x.hitBytes<=x.requestedBytes);
  return {misses:x.requests-x.hits,missBytes:x.requestedBytes-x.hitBytes,evictions:x.evictions};
}
function score(v,w){
  for(const k of metrics){assert(Number.isSafeInteger(v[k])&&v[k]>=0);assert(Number.isSafeInteger(w[k])&&w[k]>=0&&w[k]<=100000);}
  assert(metrics.some(k=>w[k]>0));
  let total=0n;for(const k of metrics)total+=BigInt(v[k])*BigInt(w[k]);return total;
}
function evaluate(vectors,w){
  const costs=Object.fromEntries(names.map(n=>[n,score(vectors[n],w)]));
  const min=names.reduce((a,n)=>costs[n]<a?costs[n]:a,costs[names[0]]);
  return {weights:w,costs:Object.fromEntries(names.map(n=>[n,costs[n].toString()])),winners:names.filter(n=>costs[n]===min)};
}
function frontier(v){
  return names.filter(n=>!names.some(m=>m!==n&&metrics.every(k=>v[m][k]<=v[n][k])&&metrics.some(k=>v[m][k]<v[n][k])));
}
function aggregate(results){
  assert(results.length>0);
  const v=Object.fromEntries(names.map(n=>[n,{misses:0,missBytes:0,evictions:0}]));
  for(const r of results){
    const base=r.policies.lru;
    for(const n of names){
      const x=r.policies[n];assert.equal(x.requests,base.requests);assert.equal(x.requestedBytes,base.requestedBytes);
      const y=vector(x);for(const k of metrics){v[n][k]+=y[k];assert(Number.isSafeInteger(v[n][k]));}
    }
  }
  return v;
}
function grid(v){
  // Coefficients in abstract cost units: per miss, per logical byte, per eviction.
  const rows=[];
  for(const misses of [0,64,1024,16384])for(const missBytes of [0,1,16])for(const evictions of [0,64,1024]){
    if(misses||missBytes||evictions)rows.push(evaluate(v,{misses,missBytes,evictions}));
  }
  const wins=Object.fromEntries(names.map(n=>[n,rows.filter(r=>r.winners.length===1&&r.winners[0]===n).length]));
  return {scenarios:rows.length,unique_wins:wins,tied_scenarios:rows.filter(r=>r.winners.length>1).length,rows};
}
function summarize(results){
  assert(Array.isArray(results)&&results.length===32);
  const ids=new Set();
  for(const r of results){
    assert([4096,16384].includes(r.cap)&&profiles.includes(r.profile)&&[271828,314159,104729,130363].includes(r.seed));
    const id=[r.cap,r.profile,r.seed].join(':');assert(!ids.has(id));ids.add(id);
    assert.equal(r.group,r.seed===130363?'additional':'prior');
    for(const n of names)assert.equal(r.policies[n].requests,4000);
  }
  const groups=[['all',results],['additional',results.filter(r=>r.group==='additional')],...profiles.map(p=>[p,results.filter(r=>r.profile===p)])];
  return groups.map(([group,rows])=>{const vectors=aggregate(rows);return {group,traces:rows.length,vectors,pareto_frontier:frontier(vectors),...grid(vectors)};});
}
function tests(){
  const v={lru:{misses:4,missBytes:10,evictions:8},second:{misses:3,missBytes:8,evictions:1},size:{misses:2,missBytes:9,evictions:2}};
  assert.deepEqual(frontier(v),['second','size']);
  assert.deepEqual(evaluate(v,{misses:1,missBytes:0,evictions:0}).winners,['size']);
  assert.deepEqual(evaluate(v,{misses:0,missBytes:1,evictions:0}).winners,['second']);
  assert.deepEqual(evaluate(v,{misses:0,missBytes:0,evictions:1}).winners,['second']);
  assert.deepEqual(evaluate(v,{misses:1,missBytes:1,evictions:0}).winners,['second','size']);
  assert.equal(score({misses:Number.MAX_SAFE_INTEGER,missBytes:0,evictions:0},{misses:100000,missBytes:0,evictions:0}),900719925474099100000n);
  const g=grid(v);assert.equal(g.scenarios,35);assert.equal(Object.values(g.unique_wins).reduce((s,n)=>s+n,0)+g.tied_scenarios,35);
  for(const w of [{misses:0,missBytes:0,evictions:0},{misses:-1,missBytes:1,evictions:0},{misses:1.5,missBytes:0,evictions:0}]){
    let bad=false;try{score(v.lru,w);}catch{bad=true;}assert(bad);
  }
  let bad=false;try{vector({requests:1,hits:2,requestedBytes:1,hitBytes:0,evictions:0});}catch{bad=true;}assert(bad);
  return 11;
}
if(require.main===module){
  assert.equal(process.argv.length,2);
  const self_tests=tests(),r=experiment();
  console.log(JSON.stringify({scope:'independent_abstract_cache_cost_sensitivity_only',self_tests,source_tests:r.tests,groups:summarize(r.results)},null,2));
}
module.exports={vector,score,evaluate,frontier,grid,summarize,tests};
