// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Logical first-fit index: no real memory, GPU or compatibility-runtime access.
const assert=require('node:assert/strict');
const {trace}=require('./nexusvi_fragmentation.js');
class IndexedArena {
  constructor(cap){
    assert(Number.isInteger(cap)&&cap>0&&cap<=16384);
    this.cap=cap;this.base=1;while(this.base<cap)this.base*=2;
    this.tree=new Int32Array(this.base*2);
    this.starts=new Map();this.ends=new Map();this.live=new Map();
    this.visits=0;this.leaves=0;this.updates=0;this.add(0,cap);
  }
  update(s,n){let i=this.base+s;this.tree[i]=n;this.updates++;
    while(i>1){i>>=1;this.tree[i]=Math.max(this.tree[2*i],this.tree[2*i+1]);this.updates++;}}
  add(s,e){assert(s>=0&&s<e&&e<=this.cap&&!this.starts.has(s)&&!this.ends.has(e));
    this.starts.set(s,e);this.ends.set(e,s);this.update(s,e-s);}
  remove(s){const e=this.starts.get(s);assert(e!==undefined);this.starts.delete(s);this.ends.delete(e);this.update(s,0);return e;}
  search(i,len,align){
    this.visits++;
    if(this.tree[i]<len)return -1;
    if(i>=this.base){this.leaves++;const s=i-this.base,e=this.starts.get(s);
      assert(e!==undefined);return Math.ceil(s/align)*align+len<=e?s:-1;}
    const left=this.search(i*2,len,align);
    return left>=0?left:this.search(i*2+1,len,align);
  }
  allocate(id,len,align){
    assert(!this.live.has(id)&&Number.isInteger(len)&&len>0&&Number.isInteger(align)&&align>0&&align<=64&&(align&(align-1))===0);
    const s=this.search(1,len,align);if(s<0)return null;
    const e=this.remove(s),p=Math.ceil(s/align)*align;
    if(s<p)this.add(s,p);if(p+len<e)this.add(p+len,e);
    this.live.set(id,[p,p+len]);return p;
  }
  release(id){
    if(!this.live.has(id))return false;
    let [s,e]=this.live.get(id);this.live.delete(id);
    const left=this.ends.get(s);if(left!==undefined){this.remove(left);s=left;}
    if(this.starts.has(e))e=this.remove(e);
    this.add(s,e);return true;
  }
  check(bits){
    // Independently reconstruct every free interval from byte occupancy.
    let count=0,largest=0;
    for(let s=0;s<bits.length;){if(bits[s]){s++;continue;}
      let e=s+1;while(e<bits.length&&!bits[e])e++;
      assert.equal(this.starts.get(s),e);assert.equal(this.ends.get(e),s);
      assert.equal(this.tree[this.base+s],e-s);largest=Math.max(largest,e-s);count++;s=e;}
    assert.equal(this.starts.size,count);assert.equal(this.ends.size,count);assert.equal(this.tree[1],largest);
    // Verify the live ranges and their exact coverage, independent of free index.
    let liveBytes=0;for(const [s,e] of this.live.values()){assert(bits.subarray(s,e).every(x=>x===1));liveBytes+=e-s;}
    let used=0;for(const x of bits)used+=x;assert.equal(liveBytes,used);
  }
}
function reference(bits,len,align){
  let probes=0;
  for(let s=0;s<bits.length;){if(bits[s]){s++;continue;}
    let e=s+1;while(e<bits.length&&!bits[e])e++;probes++;
    const p=Math.ceil(s/align)*align;if(p+len<=e)return {offset:p,probes};s=e;}
  return {offset:null,probes};
}
function replay(requests,cap){
  const a=new IndexedArena(cap),bits=new Uint8Array(cap),expires=new Map();
  let accepted=0,failed=0,linearProbes=0;
  function release(id){const [s,e]=a.live.get(id);assert(bits.subarray(s,e).every(x=>x===1));bits.fill(0,s,e);assert(a.release(id));}
  for(const r of requests){
    for(const id of expires.get(r.id)||[])release(id);expires.delete(r.id);
    const expected=reference(bits,r.len,r.align);linearProbes+=expected.probes;
    const p=a.allocate(r.id,r.len,r.align);assert.equal(p,expected.offset);
    if(p===null)failed++;
    else{accepted++;assert(bits.subarray(p,p+r.len).every(x=>x===0));bits.fill(1,p,p+r.len);
      if(!expires.has(r.end))expires.set(r.end,[]);expires.get(r.end).push(r.id);}
    a.check(bits);
  }
  for(const id of [...a.live.keys()])release(id);
  a.check(bits);assert.equal(a.tree[1],cap);assert.equal(a.starts.size,1);
  // Verify every tree leaf and internal node after final reclamation.
  for(let i=0;i<a.base;i++)assert.equal(a.tree[a.base+i],i===0?cap:0);
  for(let i=a.base-1;i>0;i--)assert.equal(a.tree[i],Math.max(a.tree[2*i],a.tree[2*i+1]));
  return {accepted,failed,linearProbes,indexVisits:a.visits,indexLeaves:a.leaves,updateWrites:a.updates,reclaimed:cap,indexBytes:a.tree.byteLength};
}
function tests(){
  const a=new IndexedArena(65);
  assert.equal(a.allocate(0,3,1),0);assert.equal(a.allocate(1,8,16),16);
  assert(a.release(0));assert(a.release(1));assert.equal(a.tree[1],65);assert(!a.release(1));
  // First interval has enough raw bytes but cannot satisfy alignment.
  const b=new IndexedArena(64);
  for(const [id,n] of [1,8,7,16,32].entries())assert(b.allocate(id,n,1)!==null);
  assert(b.release(1));assert(b.release(3));
  assert.equal(b.allocate(5,8,16),16);
  assert.equal(b.allocate(6,64,1),null);
  // A non-power-of-two capacity must not allocate padding leaves.
  const c=new IndexedArena(33);assert.equal(c.allocate(0,33,1),0);assert.equal(c.allocate(1,1,1),null);
  assert(c.release(0));assert.equal(c.tree[1],33);
  // Highly fragmented prefix, then a single adequate interval.
  const req=[];for(let i=0;i<128;i++)req.push({id:i,len:1,align:1,end:i%2===0?128:1000});
  req.push({id:128,len:64,align:1,end:1000});
  const r=replay(req,256);assert.equal(r.accepted,129);
  return 4;
}
function experiment(){
  const results=[];
  for(const cap of [4096,8192])for(const profile of ['small','mixed','large'])for(const seed of [271828,314159])
    results.push({cap,profile,seed,...replay(trace(seed,profile,800),cap)});
  return {scope:'independent_indexed_logical_arena_only',tests:tests(),results};
}
if(require.main===module){assert.equal(process.argv.length,2);console.log(JSON.stringify(experiment(),null,2));}
module.exports={experiment,tests,replay};
