// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent synthetic batch cost analysis; no physical timing claims.
const assert=require('node:assert/strict');
const {experiment}=require('./nexusvi_batch_adaptive.js');
const names=['fixed16','fixed64','adaptive'];
function cost(v,w){
  let c=0n;
  for(const k of ['writes','reads','lagUpdates']){
    assert(Number.isSafeInteger(v[k])&&v[k]>=0);
    assert(Number.isSafeInteger(w[k])&&w[k]>=0);
    c+=BigInt(v[k])*BigInt(w[k]);
  }
  assert(Object.values(w).some(x=>x>0));return c;
}
function winners(p,w){
  const c=names.map(n=>cost(p[n],w)),min=c.reduce((a,b)=>a<b?a:b);
  return names.filter((n,i)=>c[i]===min);
}
function summarize(results){
  const out=[];
  for(const profile of ['uniform','hot','repeated','mixed']){
    const rows=results.filter(r=>r.profile===profile);assert.equal(rows.length,3);
    const p=Object.fromEntries(names.map(n=>[n,Object.fromEntries(['writes','reads','lagUpdates'].map(k=>[k,rows.reduce((s,r)=>s+r.policies[n][k],0)]))]));
    const wins=Object.fromEntries(names.map(n=>[n,0]));let ties=0,scenarios=0;
    for(const writes of [1,16,256])for(const reads of [0,1,16])for(const lagUpdates of [0,1,4,16]){
      const v=winners(p,{writes,reads,lagUpdates});scenarios++;
      if(v.length===1)wins[v[0]]++;else ties++;
    }
    assert.equal(Object.values(wins).reduce((a,b)=>a+b,0)+ties,scenarios);
    out.push({profile,wins,ties,scenarios});
  }return out;
}
function tests(){
  const p={fixed16:{writes:4,reads:4,lagUpdates:1},fixed64:{writes:1,reads:1,lagUpdates:4},adaptive:{writes:2,reads:2,lagUpdates:2}};
  assert.deepEqual(winners(p,{writes:1,reads:0,lagUpdates:0}),['fixed64']);
  assert.deepEqual(winners(p,{writes:0,reads:0,lagUpdates:1}),['fixed16']);
  assert.deepEqual(winners(p,{writes:1,reads:0,lagUpdates:1}),['adaptive']);
  assert.deepEqual(winners(p,{writes:2,reads:0,lagUpdates:1}),['fixed64','adaptive']);
  assert.equal(cost({writes:Number.MAX_SAFE_INTEGER,reads:0,lagUpdates:0},{writes:2,reads:0,lagUpdates:0}),18014398509481982n);
  return 5;
}
if(require.main===module)console.log(JSON.stringify({scope:'independent_batch_cost_sensitivity',tests:tests(),groups:summarize(experiment().results)},null,2));
module.exports={tests,summarize};
