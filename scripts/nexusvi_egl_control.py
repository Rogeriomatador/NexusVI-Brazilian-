# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent Linux EGL/OpenGL opaque rectangle correctness control."""
import ctypes as C
import json
import os
import sys

W, H = 64, 48
I, U, P, F = C.c_int, C.c_uint, C.c_void_p, C.c_float

def bind(lib, name, restype, *args):
    f = getattr(lib, name)
    f.restype, f.argtypes = restype, args
    return f

def run(extra=None):
    os.environ.setdefault('EGL_PLATFORM', 'surfaceless')
    e, g = C.CDLL('libEGL.so.1'), C.CDLL('libGL.so.1')
    get = bind(e, 'eglGetDisplay', P, P)
    init = bind(e, 'eglInitialize', U, P, P, P)
    choose = bind(e, 'eglChooseConfig', U, P, P, P, I, P)
    api = bind(e, 'eglBindAPI', U, U)
    surface = bind(e, 'eglCreatePbufferSurface', P, P, P, P)
    context = bind(e, 'eglCreateContext', P, P, P, P, P)
    current = bind(e, 'eglMakeCurrent', U, P, P, P, P)
    dc = bind(e, 'eglDestroyContext', U, P, P)
    ds = bind(e, 'eglDestroySurface', U, P, P)
    end = bind(e, 'eglTerminate', U, P)
    d = get(None); major, minor = I(), I()
    if not d or not init(d, C.byref(major), C.byref(minor)):
        raise RuntimeError('EGL initialization unavailable')
    s = ctx = None
    try:
        attrs = (I * 15)(0x3033, 1, 0x3040, 8, 0x3024, 8, 0x3023, 8, 0x3022, 8, 0x3021, 8, 0x3032, 0, 0x3038)
        cfg, count = P(), I()
        if not api(0x30A2) or not choose(d, attrs, C.byref(cfg), 1, C.byref(count)) or count.value != 1:
            raise RuntimeError('OpenGL pbuffer configuration unavailable')
        s = surface(d, cfg, (I * 5)(0x3057, W, 0x3056, H, 0x3038))
        ctx = context(d, cfg, None, (I * 1)(0x3038))
        if not s or not ctx or not current(d, s, s, ctx):
            raise RuntimeError('OpenGL context unavailable')
        string = bind(g, 'glGetString', C.c_char_p, U)
        error = bind(g, 'glGetError', U)
        enable = bind(g, 'glEnable', None, U)
        disable = bind(g, 'glDisable', None, U)
        scissor = bind(g, 'glScissor', None, I, I, I, I)
        color = bind(g, 'glClearColor', None, F, F, F, F)
        clear = bind(g, 'glClear', None, U)
        read = bind(g, 'glReadPixels', None, I, I, I, I, U, U, P)
        renderer = string(0x1F01).decode()
        disable(0x0BD0)  # Dither off for exact byte comparison.
        enable(0x0C11)
        bg = (8, 16, 32, 255)
        def draw(box, rgba):
            x, y, w, h = box
            scissor(x, y, w, h); color(*(v / 255 for v in rgba)); clear(0x4000)
        def scene(frame):
            return [((0, 0, W, H), bg), ((frame % 32, 4, 24, 16), (255, 0, 64, 255)), ((12, 8, 28, 24), (0, 192, 255, 255))]
        def expected(layers):
            out = bytearray(W * H * 4)
            for y in range(H):
                for x in range(W):
                    rgba = bg
                    for (l, t, w, h), c in layers:
                        if l <= x < l+w and t <= y < t+h: rgba = c
                    p = (y*W+x)*4; out[p:p+4] = bytes(rgba)
            return out
        buf = (C.c_ubyte * (W * H * 4))()
        for frame in range(64):
            layers = scene(frame)
            for box, rgba in layers: draw(box, rgba)
            read(0, 0, W, H, 0x1908, 0x1401, buf)
            if error() or bytes(buf) != expected(layers):
                raise RuntimeError('OpenGL error or pixel mismatch at frame %d' % frame)
        print(json.dumps({'scope': 'independent_egl_opengl_clear_readback', 'egl': f'{major.value}.{minor.value}', 'vendor': string(0x1F00).decode(), 'renderer': renderer, 'version': string(0x1F02).decode(), 'physical_gpu_verified': False, 'frames': 64, 'pixels': 64*W*H, 'byte_comparisons': 64*W*H*4}))
        if extra is not None: extra(g, renderer)
    finally:
        current(d, None, None, None)
        if ctx: dc(d, ctx)
        if s: ds(d, s)
        end(d)

if __name__ == '__main__':
    try: run()
    except (OSError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr); sys.exit(1)
