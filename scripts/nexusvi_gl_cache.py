# SPDX-License-Identifier: GPL-3.0-or-later
"""Original in-memory program-binary roundtrip and cache identity control."""
import ctypes as C
import hashlib
import json
import time
from nexusvi_egl_control import bind, run, I, U, P, W, H
from nexusvi_gl_framebuffer import all_tests

MAX_BINARY = 8 * 1024 * 1024


def key(identity, stages):
    return hashlib.sha256(json.dumps([identity, stages], separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


def envelope(k, fmt, blob):
    return (k, fmt, hashlib.sha256(blob).digest(), blob)


def checked(entry, expected, formats):
    k, fmt, digest, blob = entry
    if k != expected or fmt not in formats or not 0 < len(blob) <= MAX_BINARY or hashlib.sha256(blob).digest() != digest:
        raise ValueError('cache entry rejected')
    return fmt, blob


def cache(g, renderer):
    def gl(name, result, *args): return bind(g, 'gl'+name, result, *args)
    def require(ok, message):
        if not ok: raise RuntimeError(message)
    integer=gl('GetIntegerv',None,U,P); count=I(); integer(0x87FE,C.byref(count))
    require(0 < count.value <= 128,'program binary formats unavailable')
    raw=(I*count.value)(); integer(0x87FF,raw); formats=set(raw)
    string=gl('GetString',C.c_char_p,U); identity=[string(i).decode() for i in (0x1F00,0x1F01,0x1F02,0x8B8C)]
    create=gl('CreateProgram',U); delete=gl('DeleteProgram',None,U); use=gl('UseProgram',None,U)
    query=gl('GetProgramiv',None,U,U,P); error=gl('GetError',U)
    vao=U(); gl('GenVertexArrays',None,I,P)(1,C.byref(vao)); gl('BindVertexArray',None,U)(vao)
    gl('Viewport',None,I,I,I,I)(0,0,W,H)
    vertex='#version 430\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}'
    sizes=[]; compile_ns=[]; load_ns=[]; pixels=0; rejected=0
    def draw(p, expected):
        use(p); gl('DrawArrays',None,U,I,I)(4,0,3)
        out=(C.c_ubyte*(W*H*4))(); gl('ReadPixels',None,I,I,I,I,U,U,P)(0,0,W,H,0x1908,0x1401,out)
        require(bytes(out)==bytes(expected)*(W*H) and error()==0,'program output mismatch')
    try:
        for rgba in ((255,0,0,255),(0,255,0,255),(0,0,255,255)):
            fragment='#version 430\nout vec4 c;void main(){c=vec4('+','.join(str(v//255)+'.0' for v in rgba)+');}'
            stages=((0x8B31,vertex),(0x8B30,fragment)); k=key(identity,stages)
            p=create(); q=0; shaders=[]; start=time.perf_counter_ns()
            try:
                gl('ProgramParameteri',None,U,U,I)(p,0x8257,1)
                for kind,code in stages:
                    sh=gl('CreateShader',U,U)(kind); shaders.append(sh); s=C.c_char_p(code.encode())
                    gl('ShaderSource',None,U,I,P,P)(sh,1,C.byref(s),None); gl('CompileShader',None,U)(sh)
                    ok=I(); gl('GetShaderiv',None,U,U,P)(sh,0x8B81,C.byref(ok)); require(ok.value,'compile failed')
                    gl('AttachShader',None,U,U)(p,sh)
                gl('LinkProgram',None,U)(p); ok=I(); query(p,0x8B82,C.byref(ok)); require(ok.value,'link failed')
                compile_ns.append(time.perf_counter_ns()-start); draw(p,rgba); pixels+=W*H
                size=I(); query(p,0x8741,C.byref(size)); require(0<size.value<=MAX_BINARY,'binary length')
                buf=C.create_string_buffer(size.value); actual=I(); fmt=U()
                gl('GetProgramBinary',None,U,I,P,P,P)(p,size,C.byref(actual),C.byref(fmt),buf)
                require(0<actual.value<=size.value,'binary read length'); blob=buf.raw[:actual.value]
                entry=envelope(k,fmt.value,blob); sizes.append(len(blob))
                for bad,expected in ((entry,key(identity+['changed'],stages)),(entry,key(identity,stages+((0,'changed'),))),(entry[:3]+(bytes([blob[0]^1])+blob[1:],),k)):
                    try: checked(bad,expected,formats)
                    except ValueError: rejected+=1
                    else: raise RuntimeError('invalid cache accepted')
                f,b=checked(entry,k,formats); q=create(); data=C.create_string_buffer(b); start=time.perf_counter_ns()
                gl('ProgramBinary',None,U,U,P,I)(q,f,data,len(b)); query(q,0x8B82,C.byref(ok)); require(ok.value,'binary load failed')
                load_ns.append(time.perf_counter_ns()-start); draw(q,rgba); pixels+=W*H
            finally:
                use(0); delete(p)
                if q: delete(q)
                for sh in shaders: gl('DeleteShader',None,U)(sh)
        print(json.dumps({'scope':'independent_gl_program_binary_roundtrip','renderer':renderer,'physical_gpu_verified':False,'programs':3,'pixels_checked':pixels,'invalid_cache_rejections':rejected,'binary_bytes':sizes,'compile_link_wall_ns':compile_ns,'binary_load_wall_ns':load_ns}))
    finally:
        gl('DeleteVertexArrays',None,I,P)(1,C.byref(vao))


def full_suite(g, renderer):
    all_tests(g,renderer)
    cache(g,renderer)


if __name__=='__main__': run(full_suite)
