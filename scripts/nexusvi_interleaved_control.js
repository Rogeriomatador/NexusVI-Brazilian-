// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical allocator A/A and A/B descriptive control.
const assert=require('node:assert/strict');
const {SparseArena}=require('./nexusvi_sparse_arena.js');
const {SparseArenaV2,suite,execute,verify}=require('./nexusvi_sparse_arena_v2.js');
const names=['a1','a2','b'],orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]].map(o=>o.map(i=>names[i]));
const ROUNDS=36;
function median(v){assert(v.length>0);const s=v.slice().sort((a,b)=>a-b),n=s.length;return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;}
function summarize(samples){
  assert(Array.isArray(samples)&&samples.length===ROUNDS);
  for(let i=0;i<ROUNDS;i++){
    const s=samples[i];assert.equal(s.round,i+1);assert.deepEqual(s.order,orders[i%6]);
    assert.deepEqual(Object.keys(s.ns).sort(),names.slice().sort());
    for(const n of names)assert(Number.isSafeInteger(s.ns[n])&&s.ns[n]>0&&s.ns[n]<=1e12);
  }
  const control=samples.map(s=>Math.log(s.ns.a2/s.ns.a1));
  // Geometric mean of identical A controls avoids choosing one as reference.
  const effect=samples.map(s=>Math.log(s.ns.b)-(Math.log(s.ns.a1)+Math.log(s.ns.a2))/2);
  const absControl=control.map(Math.abs),absEffect=effect.map(Math.abs);
  const controlMedian=median(absControl);
  return {rounds:ROUNDS,median_ns:Object.fromEntries(names.map(n=>[n,median(samples.map(s=>s.ns[n]))])),
    aa_median_ratio:Math.exp(median(control)),aa_median_absolute_log_ratio:controlMedian,
    aa_max_absolute_log_ratio:Math.max(...absControl),
    b_over_geometric_a_median_ratio:Math.exp(median(effect)),
    b_median_absolute_log_ratio:median(absEffect),
    b_slower_than_both:samples.filter(s=>s.ns.b>Math.max(s.ns.a1,s.ns.a2)).length,
    b_faster_than_both:samples.filter(s=>s.ns.b<Math.min(s.ns.a1,s.ns.a2)).length,
    b_between_or_tied:samples.filter(s=>s.ns.b>=Math.min(s.ns.a1,s.ns.a2)&&s.ns.b<=Math.max(s.ns.a1,s.ns.a2)).length,
    order_effect:orders.map(o=>({order:o,median_b_over_geometric_a:Math.exp(median(effect.filter((_,i)=>i%6===orders.indexOf(o))))})),
    statistical_regression_proven:false};
}
function run(cases,clock){
  const classes={a1:SparseArenaV2,a2:SparseArenaV2,b:SparseArena},samples=[];
  for(let i=0;i<3;i++)for(const n of names)verify(cases,execute(classes[n],cases));
  for(let i=0;i<ROUNDS;i++){
    const order=orders[i%6].slice(),ns={};
    for(const n of order){const start=clock(),out=execute(classes[n],cases),end=clock();ns[n]=end-start;
      assert(Number.isSafeInteger(ns[n])&&ns[n]>0);verify(cases,out);}
    samples.push({round:i+1,order,ns});
  }
  return {scope:'independent_interleaved_aa_ab_descriptive_only',controls:'a1=a2=SparseArenaV2; b=SparseArena',
    requests_per_sample:cases.reduce((n,c)=>n+c.plan.events.length,0),
    warmup_rounds:3,summary:summarize(samples),samples};
}
function tests(){
  const make=(a1,a2,b)=>Array.from({length:ROUNDS},(_,i)=>({round:i+1,order:orders[i%6].slice(),ns:{a1,a2,b}}));
  const neutral=summarize(make(100,100,100));assert.equal(neutral.aa_median_absolute_log_ratio,0);assert.equal(neutral.b_between_or_tied,36);
  const slow=summarize(make(100,100,200));assert(Math.abs(slow.b_over_geometric_a_median_ratio-2)<1e-12);assert.equal(slow.b_slower_than_both,36);
  const fast=summarize(make(100,100,50));assert.equal(fast.b_faster_than_both,36);
  const uneven=summarize(make(100,400,200));assert(Math.abs(uneven.b_over_geometric_a_median_ratio-1)<1e-12);assert.equal(uneven.b_between_or_tied,36);
  for(const change of [s=>s.pop(),s=>s[0].order.reverse(),s=>s[1].round=1,s=>s[2].ns.a1=0,s=>s[3].ns.b=1e13,s=>s[4].ns.extra=1]){
    const s=make(100,100,100);change(s);let rejected=false;try{summarize(s);}catch{rejected=true;}assert(rejected);
  }
  return 10;
}
if(require.main===module){
  assert.equal(process.argv.length,2);const self_tests=tests(),cases=suite(),origin=process.hrtime.bigint();
  console.log(JSON.stringify({...run(cases,()=>Number(process.hrtime.bigint()-origin)),self_tests,platform:process.platform,node:process.version},null,2));
}
module.exports={run,summarize,tests};
