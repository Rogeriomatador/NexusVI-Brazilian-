# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent native texture and buffer transfer correctness control."""
import ctypes as C
import json
import time
from nexusvi_egl_control import bind, run, I, U, P
from nexusvi_gl_pipeline import pipeline


def transfers(g, renderer):
    def gl(name, result, *args):
        return bind(g, 'gl' + name, result, *args)
    error = gl('GetError', U)
    def gate(label):
        rc = error()
        if rc: raise RuntimeError('%s: GL error 0x%x' % (label, rc))
    gen_tex = gl('GenTextures', None, I, P); del_tex = gl('DeleteTextures', None, I, P)
    bind_tex = gl('BindTexture', None, U, U); store = gl('PixelStorei', None, U, I)
    image = gl('TexImage2D', None, U,I,I,I,I,I,U,U,P)
    sub = gl('TexSubImage2D', None, U,I,I,I,I,I,U,U,P)
    get = gl('GetTexImage', None, U,I,U,U,P)
    gen = gl('GenBuffers', None,I,P); delete = gl('DeleteBuffers',None,I,P)
    bindbuf = gl('BindBuffer',None,U,U); data = gl('BufferData',None,U,C.c_ssize_t,P,U)
    copy = gl('CopyBufferSubData',None,U,U,C.c_ssize_t,C.c_ssize_t,C.c_ssize_t)
    read = gl('GetBufferSubData',None,U,C.c_ssize_t,C.c_ssize_t,P)
    fence = gl('FenceSync',P,U,U); wait = gl('ClientWaitSync',U,P,U,C.c_uint64)
    drop = gl('DeleteSync',None,P)
    tex = U(); bufs = (U*2)(); target=0x0DE1; rgb=0x1907; byte=0x1401
    textures=texture_bytes=buffer_bytes=0; times=[]
    try:
        gen_tex(1,C.byref(tex)); bind_tex(target,tex); store(0x0CF5,1); store(0x0D05,1)
        for w,h in ((1,1),(3,5),(17,9),(63,31),(128,64)):
            n=w*h*3; expected=bytearray((i*73+19)%256 for i in range(n)); inp=(C.c_ubyte*n).from_buffer_copy(expected)
            image(target,0,0x8051,w,h,0,rgb,byte,inp)
            x,y=w//2,h//2; patch=(C.c_ubyte*3)(7,111,239); sub(target,0,x,y,1,1,rgb,byte,patch)
            k=(y*w+x)*3; expected[k:k+3]=bytes(patch)
            out=(C.c_ubyte*n)(); get(target,0,rgb,byte,out); gate('texture')
            if bytes(out)!=expected: raise RuntimeError('texture mismatch')
            textures+=1; texture_bytes+=n
        gen(2,bufs); src,dst=0x8F36,0x8F37
        for n in (1,3,63,4097,65536):
            size=n+8; inp=(C.c_ubyte*size)(*((i*31+9)%256 for i in range(size))); initial=(C.c_ubyte*size)(*([0xA5]*size))
            bindbuf(src,bufs[0]); data(src,size,inp,0x88E4)
            bindbuf(dst,bufs[1]); data(dst,size,initial,0x88E8)
            begin=time.perf_counter_ns(); copy(src,dst,2,4,n); sync=fence(0x9117,0)
            if not sync: raise RuntimeError('fence unavailable')
            try:
                status=wait(sync,1,2_000_000_000)
                if status not in (0x911A,0x911C): raise RuntimeError('fence wait status 0x%x'%status)
            finally: drop(sync)
            out=(C.c_ubyte*size)(); read(dst,0,size,out); times.append(time.perf_counter_ns()-begin); gate('buffer')
            expected=bytearray(initial); expected[4:4+n]=bytes(inp)[2:2+n]
            if bytes(out)!=expected: raise RuntimeError('buffer copy or guard mismatch')
            buffer_bytes+=size
        print(json.dumps({'scope':'independent_gl_texture_buffer_transfers','renderer':renderer,'physical_gpu_verified':False,'texture_cases':textures,'texture_bytes_checked':texture_bytes,'buffer_cases':5,'buffer_bytes_checked':buffer_bytes,'copy_fence_read_wall_ns':times}))
    finally:
        store(0x0CF5,4); store(0x0D05,4)
        if tex.value: del_tex(1,C.byref(tex))
        if any(bufs): delete(2,bufs)


def suite(g, renderer):
    pipeline(g,renderer)
    transfers(g,renderer)

if __name__=='__main__': run(suite)
