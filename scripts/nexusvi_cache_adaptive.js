// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent adaptive segmented logical cache; ghost history contains keys only.
const assert=require('node:assert/strict');
const {replay:fixed,trace}=require('./nexusvi_cache_policies.js');
class AdaptiveCache {
  constructor(cap){
    assert(Number.isInteger(cap)&&cap>=2&&cap<=4096);
    this.cap=cap;this.target=Math.floor(cap/2);
    this.p=new Map();this.q=new Map();this.g=new Map();
    this.ghostHits=0;this.adjustments=0;this.peakGhost=0;
    this.minTarget=this.target;this.maxTarget=this.target;
  }
  trimProtected(){
    while(this.q.size>this.target){const k=this.q.keys().next().value;this.q.delete(k);this.p.set(k,true);}
  }
  access(k){
    assert(Number.isSafeInteger(k)&&k>=0);
    if(this.q.has(k)){this.q.delete(k);this.q.set(k,true);return {hit:true,evicted:null};}
    if(this.p.has(k)){this.p.delete(k);this.q.set(k,true);this.trimProtected();return {hit:true,evicted:null};}
    const ghost=this.g.has(k);
    if(ghost){
      const reused=this.g.get(k);this.g.delete(k);this.ghostHits++;
      const next=Math.max(1,Math.min(this.cap-1,this.target+(reused?1:-1)));
      if(next!==this.target)this.adjustments++;
      this.target=next;this.minTarget=Math.min(this.minTarget,next);this.maxTarget=Math.max(this.maxTarget,next);
      this.trimProtected();
    }
    let evicted=null;
    if(this.p.size+this.q.size===this.cap){
      assert(this.p.size>0);evicted=this.p.keys().next().value;
      const reused=this.p.get(evicted);this.p.delete(evicted);this.g.set(evicted,reused);
      if(this.g.size>this.cap)this.g.delete(this.g.keys().next().value);
      this.peakGhost=Math.max(this.peakGhost,this.g.size);
    }
    if(ghost){this.q.set(k,true);this.trimProtected();}else this.p.set(k,false);
    return {hit:false,evicted};
  }
  snapshot(){return {target:this.target,p:[...this.p],q:[...this.q.keys()],g:[...this.g]};}
}
// Separate array model. Ghost entries are [key, previously reused].
function reference(cap,s,k){
  const i=s.q.indexOf(k);
  if(i>=0){s.q.push(s.q.splice(i,1)[0]);return {hit:true,evicted:null};}
  const j=s.p.findIndex(x=>x[0]===k);
  if(j>=0){
    s.p.splice(j,1);s.q.push(k);
    if(s.q.length>s.target)s.p.push([s.q.shift(),true]);
    return {hit:true,evicted:null};
  }
  const h=s.g.findIndex(x=>x[0]===k);
  if(h>=0){
    const [,reused]=s.g.splice(h,1)[0];
    if(reused&&s.target<cap-1)s.target++;
    if(!reused&&s.target>1)s.target--;
    while(s.q.length>s.target)s.p.push([s.q.shift(),true]);
  }
  let evicted=null;
  if(s.p.length+s.q.length===cap){
    const old=s.p.shift();evicted=old[0];s.g.push(old);
    if(s.g.length>cap)s.g.shift();
  }
  if(h>=0){
    s.q.push(k);if(s.q.length>s.target)s.p.push([s.q.shift(),true]);
  }else s.p.push([k,false]);
  return {hit:false,evicted};
}
function replay(cap,keys){
  const c=new AdaptiveCache(cap),s={target:Math.floor(cap/2),p:[],q:[],g:[]};
  let hits=0,evictions=0;
  for(const k of keys){
    const want=reference(cap,s,k),got=c.access(k);assert.deepEqual(got,want);assert.deepEqual(c.snapshot(),s);
    const live=[...s.p.map(x=>x[0]),...s.q],all=[...live,...s.g.map(x=>x[0])];
    assert(live.length<=cap&&s.g.length<=cap&&s.q.length<=s.target);
    assert(s.target>=1&&s.target<cap&&new Set(all).size===all.length);
    if(got.hit)hits++;if(got.evicted!==null)evictions++;
  }
  return {requests:keys.length,hits,misses:keys.length-hits,evictions,ghost_hits:c.ghostHits,
    adjustments:c.adjustments,peak_ghost_keys:c.peakGhost,min_target:c.minTarget,max_target:c.maxTarget};
}
function tests(){
  const c=new AdaptiveCache(4);
  for(const k of [0,1,2,3,4,0])c.access(k);
  assert.equal(c.target,1);assert.equal(c.ghostHits,1);
  for(const k of [1,5,6,7,8,0])c.access(k);
  assert.equal(c.target,2);
  const d=new AdaptiveCache(2);for(let i=0;i<20;i++)d.access(i);
  assert.equal(d.g.size,2);assert.equal(d.p.size+d.q.size,2);
  const e=replay(4,[0,0,1,1,2,2,3,3,4,4,0,0]);assert.equal(e.hits,6);
  let histories=0;
  for(const cap of [2,3,4])for(let n=0;n<15625;n++){
    let x=n;const seq=[];for(let j=0;j<6;j++){seq.push(x%5);x=Math.floor(x/5);}
    replay(cap,seq);histories++;
  }
  return {crafted:4,exhaustive_histories:histories};
}
function experiment(){
  const test=tests(),results=[];
  for(const cap of [32,128])for(const profile of ['uniform','hot_scan','phase_shift','cyclic']){
    const seeds=profile==='cyclic'?[104729,130363]:[104729,130363,271828,314159];
    for(const seed of seeds){
      const keys=trace(cap,profile,seed);
      results.push({cap,profile,seed,group:seed===104729||seed===130363?'prior':'additional',
        policies:{fifo:fixed(cap,'fifo',keys),lru:fixed(cap,'lru',keys),slru:fixed(cap,'slru',keys),adaptive:replay(cap,keys)}});
    }
  }
  return {scope:'independent_adaptive_logical_cache_only',tests:test,results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={AdaptiveCache,replay,tests,experiment};
