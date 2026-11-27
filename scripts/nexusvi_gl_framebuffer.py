# SPDX-License-Identifier: GPL-3.0-or-later
"""Original offscreen depth/blend/resize regression; no game assets."""
import ctypes as C
import json
from nexusvi_egl_control import bind, run, I, U, P, F
from nexusvi_gl_transfers import suite


def framebuffer(g, renderer):
    def gl(name, result, *args):
        return bind(g, 'gl' + name, result, *args)
    error = gl('GetError', U)
    def require(ok, message):
        if not ok: raise RuntimeError(message)
    def gate():
        rc = error(); require(rc == 0, 'GL error 0x%x' % rc)
    create = gl('CreateShader', U, U); source = gl('ShaderSource', None, U,I,P,P)
    compile_ = gl('CompileShader', None,U); query = gl('GetShaderiv',None,U,U,P)
    delete_shader = gl('DeleteShader',None,U)
    p = gl('CreateProgram',U)(); shaders = []
    vao, fb, tex, depth = U(), U(), U(), U()
    def gen(name, obj): gl('Gen'+name,None,I,P)(1,C.byref(obj))
    def delete(name,obj):
        if obj.value: gl('Delete'+name,None,I,P)(1,C.byref(obj))
    bindfb = gl('BindFramebuffer',None,U,U); bindtex = gl('BindTexture',None,U,U)
    bindrb = gl('BindRenderbuffer',None,U,U); use = gl('UseProgram',None,U)
    enable = gl('Enable',None,U); disable = gl('Disable',None,U)
    try:
        for kind,code in ((0x8B31,'#version 430\nuniform float z;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,z,1.0);}'),(0x8B30,'#version 430\nuniform vec4 rgba;out vec4 c;void main(){c=rgba;}')):
            sh=create(kind); shaders.append(sh); text=C.c_char_p(code.encode())
            source(sh,1,C.byref(text),None); compile_(sh); ok=I(); query(sh,0x8B81,C.byref(ok)); require(ok.value,'shader compile')
            gl('AttachShader',None,U,U)(p,sh)
        gl('LinkProgram',None,U)(p); ok=I(); gl('GetProgramiv',None,U,U,P)(p,0x8B82,C.byref(ok)); require(ok.value,'program link')
        gen('VertexArrays',vao); gl('BindVertexArray',None,U)(vao); use(p)
        loc=gl('GetUniformLocation',I,U,C.c_char_p); z,rgba=loc(p,b'z'),loc(p,b'rgba'); require(z>=0 and rgba>=0,'uniforms missing')
        def draw(d,c):
            gl('Uniform1f',None,I,F)(z,d); gl('Uniform4f',None,I,F,F,F,F)(rgba,*c); gl('DrawArrays',None,U,I,I)(4,0,3)
        gen('Framebuffers',fb); bindfb(0x8D40,fb)
        status=gl('CheckFramebufferStatus',U,U); require(status(0x8D40)==0x8CD7,'empty FBO not rejected')
        gen('Textures',tex); bindtex(0x0DE1,tex); gen('Renderbuffers',depth); bindrb(0x8D41,depth)
        gl('FramebufferTexture2D',None,U,U,U,U,I)(0x8D40,0x8CE0,0x0DE1,tex,0)
        gl('FramebufferRenderbuffer',None,U,U,U,U)(0x8D40,0x8D00,0x8D41,depth)
        clear=gl('Clear',None,U); read=gl('ReadPixels',None,I,I,I,I,U,U,P)
        pixels=0; frames=0
        for w,h in ((1,1),(17,9),(64,48),(127,65),(17,9)):
            gl('TexImage2D',None,U,I,I,I,I,I,U,U,P)(0x0DE1,0,0x8058,w,h,0,0x1908,0x1401,None)
            gl('RenderbufferStorage',None,U,U,I,I)(0x8D41,0x81A6,w,h)
            require(status(0x8D40)==0x8CD5,'incomplete FBO after resize')
            gl('Viewport',None,I,I,I,I)(0,0,w,h); disable(0x0C11); disable(0x0BD0); disable(0x0BE2); enable(0x0B71)
            gl('DepthFunc',None,U)(0x0201); gl('DepthMask',None,C.c_ubyte)(1)
            gl('ClearDepth',None,C.c_double)(1.0); gl('ClearColor',None,F,F,F,F)(0,0,0,1); clear(0x4100)
            draw(0.0,(1,0,0,1)); draw(0.75,(0,1,0,1))
            def verify(rgb,tolerance=0):
                nonlocal pixels,frames
                out=(C.c_ubyte*(w*h*4))(); read(0,0,w,h,0x1908,0x1401,out); gate()
                require(all(abs(v-rgb[i%4])<=tolerance for i,v in enumerate(out)), 'pixel mismatch')
                pixels+=w*h; frames+=1
            verify((255,0,0,255))
            draw(-0.75,(0,0,1,1)); verify((0,0,255,255))
            disable(0x0B71); enable(0x0BE2); gl('BlendFuncSeparate',None,U,U,U,U)(0x0302,0x0303,1,0)
            draw(0,(1,0,0,0.5)); verify((128,0,128,128),1)
        print(json.dumps({'scope':'independent_gl_depth_blend_resize','renderer':renderer,'physical_gpu_verified':False,'resize_cases':5,'readbacks':frames,'pixels_checked':pixels,'blend_tolerance_lsb':1,'incomplete_framebuffer_rejected':True}))
    finally:
        disable(0x0BE2); disable(0x0B71); use(0); bindfb(0x8D40,0)
        delete('Framebuffers',fb); delete('Textures',tex); delete('Renderbuffers',depth); delete('VertexArrays',vao)
        gl('DeleteProgram',None,U)(p)
        for sh in shaders: delete_shader(sh)


def all_tests(g, renderer):
    suite(g,renderer)
    framebuffer(g,renderer)


if __name__=='__main__': run(all_tests)
