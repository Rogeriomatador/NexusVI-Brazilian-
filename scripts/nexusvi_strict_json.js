// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
// Validate JSON member uniqueness before native parsing. Independent report input.
const MAX_CHARS=4*1024*1024, MAX_DEPTH=64, MAX_TOKENS=500000;
function parseStrict(raw){
  if(typeof raw!=='string'||raw.length>MAX_CHARS)throw Error('JSON input too large or invalid');
  let i=0,tokens=0;
  const whitespace=/[ \t\r\n]*/y;
  const string=/"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const number=/-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  function fail(reason){throw Error(reason+' at character '+i);}
  function skip(){whitespace.lastIndex=i;whitespace.exec(raw);i=whitespace.lastIndex;}
  function count(){if(++tokens>MAX_TOKENS)fail('JSON token limit');}
  function str(){string.lastIndex=i;const m=string.exec(raw);if(!m)fail('invalid JSON string');i=string.lastIndex;return JSON.parse(m[0]);}
  function value(depth){
    if(depth>MAX_DEPTH)fail('JSON nesting limit');count();skip();
    if(raw[i]==='{'){
      i++;skip();if(raw[i]==='}'){i++;return;}
      const seen=new Set();
      for(;;){
        skip();count();const key=str();
        if(seen.has(key))fail('duplicate JSON member');
        seen.add(key);skip();if(raw[i++]!==':')fail('expected colon');
        value(depth+1);skip();const c=raw[i++];
        if(c==='}')return;if(c!==',')fail('expected comma or object end');
      }
    }
    if(raw[i]==='['){
      i++;skip();if(raw[i]===']'){i++;return;}
      for(;;){value(depth+1);skip();const c=raw[i++];if(c===']')return;if(c!==',')fail('expected comma or array end');}
    }
    if(raw[i]==='"'){str();return;}
    for(const literal of ['true','false','null'])if(raw.startsWith(literal,i)){i+=literal.length;return;}
    number.lastIndex=i;const m=number.exec(raw);
    if(!m)fail('invalid JSON value');
    if(!Number.isFinite(Number(m[0])))fail('nonfinite JSON number');
    i=number.lastIndex;
  }
  value(0);skip();if(i!==raw.length)fail('trailing JSON data');
  return JSON.parse(raw);
}
function tests(){
  const good=['{}','[]','null',' -0.125e+2 \r\n','{"a":1,"b":{"a":2}}','[{"a":1},{"a":2}]','{"__proto__":1,"constructor":2}','{"a\\\\b":"escaped \\" quote","\\u0062":true}','{"😀":1,"é":2}'];
  for(const raw of good){if(JSON.stringify(parseStrict(raw))!==JSON.stringify(JSON.parse(raw)))throw Error('valid case mismatch');}
  const bad=['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"😀":1,"\\ud83d\\ude00":2}','{"outer":[{"x":0,"x":1}]}','{"__proto__":1,"__proto__":2}','{"a":1,}','[1,]','{"a" 1}','{"a":01}','[truefalse]','"\\q"','"a\nb"','1e999','true false','', '['.repeat(65)+'0'+']'.repeat(65), '['+'0,'.repeat(500000)+'0]', ' '.repeat(MAX_CHARS+1)];
  for(const raw of bad){let rejected=false;try{parseStrict(raw);}catch(e){rejected=true;}if(!rejected)throw Error('invalid case accepted');}
  return {valid:good.length,rejected:bad.length};
}
if(require.main===module){const r=tests();console.log('strict JSON: '+r.valid+' valid, '+r.rejected+' rejected');}
module.exports={parseStrict,tests};
