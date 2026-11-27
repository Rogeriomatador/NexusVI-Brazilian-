// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Independent logical allocator. AVL nodes correspond only to free intervals.
const assert=require('node:assert/strict');
const {trace}=require('./nexusvi_fragmentation.js');
const height=n=>n?n.h:0, max=n=>n?n.max:0;
class SparseArena {
  constructor(cap){
    assert(Number.isInteger(cap)&&cap>0&&cap<=16384);
    this.cap=cap;this.root=null;this.live=new Map();this.ends=new Map();
    this.visits=0;this.candidates=0;this.mutations=0;this.recalculations=0;this.rotations=0;
    this.nodes=0;this.peakNodes=0;this.peakHeight=0;this.add(0,cap);
  }
  refresh(n){this.recalculations++;n.h=1+Math.max(height(n.l),height(n.r));n.max=Math.max(n.e-n.s,max(n.l),max(n.r));return n;}
  left(n){const r=n.r;n.r=r.l;r.l=n;this.rotations++;this.refresh(n);return this.refresh(r);}
  right(n){const l=n.l;n.l=l.r;l.r=n;this.rotations++;this.refresh(n);return this.refresh(l);}
  balance(n){
    this.refresh(n);const d=height(n.l)-height(n.r);
    if(d>1){if(height(n.l.l)<height(n.l.r))n.l=this.left(n.l);return this.right(n);}
    if(d< -1){if(height(n.r.r)<height(n.r.l))n.r=this.right(n.r);return this.left(n);}
    return n;
  }
  insert(n,s,e){
    this.mutations++;if(!n)return {s,e,h:1,max:e-s,l:null,r:null};
    assert(n.s!==s);if(s<n.s)n.l=this.insert(n.l,s,e);else n.r=this.insert(n.r,s,e);
    return this.balance(n);
  }
  erase(n,s){
    this.mutations++;assert(n);
    if(s<n.s)n.l=this.erase(n.l,s);
    else if(s>n.s)n.r=this.erase(n.r,s);
    else{
      if(!n.l)return n.r;if(!n.r)return n.l;
      let q=n.r;this.mutations++;while(q.l){q=q.l;this.mutations++;}
      n.s=q.s;n.e=q.e;n.r=this.erase(n.r,q.s);
    }
    return this.balance(n);
  }
  find(s){let n=this.root;while(n){this.mutations++;if(s===n.s)return n;n=s<n.s?n.l:n.r;}return null;}
  add(s,e){
    assert(s>=0&&s<e&&e<=this.cap&&!this.ends.has(e));
    this.root=this.insert(this.root,s,e);this.ends.set(e,s);this.nodes++;
    this.peakNodes=Math.max(this.peakNodes,this.nodes);this.peakHeight=Math.max(this.peakHeight,height(this.root));
  }
  remove(s){const n=this.find(s);assert(n);const e=n.e;this.root=this.erase(this.root,s);this.ends.delete(e);this.nodes--;return e;}
  search(n,len,align){
    if(!n)return null;this.visits++;
    if(n.max<len)return null;
    const left=this.search(n.l,len,align);if(left!==null)return left;
    if(n.e-n.s>=len){this.candidates++;if(Math.ceil(n.s/align)*align+len<=n.e)return n.s;}
    return this.search(n.r,len,align);
  }
  allocate(id,len,align){
    assert(!this.live.has(id)&&Number.isInteger(len)&&len>0&&Number.isInteger(align)&&align>0&&align<=64&&(align&(align-1))===0);
    const s=this.search(this.root,len,align);if(s===null)return null;
    const e=this.remove(s),p=Math.ceil(s/align)*align;
    if(s<p)this.add(s,p);if(p+len<e)this.add(p+len,e);this.live.set(id,[p,p+len]);return p;
  }
  release(id){
    if(!this.live.has(id))return false;
    let [s,e]=this.live.get(id);this.live.delete(id);
    const l=this.ends.get(s);if(l!==undefined){this.remove(l);s=l;}
    if(this.find(e))e=this.remove(e);this.add(s,e);return true;
  }
  check(bits){
    const free=[];
    function walk(n,lo,hi){
      if(!n)return [0,0];assert(n.s>lo&&n.s<hi&&n.e>n.s);
      const [lh,lm]=walk(n.l,lo,n.s);free.push([n.s,n.e]);
      const [rh,rm]=walk(n.r,n.s,hi);assert(Math.abs(lh-rh)<=1);
      assert.equal(n.h,Math.max(lh,rh)+1);assert.equal(n.max,Math.max(lm,rm,n.e-n.s));return [n.h,n.max];
    }
    walk(this.root,-1,this.cap);
    const expected=[];for(let s=0;s<bits.length;){if(bits[s]){s++;continue;}let e=s+1;while(e<bits.length&&!bits[e])e++;expected.push([s,e]);s=e;}
    assert.deepEqual(free,expected);assert.equal(this.nodes,free.length);assert.equal(this.ends.size,free.length);
    for(const [s,e] of free)assert.equal(this.ends.get(e),s);
    let used=0;for(const x of bits)used+=x;
    let liveBytes=0;for(const [s,e] of this.live.values()){assert(bits.subarray(s,e).every(x=>x===1));liveBytes+=e-s;}assert.equal(liveBytes,used);
  }
}
function reference(bits,len,align){
  let probes=0;for(let s=0;s<bits.length;){if(bits[s]){s++;continue;}let e=s+1;while(e<bits.length&&!bits[e])e++;probes++;
    const p=Math.ceil(s/align)*align;if(p+len<=e)return {offset:p,probes};s=e;}
  return {offset:null,probes};
}
function replay(requests,cap){
  const a=new SparseArena(cap),bits=new Uint8Array(cap),expires=new Map();let accepted=0,failed=0,linearProbes=0;
  function release(id){const [s,e]=a.live.get(id);assert(bits.subarray(s,e).every(x=>x===1));bits.fill(0,s,e);assert(a.release(id));}
  for(const r of requests){
    for(const id of expires.get(r.id)||[])release(id);expires.delete(r.id);
    const expected=reference(bits,r.len,r.align);linearProbes+=expected.probes;
    const p=a.allocate(r.id,r.len,r.align);assert.equal(p,expected.offset);
    if(p===null)failed++;else{accepted++;assert(bits.subarray(p,p+r.len).every(x=>x===0));bits.fill(1,p,p+r.len);if(!expires.has(r.end))expires.set(r.end,[]);expires.get(r.end).push(r.id);}
    a.check(bits);
  }
  for(const id of [...a.live.keys()])release(id);
  a.check(bits);assert.equal(a.nodes,1);assert.equal(a.root.s,0);assert.equal(a.root.e,cap);
  return {accepted,failed,linearProbes,indexVisits:a.visits,candidates:a.candidates,mutationVisits:a.mutations,recalculations:a.recalculations,rotations:a.rotations,peakNodes:a.peakNodes,peakHeight:a.peakHeight,reclaimed:cap};
}
function tests(){
  const a=new SparseArena(65);assert.equal(a.allocate(0,3,1),0);assert.equal(a.allocate(1,8,16),16);assert(a.release(0));assert(a.release(1));assert(!a.release(1));a.check(new Uint8Array(65));
  const b=new SparseArena(64);for(const [id,n] of [1,8,7,16,32].entries())assert(b.allocate(id,n,1)!==null);assert(b.release(1));assert(b.release(3));assert.equal(b.allocate(5,8,16),16);assert.equal(b.allocate(6,64,1),null);
  const c=new SparseArena(33);assert.equal(c.allocate(0,33,1),0);assert.equal(c.allocate(1,1,1),null);assert(c.release(0));c.check(new Uint8Array(33));
  // Monotonic freeing in both directions exercises rotations and two-sided merge.
  for(const reverse of [false,true]){
    const a=new SparseArena(256),bits=new Uint8Array(256);
    for(let i=0;i<256;i++){assert.equal(a.allocate(i,1,1),i);bits[i]=1;}
    const even=Array.from({length:128},(_,i)=>2*i);if(reverse)even.reverse();
    for(const i of even){assert(a.release(i));bits[i]=0;a.check(bits);}
    assert.equal(a.nodes,128);assert(a.rotations>0);
    for(let i=1;i<256;i+=2){assert(a.release(i));bits[i]=0;a.check(bits);}
    assert.equal(a.nodes,1);
  }
  const req=[];for(let i=0;i<128;i++)req.push({id:i,len:1,align:1,end:i%2===0?128:1000});req.push({id:128,len:64,align:1,end:1000});assert.equal(replay(req,256).accepted,129);
  return 6;
}
function experiment(){
  const results=[];for(const cap of [4096,8192])for(const profile of ['small','mixed','large'])for(const seed of [271828,314159])results.push({cap,profile,seed,...replay(trace(seed,profile,800),cap)});
  return {scope:'independent_sparse_logical_arena_only',tests:tests(),results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={experiment,replay,tests};
