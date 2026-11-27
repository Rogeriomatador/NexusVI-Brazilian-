// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent same-process repeatability control, not a performance gate.
const assert=require('node:assert/strict');
const {suite,benchmark}=require('./nexusvi_arena_timing.js');
const {analyze,fixture}=require('./nexusvi_arena_timing_report.js');
const {observe,validate,compareContext}=require('./nexusvi_timing_context.js');
const N=6,names=['linear','dense','sparse'];
function median(v){const s=v.slice().sort((a,b)=>a-b);const n=s.length;return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;}
function spread(v){
  assert(v.length===N&&v.every(x=>Number.isFinite(x)&&x>0));
  const m=median(v),lo=Math.min(...v),hi=Math.max(...v);
  return {values:v,median:m,min:lo,max:hi,relative_mad:median(v.map(x=>Math.abs(x-m)))/m,relative_span:(hi-lo)/m};
}
function summarize(blocks){
  assert(Array.isArray(blocks)&&blocks.length===N);
  const reports=blocks.map((b,i)=>{
    assert.equal(b.block,i+1);
    assert(b.report.context!==undefined);validate(b.report.context);
    return analyze(b.report);
  });
  for(let i=1;i<N;i++){
    for(const k of ['platform','arch','node'])assert.equal(reports[i][k],reports[0][k]);
    const c=compareContext(blocks[0].report.context,blocks[i].report.context);
    assert.equal(c.source_identity,'matching_observed_digests');
    assert(c.environment_identity!=='different');
  }
  const time_median_ns={},within_block_speedup={};
  for(const n of names)time_median_ns[n]=spread(reports.map(r=>r.statistics[n].median_ns));
  for(const n of ['dense','sparse'])within_block_speedup[n]=spread(reports.map(r=>r.comparisons['linear_over_'+n].median_paired_speedup));
  return {scope:'independent_same_process_repeatability_descriptive_only',blocks:N,rounds_per_block:18,
    measured_samples:N*18*3,requests_per_sample:9600,accepted_per_sample:7611,
    time_median_ns,within_block_speedup,causal_regression_proven:false};
}
function run(clock,context,metadata,plans=suite()){
  validate(context);const blocks=[];
  for(let i=0;i<N;i++){
    const report=benchmark(clock,plans,18,3);
    blocks.push({block:i+1,report:{...report,...metadata,context,self_tests:5}});
  }
  return {summary:summarize(blocks),blocks};
}
function tests(){
  const context={schema_version:1,sources:['nexusvi_arena_timing.js','nexusvi_fragmentation.js','nexusvi_indexed_arena.js','nexusvi_sparse_arena.js','nexusvi_timing_context.js'].map(name=>({name,bytes:1,sha256:'a'.repeat(64)})),environment:{cpu_model:'fixture',logical_cpus:4,os_release:'1',v8:'1'}};
  function blocks(){return Array.from({length:N},(_,i)=>({block:i+1,report:{...fixture(),context:JSON.parse(JSON.stringify(context))}}));}
  const stable=summarize(blocks());assert.equal(stable.time_median_ns.linear.relative_span,0);
  assert.equal(stable.within_block_speedup.sparse.relative_mad,0);
  const varied=blocks();for(const s of varied[5].report.samples)for(const n of names)s.ns[n]*=2;
  for(const n of names)for(const k of Object.keys(varied[5].report.statistics[n]))varied[5].report.statistics[n][k]*=2;
  const v=summarize(varied);assert.equal(v.time_median_ns.linear.relative_span,1);assert.equal(v.within_block_speedup.sparse.relative_span,0);
  assert.equal(spread([1,2,3,4,5,6]).median,3.5);assert.equal(spread([1,2,3,4,5,6]).relative_mad,1.5/3.5);
  for(const change of [b=>b.pop(),b=>b[1].block=1,b=>delete b[1].report.context,b=>b[1].report.context.sources[0].sha256='b'.repeat(64),b=>b[1].report.context.environment.logical_cpus=8,b=>b[1].report.node='v23.0.0',b=>b[1].report.statistics.dense.median_ns++]){
    const b=blocks();change(b);let rejected=false;try{summarize(b);}catch{rejected=true;}assert(rejected);
  }
  return 10;
}
if(require.main===module){
  assert.equal(process.argv.length,2);
  const self_tests=tests(),context=observe(),plans=suite(),origin=process.hrtime.bigint();
  const result=run(()=>Number(process.hrtime.bigint()-origin),context,{platform:process.platform,arch:process.arch,node:process.version},plans);
  assert.deepEqual(observe().sources,context.sources);
  console.log(JSON.stringify({self_tests,...result},null,2));
}
module.exports={summarize,run,tests};
