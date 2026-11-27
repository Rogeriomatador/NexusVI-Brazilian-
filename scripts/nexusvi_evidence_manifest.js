// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Fixed independent CI evidence set; integrity only, no signature or attestation.
const assert=require('node:assert/strict');
const {parseStrict}=require('./nexusvi_strict_json.js');
const SPEC=[['arena-timing.json','measured_logical_timing'],['synthetic-graphics.json','synthetic_graphics_fixture']];
const MAX=4*1024*1024;
function validRevision(s){return typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);}
function keys(x,k){assert(x&&typeof x==='object'&&!Array.isArray(x));assert.deepEqual(Object.keys(x).sort(),k.slice().sort());}
function validate(m,revision){
  assert(validRevision(revision));
  keys(m,['schema_version','scope','revision','files']);
  assert.equal(m.schema_version,1);assert.equal(m.scope,'independent_ci_evidence_integrity_only');
  assert.equal(m.revision,revision);assert(Array.isArray(m.files));assert.equal(m.files.length,SPEC.length);
  for(let i=0;i<SPEC.length;i++){
    const f=m.files[i];keys(f,['name','kind','bytes','sha256']);
    assert.equal(f.name,SPEC[i][0]);assert.equal(f.kind,SPEC[i][1]);
    assert(Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=MAX);
    assert(typeof f.sha256==='string'&&/^[0-9a-f]{64}$/.test(f.sha256));
  }
  return m;
}
function build(revision,describe){
  return validate({schema_version:1,scope:'independent_ci_evidence_integrity_only',revision,
    files:SPEC.map(([name,kind])=>({name,kind,...describe(name)}))},revision);
}
function verify(m,revision,describe){
  validate(m,revision);
  for(const f of m.files){const actual=describe(f.name);assert.equal(actual.bytes,f.bytes,'byte count mismatch: '+f.name);assert.equal(actual.sha256,f.sha256,'digest mismatch: '+f.name);}
  return {verified_files:m.files.length,revision,scope:m.scope};
}
function tests(){
  const rev='a'.repeat(40),describe=name=>({bytes:name.length,sha256:(name==='arena-timing.json'?'1':'2').repeat(64)});
  const original=build(rev,describe);assert.equal(verify(original,rev,describe).verified_files,2);
  const changes=[m=>m.revision='b'.repeat(40),m=>m.files.reverse(),m=>m.files.pop(),m=>m.files[0].name='../arena-timing.json',
    m=>m.files[0].kind='synthetic_graphics_fixture',m=>m.files[0].bytes++,m=>m.files[0].sha256='0'.repeat(64),
    m=>m.files[0].bytes=MAX+1,m=>m.files[0].extra=true,m=>m.scope='authenticated',
    m=>m.files[0].sha256='A'.repeat(64),m=>m.files.push(m.files[0])];
  for(const change of changes){const m=JSON.parse(JSON.stringify(original));change(m);let rejected=false;try{verify(m,rev,describe);}catch{rejected=true;}assert(rejected);}
  let rejected=false;try{parseStrict('{"revision":"a","revision":"b"}');}catch{rejected=true;}assert(rejected);
  return 14;
}
function native(){
  const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
  function read(file,limit){
    // Reject symlinks and nonregular files before opening; recheck descriptor.
    assert(fs.lstatSync(file).isFile(),'expected regular file: '+file);
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NONBLOCK||0)|(fs.constants.O_NOFOLLOW||0));
    try{
      assert(fs.fstatSync(fd).isFile());const b=Buffer.alloc(limit+1);let n=0;
      while(n<b.length){const m=fs.readSync(fd,b,n,b.length-n,null);if(!m)break;n+=m;}
      assert(n>0&&n<=limit,'invalid file size: '+file);return b.subarray(0,n);
    }finally{fs.closeSync(fd);}
  }
  const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
  const describe=(dir,name)=>{const b=read(path.join(dir,name),MAX);return {bytes:b.length,sha256:digest(b)};};
  function selfTest(){
    const count=tests();
    assert.equal(digest(Buffer.from('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'nexusvi-manifest-'));
    try{
      for(const [name] of SPEC)fs.writeFileSync(path.join(dir,name),'abc');
      const rev='a'.repeat(40),d=name=>describe(dir,name),m=build(rev,d);
      assert.equal(verify(m,rev,d).verified_files,2);
      fs.writeFileSync(path.join(dir,SPEC[0][0]),'abd');
      assert.throws(()=>verify(m,rev,d),/digest mismatch/);
      fs.unlinkSync(path.join(dir,SPEC[0][0]));assert.throws(()=>verify(m,rev,d));
      return count+4;
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--self-test'){console.log('evidence manifest: '+selfTest()+' cases passed');return;}
  assert.equal(args.length,3,'usage: create|verify DIRECTORY EXPECTED_REVISION');
  const [mode,dir,revision]=args;assert(validRevision(revision));
  const file=path.join(dir,'evidence-manifest.json'),d=name=>describe(dir,name);
  if(mode==='create'){
    const m=build(revision,d);fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(m,null,2));
  }else if(mode==='verify'){
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(read(file,65536));
    console.log(JSON.stringify(verify(parseStrict(raw),revision,d),null,2));
  }else throw Error('unknown mode');
}
if(require.main===module){try{native();}catch(e){console.error('Rejected: '+e.message);process.exitCode=1;}}
module.exports={build,verify,validate,tests};
