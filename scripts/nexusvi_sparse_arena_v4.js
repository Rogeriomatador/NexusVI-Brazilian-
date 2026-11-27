// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical arena. V2 base: extract successor in a single traversal.
const assert=require('node:assert/strict');
const {SparseArenaV2,suite,checked,plan,timing}=require('./nexusvi_sparse_arena_v2.js');
class SparseArenaV4 extends SparseArenaV2 {
  takeMin(n,target){
    this.mutations++;
    if(!n.l){target.s=n.s;target.e=n.e;return n.r;}
    n.l=this.takeMin(n.l,target);
    return this.balance(n);
  }
  erase(n,s){
    this.mutations++;assert(n);
    if(s<n.s)n.l=this.erase(n.l,s);
    else if(s>n.s)n.r=this.erase(n.r,s);
    else{
      if(!n.l)return n.r;
      if(!n.r)return n.l;
      n.r=this.takeMin(n.r,n);
    }
    return this.balance(n);
  }
}
function compare(p){
  const baseline=checked(SparseArenaV2,p),candidate=checked(SparseArenaV4,p);
  for(const k of Object.keys(baseline))if(k!=='mutations')assert.equal(candidate[k],baseline[k]);
  assert(candidate.mutations<=baseline.mutations);
  return {baseline,candidate};
}
// Exercise removal of an interior node, independent of first-fit selection.
// Build separated one-byte free ranges using ordinary releases; remove exactly
// one range, mark it occupied, and verify the complete partition and AVL state.
function deletionCase(order,target,successor,rightChild){
  for(const C of [SparseArenaV2,SparseArenaV4]){
    const a=new C(32),bits=new Uint8Array(32);
    for(let i=0;i<32;i++){assert.equal(a.allocate(i,1,1),i);bits[i]=1;}
    for(const i of order){assert(a.release(i));bits[i]=0;a.check(bits);}
    const n=a.find(target);assert(n&&n.l&&n.r);
    let q=n.r;while(q.l)q=q.l;
    assert.equal(q.s,successor);assert.equal(q.r?q.r.s:null,rightChild);
    const old=a.mutations;a.removeKnown(target,target+1);
    const cost=a.mutations-old;
    a.live.set(target,[target,target+1]);bits[target]=1;a.check(bits);
    assert(cost>0);
    for(const id of [...a.live.keys()]){assert(a.release(id));bits[id]=0;a.check(bits);}
    assert.equal(a.nodes,1);
  }
}
function tests(){
  deletionCase([8,4,12],8,12,null);
  deletionCase([8,4,12,14],8,12,14);
  deletionCase([16,8,24,4,12,20,28],16,20,null);
  deletionCase([16,8,24,4,12,20,28,22],16,20,22);
  const p=plan(65,[{id:0,len:3,align:1,end:2},{id:1,len:8,align:16,end:3},{id:2,len:16,align:16,end:4},{id:3,len:65,align:1,end:4}]);compare(p);
  const requests=[];for(let i=0;i<128;i++)requests.push({id:i,len:1,align:1,end:i%2===0?128:1000});
  requests.push({id:128,len:64,align:1,end:1000});compare(plan(256,requests));
  return 6;
}
function experiment(cases=suite()){
  return {scope:'independent_sparse_avl_successor_extraction_only',tests:tests(),results:cases.map(c=>({cap:c.cap,profile:c.profile,seed:c.seed,...compare(c.plan)}))};
}
function measure(cases,clock){return timing(cases,clock,[SparseArenaV2,SparseArenaV4]);}
if(require.main===module){
  assert.equal(process.argv.length,2);const cases=suite(),result=experiment(cases);
  const origin=process.hrtime.bigint();
  console.log(JSON.stringify({...result,timing:measure(cases,()=>Number(process.hrtime.bigint()-origin)),node:process.version,platform:process.platform},null,2));
}
module.exports={SparseArenaV4,experiment,measure,tests};
