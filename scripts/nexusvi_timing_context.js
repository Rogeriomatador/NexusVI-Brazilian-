// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Descriptive source/environment observations for independent logical timings.
const assert=require('node:assert/strict');
const FILES=['nexusvi_arena_timing.js','nexusvi_fragmentation.js','nexusvi_indexed_arena.js','nexusvi_sparse_arena.js','nexusvi_timing_context.js'];
function keys(x,k){assert(x&&typeof x==='object'&&!Array.isArray(x));assert.deepEqual(Object.keys(x).sort(),k.slice().sort());}
function validate(c){
  keys(c,['schema_version','sources','environment']);
  assert.equal(c.schema_version,1);
  assert(Array.isArray(c.sources));assert.equal(c.sources.length,FILES.length);
  for(let i=0;i<FILES.length;i++){
    const s=c.sources[i];keys(s,['name','bytes','sha256']);assert.equal(s.name,FILES[i]);
    assert(Number.isSafeInteger(s.bytes)&&s.bytes>0&&s.bytes<=1048576);
    assert(typeof s.sha256==='string'&&/^[0-9a-f]{64}$/.test(s.sha256));
  }
  const e=c.environment;keys(e,['cpu_model','logical_cpus','os_release','v8']);
  for(const k of ['cpu_model','os_release','v8'])assert(e[k]===null||(typeof e[k]==='string'&&e[k].length>0&&e[k].length<=256));
  assert(e.logical_cpus===null||(Number.isInteger(e.logical_cpus)&&e.logical_cpus>0&&e.logical_cpus<=65536));
  return c;
}
function make(describe,environment){return validate({schema_version:1,sources:FILES.map(name=>({name,...describe(name)})),environment});}
function compareContext(a,b){
  if(a!==undefined)validate(a);if(b!==undefined)validate(b);
  if(a===undefined||b===undefined)return {source_identity:'unavailable',environment_identity:'unavailable',changed_sources:[],changed_environment:[],unknown_environment:[]};
  const changed_sources=FILES.filter((_,i)=>a.sources[i].sha256!==b.sources[i].sha256||a.sources[i].bytes!==b.sources[i].bytes);
  const fields=['cpu_model','logical_cpus','os_release','v8'];
  const changed_environment=fields.filter(k=>a.environment[k]!==null&&b.environment[k]!==null&&a.environment[k]!==b.environment[k]);
  const unknown_environment=fields.filter(k=>a.environment[k]===null||b.environment[k]===null);
  return {source_identity:changed_sources.length?'different':'matching_observed_digests',
    environment_identity:changed_environment.length?'different':unknown_environment.length?'incomplete':'matching_observed_fields',
    changed_sources,changed_environment,unknown_environment};
}
function observe(){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
  const describe=name=>{
    const file=path.join(__dirname,name);assert(fs.lstatSync(file).isFile());
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NONBLOCK||0)|(fs.constants.O_NOFOLLOW||0));
    try{assert(fs.fstatSync(fd).isFile());const b=Buffer.alloc(1048577);let n=0;
      while(n<b.length){const m=fs.readSync(fd,b,n,b.length-n,null);if(!m)break;n+=m;}
      assert(n>0&&n<=1048576);return {bytes:n,sha256:crypto.createHash('sha256').update(b.subarray(0,n)).digest('hex')};
    }finally{fs.closeSync(fd);}
  };
  const cpus=os.cpus(),models=[...new Set(cpus.map(c=>c.model.trim()).filter(Boolean))];
  const safe=s=>typeof s==='string'&&s.length>0&&s.length<=256?s:null;
  return make(describe,{cpu_model:models.length===1?safe(models[0]):null,logical_cpus:cpus.length>0?cpus.length:null,os_release:safe(os.release()),v8:safe(process.versions.v8)});
}
function tests(){
  const f=()=>make(()=>({bytes:10,sha256:'a'.repeat(64)}),{cpu_model:'fixture',logical_cpus:4,os_release:'1',v8:'1'});
  assert.equal(compareContext(f(),f()).source_identity,'matching_observed_digests');
  assert.equal(compareContext(f(),f()).environment_identity,'matching_observed_fields');
  const b=f();b.sources[1].sha256='b'.repeat(64);b.environment.logical_cpus=8;
  const r=compareContext(f(),b);assert.deepEqual(r.changed_sources,[FILES[1]]);assert.deepEqual(r.changed_environment,['logical_cpus']);
  b.environment.logical_cpus=null;assert.equal(compareContext(f(),b).environment_identity,'incomplete');
  assert.equal(compareContext(f(),undefined).source_identity,'unavailable');
  for(const change of [x=>x.sources.reverse(),x=>x.sources[0].sha256='x',x=>x.sources[0].bytes=0,x=>x.environment.logical_cpus=-1,x=>x.environment.extra=1,x=>x.schema_version=2]){
    const x=f();change(x);let rejected=false;try{validate(x);}catch{rejected=true;}assert(rejected);
  }
  return 10;
}
if(require.main===module){console.log('timing context: '+tests()+' cases passed');console.log(JSON.stringify(observe(),null,2));}
module.exports={validate,make,compareContext,observe,tests};
