// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical AVL model; eliminate refresh immediately before rotation.
const assert=require('node:assert/strict');
const {SparseArenaV2,suite,checked,plan,timing}=require('./nexusvi_sparse_arena_v2.js');
const height=n=>n?n.h:0;
class SparseArenaV3 extends SparseArenaV2 {
  balance(n){
    // Child metadata is current after recursive mutation. Only n is stale.
    const d=height(n.l)-height(n.r);
    if(d>1){
      if(height(n.l.l)<height(n.l.r))n.l=this.left(n.l);
      return this.right(n);
    }
    if(d< -1){
      if(height(n.r.r)<height(n.r.l))n.r=this.right(n.r);
      return this.left(n);
    }
    return this.refresh(n);
  }
}
function compare(p){
  const baseline=checked(SparseArenaV2,p),candidate=checked(SparseArenaV3,p);
  for(const k of Object.keys(baseline))if(k!=='recalculations')assert.equal(candidate[k],baseline[k]);
  const saved=baseline.recalculations-candidate.recalculations;
  assert(saved>=0&&saved<=baseline.rotations);
  return {baseline,candidate};
}
function tests(){
  // Force all four rotation shapes on separated free intervals, then inspect
  // the exact tree and metadata with an independent byte occupancy model.
  for(const order of [[2,1,0],[0,1,2],[2,0,1],[0,2,1]]){
    const a=new SparseArenaV3(8),bits=new Uint8Array(8);
    for(let i=0;i<8;i++){assert.equal(a.allocate(i,1,1),i);bits[i]=1;}
    for(const i of order){assert(a.release(i*2));bits[i*2]=0;a.check(bits);}
    assert.equal(a.root.s,2);assert.equal(a.rotations,order[1]===1?1:2);
    for(const id of [...a.live.keys()]){assert(a.release(id));bits[id]=0;a.check(bits);}
    assert.equal(a.nodes,1);
  }
  const p=plan(65,[{id:0,len:3,align:1,end:2},{id:1,len:8,align:16,end:3},{id:2,len:16,align:16,end:4},{id:3,len:65,align:1,end:4}]);
  compare(p);
  const requests=[];for(let i=0;i<128;i++)requests.push({id:i,len:1,align:1,end:i%2===0?128:1000});
  requests.push({id:128,len:64,align:1,end:1000});compare(plan(256,requests));
  return 6;
}
function experiment(cases=suite()){
  return {scope:'independent_sparse_avl_refresh_elimination_only',tests:tests(),results:cases.map(c=>({cap:c.cap,profile:c.profile,seed:c.seed,...compare(c.plan)}))};
}
function measure(cases,clock){return timing(cases,clock,[SparseArenaV2,SparseArenaV3]);}
if(require.main===module){
  assert.equal(process.argv.length,2);const cases=suite(),result=experiment(cases);
  const origin=process.hrtime.bigint();
  console.log(JSON.stringify({...result,timing:measure(cases,()=>Number(process.hrtime.bigint()-origin)),node:process.version,platform:process.platform},null,2));
}
module.exports={SparseArenaV3,experiment,measure,tests};
