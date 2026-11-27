// SPDX-License-Identifier: GPL-3.0-or-later
"use strict";

// Structural/arithmetic verification only; not attestation of GPU execution.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SAMPLES = 10000;
const SPEC = [
  ["fragment64","Shader procedural","fragment",0,1,64],
  ["geometry4096","Geometria 3D","geometry",4096,1,0],
  ["geometry8192_blend","Geometria + transparência","geometry",8192,2,0]
];
function need(ok, message) { if (!ok) throw new Error(message); }
function obj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
function close(a,b) {
  return typeof a === "number" && Number.isFinite(a) &&
    Math.abs(a-b) <= Math.max(1e-8, Math.abs(b)*1e-9);
}
function integer(x, max) { return Number.isSafeInteger(x) && x>=0 && x<=max; }
function stats(a) {
  const s=a.slice().sort((x,y)=>x-y), n=s.length;
  return {count:n,mean_ms:a.reduce((x,y)=>x+y,0)/n,
    median_ms:n%2?s[n>>1]:(s[n/2-1]+s[n/2])/2,
    p95_ms:s[Math.ceil(n*.95)-1],p99_ms:s[Math.ceil(n*.99)-1],max_ms:s[n-1]};
}
function checkStats(raw,reported,label) {
  need(Array.isArray(raw)&&raw.length>0&&raw.length<=MAX_SAMPLES,label+": sample count");
  need(raw.every(x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&x<=60000),label+": invalid sample");
  const s=stats(raw);
  need(obj(reported)&&reported.count===s.count,label+": summary count");
  for(const key of ["mean_ms","median_ms","p95_ms","p99_ms","max_ms"])
    need(close(reported[key],s[key]),label+": "+key+" mismatch");
  return s;
}
function verify(d) {
  need(obj(d)&&d.schema_version===2&&d.scope==="independent_webgl2_synthetic_only"&&
    d.workload==="fragment_geometry_blend_v2","unsupported report");
  need([[1280,720],[1920,1080],[2560,1440],[3840,2160]].some(([w,h])=>w===d.width&&h===d.height),"invalid resolution");
  need(d.warmup_ms===2000&&d.requested_measure_ms===8000,"invalid timing configuration");
  need(typeof d.started_utc==="string"&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d.started_utc)&&
    Number.isFinite(Date.parse(d.started_utc))&&new Date(d.started_utc).toISOString()===d.started_utc,"invalid UTC time");
  need(d.renderer_is_unverified===true&&obj(d.renderer),"missing unverified renderer declaration");
  for(const k of ["reported_vendor","reported_renderer"])
    need(typeof d.renderer[k]==="string"&&d.renderer[k].length>0&&d.renderer[k].length<=1024,"invalid renderer field");
  need(d.renderer.unmasked_renderer===null||(typeof d.renderer.unmasked_renderer==="string"&&
    d.renderer.unmasked_renderer.length>0&&d.renderer.unmasked_renderer.length<=1024),"invalid unmasked renderer");
  const unavailable=["vram_bytes","gpu_temperature_c","gpu_utilization_pct","display_present_fps"];
  need(Array.isArray(d.metrics_unavailable)&&d.metrics_unavailable.length===unavailable.length&&
    unavailable.every(k=>d.metrics_unavailable.includes(k)),"unavailable metrics mismatch");
  need(Array.isArray(d.results)&&d.results.length===SPEC.length,"wrong scenario count");
  const result=[];
  for(let i=0;i<SPEC.length;i++){
    const r=d.results[i], expected=SPEC[i], id=expected[0];
    need(obj(r)&&obj(r.scenario)&&["id","name","kind","instances","passes","iterations"].every((k,j)=>r.scenario[k]===expected[j]),"scenario identity/order mismatch");
    const f=checkStats(r.frame_intervals_ms,r.frame_statistics,id+" frame");
    const duration=r.frame_intervals_ms.reduce((a,b)=>a+b,0);
    need(close(r.measured_interval_ms,duration)&&duration>=8000&&
      duration-r.frame_intervals_ms.at(-1)<8000&&duration<=68000,id+": invalid measurement duration");
    need(close(r.raf_hz,1000/f.mean_ms),id+": cadence mismatch");
    const issued=r.gpu_queries_issued, skipped=r.gpu_queries_skipped;
    need(integer(issued,f.count)&&integer(skipped,f.count)&&issued+skipped<=f.count,id+": query counters");
    need(Array.isArray(r.gpu_ms)&&r.gpu_ms.length<=issued,id+": GPU samples");
    const g=r.gpu_ms.length?checkStats(r.gpu_ms,r.gpu_statistics,id+" GPU"):null;
    need(g!==null||r.gpu_statistics===null,id+": GPU summary without samples");
    need(close(r.gpu_coverage,r.gpu_ms.length/f.count),id+": GPU coverage");
    switch(r.gpu_status){
      case "unsupported":
        need(issued===0&&skipped===0&&g===null,id+": unsupported timer inconsistency");break;
      case "disjoint":
        need(g===null,id+": disjoint data retained");break;
      case "complete":
        need(issued===f.count&&skipped===0&&r.gpu_ms.length===issued,id+": false complete status");break;
      case "partial_timeout":
        need(issued+skipped===f.count&&r.gpu_ms.length<issued,id+": impossible timeout");break;
      case "partial":
        need(issued+skipped===f.count&&r.gpu_ms.length<f.count,id+": false partial status");break;
      default: throw new Error(id+": unknown timer status");
    }
    result.push({scenario:id,frame_count:f.count,raf_hz:1000/f.mean_ms,
      frame_p95_ms:f.p95_ms,frame_p99_ms:f.p99_ms,gpu_count:r.gpu_ms.length,
      gpu_median_ms:g?g.median_ms:null,gpu_mean_ms:g?g.mean_ms:null,
      gpu_status:r.gpu_status,gpu_coverage:r.gpu_coverage});
  }
  return {validation:"structural_and_arithmetic_only",width:d.width,height:d.height,
    frame_count:result.reduce((a,b)=>a+b.frame_count,0),
    gpu_count:result.reduce((a,b)=>a+b.gpu_count,0),results:result};
}
function fixture(){
  return {schema_version:2,scope:"independent_webgl2_synthetic_only",workload:"fragment_geometry_blend_v2",
    started_utc:"2026-01-01T00:00:00.000Z",width:1920,height:1080,warmup_ms:2000,requested_measure_ms:8000,
    renderer:{reported_vendor:"synthetic",reported_renderer:"fixture",unmasked_renderer:null},renderer_is_unverified:true,
    metrics_unavailable:["vram_bytes","gpu_temperature_c","gpu_utilization_pct","display_present_fps"],
    results:SPEC.map(([id,name,kind,instances,passes,iterations])=>{
      const f=Array(800).fill(10),g=Array(800).fill(1);
      return {scenario:{id,name,kind,instances,passes,iterations},measured_interval_ms:8000,
        frame_intervals_ms:f,frame_statistics:stats(f),raf_hz:100,gpu_ms:g,gpu_statistics:stats(g),
        gpu_queries_issued:800,gpu_queries_skipped:0,gpu_status:"complete",gpu_coverage:1};
    })};
}
function selfTest(){
  let n=0;
  function pass(name,change){const f=fixture();change(f);verify(f);n++;return name;}
  function fail(name,change){const f=fixture();change(f);let rejected=false;try{verify(f);}catch(e){rejected=true;}need(rejected,"accepted invalid fixture: "+name);n++;}
  pass("valid",()=>{});
  pass("unsupported",d=>{const r=d.results[0];Object.assign(r,{gpu_ms:[],gpu_statistics:null,gpu_queries_issued:0,gpu_status:"unsupported",gpu_coverage:0});});
  pass("disjoint",d=>{const r=d.results[0];Object.assign(r,{gpu_ms:[],gpu_statistics:null,gpu_queries_issued:5,gpu_status:"disjoint",gpu_coverage:0});});
  pass("partial",d=>{const r=d.results[0];r.gpu_ms.pop();r.gpu_statistics=stats(r.gpu_ms);r.gpu_queries_issued--;r.gpu_queries_skipped++;r.gpu_coverage=799/800;r.gpu_status="partial";});
  pass("timeout",d=>{const r=d.results[0];r.gpu_ms.pop();r.gpu_statistics=stats(r.gpu_ms);r.gpu_coverage=799/800;r.gpu_status="partial_timeout";});
  fail("missing scenario",d=>d.results.pop());
  fail("duplicate scenario",d=>d.results[2]=d.results[1]);
  fail("tampered median",d=>d.results[0].frame_statistics.median_ms=11);
  fail("tampered p99",d=>d.results[0].gpu_statistics.p99_ms=2);
  fail("tampered duration",d=>d.results[0].measured_interval_ms=8100);
  fail("tampered cadence",d=>d.results[0].raf_hz=240);
  fail("zero sample",d=>d.results[0].frame_intervals_ms[0]=0);
  fail("NaN sample",d=>d.results[0].gpu_ms[0]=NaN);
  fail("string sample",d=>d.results[0].gpu_ms[0]="1");
  fail("false coverage",d=>d.results[0].gpu_coverage=.5);
  fail("false complete",d=>{const r=d.results[0];r.gpu_ms.pop();r.gpu_statistics=stats(r.gpu_ms);r.gpu_coverage=799/800;});
  fail("disjoint with data",d=>d.results[0].gpu_status="disjoint");
  fail("false unsupported",d=>d.results[0].gpu_status="unsupported");
  fail("impossible timeout",d=>d.results[0].gpu_status="partial_timeout");
  fail("unsupported resolution",d=>d.width=1234);
  fail("unavailable metric omitted",d=>d.metrics_unavailable.pop());
  fail("invalid date",d=>d.started_utc="2026-02-31T00:00:00.000Z");
  fail("excess query count",d=>d.results[0].gpu_queries_issued=801);
  fail("invalid renderer trust",d=>d.renderer_is_unverified=false);
  fail("oversized samples",d=>d.results[0].frame_intervals_ms=Array(MAX_SAMPLES+1).fill(1));
  fail("unrecognized timer",d=>d.results[0].gpu_status="unknown");
  return n;
}

function main(){
  const fs=require("node:fs");
  try{
    const args=process.argv.slice(2);
    if(args.length===1&&args[0]==="--self-test"){
      console.log("graphics verifier: "+selfTest()+" scenarios passed");return;
    }
    if(args.length===1&&args[0]==="--fixture"){
      console.log(JSON.stringify(fixture()));return;
    }
    need(args.length===1,"usage: node nexusvi_graphics_verify.js REPORT.json | --self-test | --fixture");
    const fd=fs.openSync(args[0],"r");
    let raw;
    try{
      need(fs.fstatSync(fd).isFile(),"expected regular file");
      const buf=Buffer.alloc(MAX_BYTES+1);let n=0;
      while(n<buf.length){const m=fs.readSync(fd,buf,n,buf.length-n,null);if(!m)break;n+=m;}
      need(n<=MAX_BYTES,"input exceeds 4 MiB");
      raw=new TextDecoder("utf-8",{fatal:true}).decode(buf.subarray(0,n));
    }finally{fs.closeSync(fd);}
    console.log(JSON.stringify(verify(JSON.parse(raw)),null,2));
  }catch(e){console.error("Rejected: "+e.message);process.exitCode=1;}
}
if(require.main===module)main();
module.exports={verify,selfTest};
