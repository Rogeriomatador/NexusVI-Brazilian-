// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const assert=require('node:assert/strict');
const names=['linear','dense','sparse'];
const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]].map(o=>o.map(i=>names[i]));
const median=a=>{const s=a.slice().sort((x,y)=>x-y),n=s.length;return n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2;};
const summary=a=>({median_ns:median(a),p95_ns:a.slice().sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1],min_ns:Math.min(...a),max_ns:Math.max(...a)});
function analyze(d){
  assert(d&&d.scope==='independent_instrumented_logical_allocator_timing_only');
  assert.equal(d.rounds,18);assert.equal(d.warmup_rounds,3);assert.equal(d.traces,12);
  assert.equal(d.requests_per_sample,9600);assert.equal(d.accepted_per_sample,7611);
  assert.equal(d.self_tests,5);assert(['win32','linux'].includes(d.platform));
  assert(typeof d.arch==='string'&&d.arch.length>0&&d.arch.length<=32);
  assert(typeof d.node==='string'&&/^v\d+\.\d+\.\d+$/.test(d.node));
  assert(Array.isArray(d.samples)&&d.samples.length===18);
  for(let i=0;i<18;i++){
    const s=d.samples[i];assert.equal(s.round,i+1);assert.deepEqual(s.order,orders[i%6]);
    assert.deepEqual(Object.keys(s.ns).sort(),names.slice().sort());
    for(const n of names)assert(Number.isSafeInteger(s.ns[n])&&s.ns[n]>0&&s.ns[n]<=1e12);
  }
  const stats={},positions={},drift={},comparisons={};
  assert.deepEqual(Object.keys(d.statistics).sort(),names.slice().sort());
  for(const n of names){
    const v=d.samples.map(s=>s.ns[n]);stats[n]=summary(v);assert.deepEqual(d.statistics[n],stats[n]);
    positions[n]=[0,1,2].map(i=>median(d.samples.filter(s=>s.order[i]===n).map(s=>s.ns[n])));
    drift[n]={first6_median_ns:median(v.slice(0,6)),last6_median_ns:median(v.slice(-6))};
  }
  for(const [a,b] of [['linear','dense'],['linear','sparse'],['dense','sparse']]){
    const ratios=d.samples.map(s=>s.ns[a]/s.ns[b]);
    comparisons[a+'_over_'+b]={median_paired_speedup:median(ratios),
      candidate_wins:ratios.filter(x=>x>1).length,ties:ratios.filter(x=>x===1).length,
      candidate_losses:ratios.filter(x=>x<1).length,
      position_pair_medians:orders.map(o=>({order:o,median_speedup:median(d.samples.filter(s=>s.order.every((n,i)=>n===o[i])).map(s=>s.ns[a]/s.ns[b]))}))};
  }
  return {validation:'arithmetic_and_structure_only',platform:d.platform,arch:d.arch,node:d.node,
    statistics:stats,position_median_ns:positions,drift,comparisons};
}
function fixture(){
  const samples=Array.from({length:18},(_,i)=>({round:i+1,order:orders[i%6].slice(),ns:{linear:1000+i,dense:800+i,sparse:600+i}}));
  return {scope:'independent_instrumented_logical_allocator_timing_only',rounds:18,warmup_rounds:3,traces:12,requests_per_sample:9600,accepted_per_sample:7611,self_tests:5,platform:'linux',arch:'x64',node:'v22.0.0',samples,statistics:Object.fromEntries(names.map(n=>[n,summary(samples.map(s=>s.ns[n]))]))};
}
function tests(){
  const x=analyze(fixture());assert.equal(x.comparisons.linear_over_sparse.candidate_wins,18);
  assert.equal(x.position_median_ns.linear.length,3);assert.equal(x.drift.linear.first6_median_ns,1002.5);
  const changes=[d=>d.samples.pop(),d=>d.samples[1].round=1,d=>d.samples[0].order.reverse(),d=>d.samples[0].ns.linear=0,d=>d.samples[0].ns.sparse=NaN,d=>d.statistics.linear.median_ns++,d=>d.accepted_per_sample++,d=>d.samples[0].ns.extra=1,d=>d.platform='unknown',d=>d.samples[0].ns.linear=1e13];
  for(const change of changes){const d=fixture();change(d);let rejected=false;try{analyze(d);}catch(e){rejected=true;}assert(rejected);}
  return 11;
}
if(require.main===module){
  try{
    if(process.argv.length===3&&process.argv[2]==='--self-test'){console.log('timing report: '+tests()+' cases passed');}
    else{
      assert.equal(process.argv.length,3);
      const fs=require('node:fs'),fd=fs.openSync(process.argv[2],'r');let raw;
      try{assert(fs.fstatSync(fd).isFile());const b=Buffer.alloc(262145);let n=0;while(n<b.length){const m=fs.readSync(fd,b,n,b.length-n,null);if(!m)break;n+=m;}assert(n<=262144);raw=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n));}finally{fs.closeSync(fd);}
      console.log(JSON.stringify(analyze(JSON.parse(raw)),null,2));
    }
  }catch(e){console.error('Rejected: '+e.message);process.exitCode=1;}
}
module.exports={analyze,tests};
