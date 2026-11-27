// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Descriptive comparison of independently measured logical timing reports.
const assert=require('node:assert/strict');
const {analyze,fixture}=require('./nexusvi_arena_timing_report.js');
const {loadBundle}=require('./nexusvi_evidence_manifest.js');
const names=['linear','dense','sparse'];
const revision=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
function compare(base,next,baseRev,nextRev){
  assert(revision(baseRev)&&revision(nextRev)&&baseRev!==nextRev,'two distinct expected revisions required');
  const a=analyze(base),b=analyze(next);
  // The existing analyzer enforces the exact fixed workload and round protocol.
  for(const k of ['platform','arch','node'])assert.equal(a[k],b[k],'declared environment mismatch: '+k);
  const policies={};
  for(const n of names){
    const x=a.statistics[n],y=b.statistics[n];
    policies[n]={baseline_median_ns:x.median_ns,candidate_median_ns:y.median_ns,
      median_time_ratio:y.median_ns/x.median_ns,p95_time_ratio:y.p95_ns/x.p95_ns};
  }
  const relative={};
  for(const n of ['dense','sparse']){
    const key='linear_over_'+n,x=a.comparisons[key].median_paired_speedup,y=b.comparisons[key].median_paired_speedup;
    relative[n]={baseline_within_run_speedup:x,candidate_within_run_speedup:y,
      relative_speedup_ratio:y/x};
  }
  return {scope:'independent_revision_comparison_descriptive_only',baseline_revision:baseRev,candidate_revision:nextRev,
    declared_environment:{platform:a.platform,arch:a.arch,node:a.node},
    samples_per_policy_per_revision:18,cross_run_pairing:false,hardware_equivalence_verified:false,
    statistical_regression_proven:false,policies,relative_to_linear:relative};
}
function scaled(factors){
  const d=fixture();
  for(const s of d.samples)for(const n of names)s.ns[n]*=factors[n];
  for(const n of names)for(const k of Object.keys(d.statistics[n]))d.statistics[n][k]*=factors[n];
  return d;
}
function tests(){
  const a='a'.repeat(40),b='b'.repeat(40),base=fixture();
  const same=compare(base,fixture(),a,b);
  for(const n of names)assert.equal(same.policies[n].median_time_ratio,1);
  const slower=compare(base,scaled({linear:2,dense:2,sparse:2}),a,b);
  assert.equal(slower.policies.sparse.median_time_ratio,2);
  assert.equal(slower.relative_to_linear.sparse.relative_speedup_ratio,1);
  const faster=compare(base,scaled({linear:2,dense:2,sparse:1}),a,b);
  assert.equal(faster.relative_to_linear.sparse.relative_speedup_ratio,2);
  assert.equal(faster.policies.sparse.median_time_ratio,1);
  const changes=[d=>d.platform='win32',d=>d.arch='arm64',d=>d.node='v23.0.0',d=>d.rounds=6,
    d=>d.requests_per_sample++,d=>d.samples[0].ns.sparse=0,d=>d.statistics.sparse.median_ns++,
    d=>d.samples[0].order.reverse()];
  for(const change of changes){const d=fixture();change(d);let rejected=false;try{compare(base,d,a,b);}catch{rejected=true;}assert(rejected);}
  for(const bad of [a,'invalid']){let rejected=false;try{compare(base,base,a,bad);}catch{rejected=true;}assert(rejected);}
  return 13;
}
function nativeTests(){
  const count=tests(),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  const {build}=require('./nexusvi_evidence_manifest.js');
  const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'nexusvi-compare-'));
  const rev='a'.repeat(40),next='b'.repeat(40);
  function writeBundle(sub,id,data){
    const p=path.join(dir,sub);fs.mkdirSync(p);
    fs.writeFileSync(path.join(p,'arena-timing.json'),JSON.stringify(data));
    fs.writeFileSync(path.join(p,'synthetic-graphics.json'),'{}');
    const m=build(id,name=>{const b=fs.readFileSync(path.join(p,name));return {bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};});
    fs.writeFileSync(path.join(p,'evidence-manifest.json'),JSON.stringify(m));
    return p;
  }
  try{
    const a=writeBundle('a',rev,fixture()),b=writeBundle('b',next,scaled({linear:2,dense:2,sparse:1}));
    assert.equal(compare(loadBundle(a,rev).timing,loadBundle(b,next).timing,rev,next).relative_to_linear.sparse.relative_speedup_ratio,2);
    assert.throws(()=>loadBundle(a,next));
    const file=path.join(b,'arena-timing.json');const raw=fs.readFileSync(file);raw[0]=32;fs.writeFileSync(file,raw);
    assert.throws(()=>loadBundle(b,next),/digest mismatch/);
    return count+3;
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module){
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==='--self-test'){console.log('revision comparison: '+nativeTests()+' cases passed');}
    else if(args.length===3&&args[0]==='--check-bundle'){
      const b=loadBundle(args[1],args[2]);analyze(b.timing);
      console.log(JSON.stringify({verified_bundle:b.revision,measured_timing_schema:'valid'}));
    }else{
      assert.equal(args.length,4,'usage: BASE_DIR BASE_REV CANDIDATE_DIR CANDIDATE_REV');
      const [ad,ar,bd,br]=args;
      const a=loadBundle(ad,ar),b=loadBundle(bd,br);
      console.log(JSON.stringify(compare(a.timing,b.timing,ar,br),null,2));
    }
  }catch(e){console.error('Rejected: '+e.message);process.exitCode=1;}
}
module.exports={compare,tests};
