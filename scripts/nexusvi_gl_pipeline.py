# SPDX-License-Identifier: GPL-3.0-or-later
"""Synthetic GLSL compilation, rasterization, compute and buffer readback."""
import ctypes as C
import json
import time
from nexusvi_egl_control import bind, run, I, U, P, F, W, H


def pipeline(g, renderer):
    def gl(name, result, *args):
        return bind(g, 'gl' + name, result, *args)
    err = gl('GetError', U)
    create = gl('CreateShader', U, U)
    source = gl('ShaderSource', None, U, I, P, P)
    compile_ = gl('CompileShader', None, U)
    shaderiv = gl('GetShaderiv', None, U, U, P)
    shaderlog = gl('GetShaderInfoLog', None, U, I, P, P)
    delete_shader = gl('DeleteShader', None, U)
    program = gl('CreateProgram', U)
    attach = gl('AttachShader', None, U, U)
    link = gl('LinkProgram', None, U)
    programiv = gl('GetProgramiv', None, U, U, P)
    programlog = gl('GetProgramInfoLog', None, U, I, P, P)
    delete_program = gl('DeleteProgram', None, U)
    use = gl('UseProgram', None, U)
    def status(obj, query, getlog, flag):
        ok = I(); query(obj, flag, C.byref(ok))
        if not ok.value:
            buf = C.create_string_buffer(4096)
            getlog(obj, len(buf), None, buf)
            raise RuntimeError(buf.value.decode(errors='replace'))
    def build(stages):
        shaders = []; p = program()
        try:
            for kind, code in stages:
                sh = create(kind); shaders.append(sh)
                text = C.c_char_p(code.encode())
                source(sh, 1, C.byref(text), None); compile_(sh)
                status(sh, shaderiv, shaderlog, 0x8B81); attach(p, sh)
            link(p); status(p, programiv, programlog, 0x8B82)
            return p
        except Exception:
            delete_program(p); raise
        finally:
            for sh in shaders: delete_shader(sh)
    vertex = '#version 430\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'
    fragment = '#version 430\nout vec4 c;void main(){c=vec4(1,0,1,1);}'
    compute = '#version 430\nlayout(local_size_x=64) in;layout(std430,binding=0) buffer Data{uint x[];};void main(){uint i=gl_GlobalInvocationID.x;if(i<x.length())x[i]=x[i]*3u+7u;}'
    programs = []; vao = U(); buf = U()
    genva = gl('GenVertexArrays', None, I, P); delva = gl('DeleteVertexArrays', None, I, P)
    genbuf = gl('GenBuffers', None, I, P); delbuf = gl('DeleteBuffers', None, I, P)
    try:
        try: build([(0x8B31, '#version 430\ninvalid syntax')])
        except RuntimeError: pass
        else: raise RuntimeError('invalid shader accepted')
        p = build([(0x8B31, vertex), (0x8B30, fragment)]); programs.append(p)
        genva(1, C.byref(vao)); gl('BindVertexArray', None, U)(vao)
        gl('Disable', None, U)(0x0C11); gl('Viewport', None, I,I,I,I)(0,0,W,H)
        use(p); gl('DrawArrays', None, U,I,I)(4,0,3)
        pixels = (C.c_ubyte*(W*H*4))()
        gl('ReadPixels', None,I,I,I,I,U,U,P)(0,0,W,H,0x1908,0x1401,pixels)
        if bytes(pixels) != bytes([255,0,255,255])*(W*H) or err(): raise RuntimeError('triangle mismatch')
        p = build([(0x91B9,compute)]); programs.append(p); use(p)
        genbuf(1,C.byref(buf)); target=0x90D2; gl('BindBuffer', None,U,U)(target,buf)
        allocate=gl('BufferData', None,U,C.c_ssize_t,P,U)
        gl('BindBufferBase',None,U,U,U)(target,0,buf)
        dispatch=gl('DispatchCompute',None,U,U,U); barrier=gl('MemoryBarrier',None,U)
        read=gl('GetBufferSubData',None,U,C.c_ssize_t,C.c_ssize_t,P)
        checked=0; durations=[]
        for count in (1,63,64,65,1024,4097):
            data=(U*count)(*((i*2654435761)&0xffffffff for i in range(count)))
            expected=[(v*3+7)&0xffffffff for v in data]; out=(U*count)()
            allocate(target,C.sizeof(data),data,0x88E8)
            start=time.perf_counter_ns(); dispatch((count+63)//64,1,1); barrier(0x200); read(target,0,C.sizeof(out),out)
            durations.append(time.perf_counter_ns()-start)
            if list(out)!=expected or err(): raise RuntimeError('compute mismatch')
            checked+=count
        print(json.dumps({'scope':'independent_glsl_triangle_compute','renderer':renderer,'physical_gpu_verified':False,'triangle_pixels':W*H,'compute_values':checked,'dispatch_readback_wall_ns':durations,'invalid_shader_rejected':True}))
    finally:
        use(0)
        if buf.value: delbuf(1,C.byref(buf))
        if vao.value: delva(1,C.byref(vao))
        for p in programs: delete_program(p)


if __name__=='__main__': run(pipeline)
