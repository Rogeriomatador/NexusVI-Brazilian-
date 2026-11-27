// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical AVL experiment: remove repeated lookups, preserve placement.
const assert=require('node:assert/strict');
const {SparseArena}=require('./nexusvi_sparse_arena.js');
const {trace}=require('./nexusvi_fragmentation.js');
class SparseArenaV2 extends SparseArena {
  searchNode(n,len,align){
    if(!n)return null;this.visits++;
    if(n.max<len)return null;
    const left=this.searchNode(n.l,len,align);if(left!==null)return left;
    if(n.e-n.s>=len){this.candidates++;if(Math.ceil(n.s/align)*align+len<=n.e)return n;}
    return this.searchNode(n.r,len,align);
  }
  removeKnown(s,e){
    assert.equal(this.ends.get(e),s);
    this.root=this.erase(this.root,s);this.ends.delete(e);this.nodes--;
  }
  allocate(id,len,align){
    assert(!this.live.has(id)&&Number.isInteger(len)&&len>0&&Number.isInteger(align)&&align>0&&align<=64&&(align&(align-1))===0);
    const n=this.searchNode(this.root,len,align);if(n===null)return null;
    // Copy coordinates before erase: successor substitution can mutate n.
    const s=n.s,e=n.e,p=Math.ceil(s/align)*align;
    this.removeKnown(s,e);
    if(s<p)this.add(s,p);if(p+len<e)this.add(p+len,e);this.live.set(id,[p,p+len]);return p;
  }
  release(id){
    if(!this.live.has(id))return false;
    let [s,e]=this.live.get(id);this.live.delete(id);
    const l=this.ends.get(s);if(l!==undefined){this.removeKnown(l,s);s=l;}
    const r=this.find(e);if(r){const end=r.e;this.removeKnown(e,end);e=end;}
    this.add(s,e);return true;
  }
}
function plan(cap,requests){
  const bits=new Uint8Array(cap),live=new Map(),expires=new Map(),events=[];
  function release(id){const [s,e]=live.get(id);bits.fill(0,s,e);live.delete(id);}
  for(const r of requests){
    const releases=expires.get(r.id)||[];for(const id of releases)release(id);expires.delete(r.id);
    let expected=null;
    for(let s=0;s+r.len<=cap;s+=r.align){
      let ok=true;for(let j=s;j<s+r.len;j++)if(bits[j]){ok=false;break;}
      if(ok){expected=s;break;}
    }
    if(expected!==null){bits.fill(1,expected,expected+r.len);live.set(r.id,[expected,expected+r.len]);
      if(!expires.has(r.end))expires.set(r.end,[]);expires.get(r.end).push(r.id);}
    events.push({...r,releases,expected});
  }
  return {cap,events,final:[...live.keys()]};
}
function checked(C,p){
  const a=new C(p.cap),bits=new Uint8Array(p.cap);
  let accepted=0;
  function release(id){const [s,e]=a.live.get(id);bits.fill(0,s,e);assert(a.release(id));}
  for(const r of p.events){
    for(const id of r.releases)release(id);
    const v=a.allocate(r.id,r.len,r.align);assert.equal(v,r.expected);
    if(v!==null){assert(bits.subarray(v,v+r.len).every(x=>x===0));bits.fill(1,v,v+r.len);accepted++;}
    a.check(bits);
  }
  for(const id of p.final)release(id);
  a.check(bits);assert(bits.every(x=>x===0));assert.equal(a.live.size,0);assert.equal(a.nodes,1);
  return {accepted,visits:a.visits,candidates:a.candidates,mutations:a.mutations,recalculations:a.recalculations,rotations:a.rotations,peakNodes:a.peakNodes,peakHeight:a.peakHeight};
}
function compare(p){
  const baseline=checked(SparseArena,p),candidate=checked(SparseArenaV2,p);
  for(const k of Object.keys(baseline))if(k!=='mutations')assert.equal(candidate[k],baseline[k]);
  assert(candidate.mutations<=baseline.mutations);
  return {baseline,candidate};
}
function tests(){
  const cases=[
    plan(65,[{id:0,len:3,align:1,end:2},{id:1,len:8,align:16,end:3},{id:2,len:16,align:16,end:4},{id:3,len:65,align:1,end:4}]),
    plan(33,[{id:0,len:33,align:1,end:2},{id:1,len:1,align:1,end:2},{id:2,len:33,align:1,end:3}])
  ];
  const requests=[];for(let i=0;i<128;i++)requests.push({id:i,len:1,align:1,end:i%2===0?128:1000});
  requests.push({id:128,len:64,align:1,end:1000});cases.push(plan(256,requests));
  for(const p of cases)compare(p);
  const a=new SparseArenaV2(64);assert.equal(a.allocate(0,64,1),0);assert(a.release(0));assert(!a.release(0));
  return 4;
}
function suite(){
  const cases=[];
  for(const cap of [4096,8192])for(const profile of ['small','mixed','large'])for(const seed of [271828,314159])
    cases.push({cap,profile,seed,plan:plan(cap,trace(seed,profile,800))});
  return cases;
}
function experiment(cases=suite()){
  return {scope:'independent_sparse_avl_lookup_elimination_only',tests:tests(),results:cases.map(c=>({cap:c.cap,profile:c.profile,seed:c.seed,...compare(c.plan)}))};
}
function execute(C,cases){
  return cases.map(c=>{
    const p=c.plan,a=new C(p.cap),offsets=new Int32Array(p.events.length);let bad=0;
    for(let i=0;i<p.events.length;i++){const r=p.events[i];for(const id of r.releases)if(!a.release(id))bad++;
      const x=a.allocate(r.id,r.len,r.align);offsets[i]=x===null?-1:x;}
    for(const id of p.final)if(!a.release(id))bad++;
    return {a,offsets,bad};
  });
}
function verify(cases,out){
  assert.equal(out.length,cases.length);
  for(let j=0;j<cases.length;j++){const p=cases[j].plan,{a,offsets,bad}=out[j];
    assert.equal(bad,0);assert.equal(a.live.size,0);assert.equal(a.nodes,1);a.check(new Uint8Array(p.cap));
    for(let i=0;i<p.events.length;i++)assert.equal(offsets[i],p.events[i].expected===null?-1:p.events[i].expected);
  }
}
function timing(cases,clock,classes=[SparseArena,SparseArenaV2]){
  const names=['baseline','candidate'],samples=[];
  for(let i=0;i<3;i++)for(const C of classes)verify(cases,execute(C,cases));
  for(let i=0;i<18;i++){
    const order=i%2?[1,0]:[0,1],ns={};
    for(const j of order){const start=clock(),out=execute(classes[j],cases),end=clock();
      assert(Number.isSafeInteger(end-start)&&end>start);verify(cases,out);ns[names[j]]=end-start;}
    samples.push({round:i+1,order:order.map(j=>names[j]),ns});
  }
  const median=v=>{const a=v.slice().sort((x,y)=>x-y);return (a[8]+a[9])/2;};
  return {samples,median_ns:Object.fromEntries(names.map(n=>[n,median(samples.map(s=>s.ns[n]))])),median_paired_speedup:median(samples.map(s=>s.ns.baseline/s.ns.candidate))};
}
if(require.main===module){
  assert.equal(process.argv.length,2);const cases=suite(),result=experiment(cases);
  const origin=process.hrtime.bigint();console.log(JSON.stringify({...result,timing:timing(cases,()=>Number(process.hrtime.bigint()-origin)),node:process.version,platform:process.platform},null,2));
}
module.exports={SparseArenaV2,experiment,suite,timing,tests,checked,plan,execute,verify};
