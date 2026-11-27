# SPDX-License-Identifier: GPL-3.0-or-later
"""Collect fresh software OpenGL control evidence; fail closed on bad output."""
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
SOURCES = ('nexusvi_egl_control.py', 'nexusvi_gl_pipeline.py', 'nexusvi_gl_transfers.py',
           'nexusvi_gl_framebuffer.py', 'nexusvi_gl_cache.py', 'nexusvi_native_evidence.py')
EXPECTED = {
    'independent_egl_opengl_clear_readback': {'frames': 64, 'pixels': 196608, 'byte_comparisons': 786432},
    'independent_glsl_triangle_compute': {'triangle_pixels': 3072, 'compute_values': 5314, 'invalid_shader_rejected': True},
    'independent_gl_texture_buffer_transfers': {'texture_cases': 5, 'texture_bytes_checked': 30942, 'buffer_cases': 5, 'buffer_bytes_checked': 69740},
    'independent_gl_depth_blend_resize': {'resize_cases': 5, 'readbacks': 15, 'pixels_checked': 34902, 'blend_tolerance_lsb': 1, 'incomplete_framebuffer_rejected': True},
    'independent_gl_program_binary_roundtrip': {'programs': 3, 'pixels_checked': 18432, 'invalid_cache_rejections': 9},
}


def validate(records):
    if not isinstance(records, list) or len(records) != len(EXPECTED):
        raise ValueError('incomplete suite')
    seen = set()
    renderer = None
    for record in records:
        if not isinstance(record, dict): raise ValueError('invalid record')
        scope = record.get('scope')
        if scope not in EXPECTED or scope in seen: raise ValueError('unknown or duplicate scope')
        seen.add(scope)
        name = record.get('renderer')
        if not isinstance(name, str) or 'llvmpipe' not in name.lower() or (renderer is not None and renderer != name):
            raise ValueError('unexpected software renderer')
        renderer = name
        if record.get('physical_gpu_verified') is not False: raise ValueError('invalid hardware claim')
        for field, expected in EXPECTED[scope].items():
            actual = record.get(field)
            if type(actual) is not type(expected) or actual != expected:
                raise ValueError('unexpected result: ' + scope + '/' + field)
    return renderer


def self_test():
    fixture = [dict(values, scope=scope, renderer='llvmpipe fixture', physical_gpu_verified=False)
               for scope, values in EXPECTED.items()]
    validate(fixture)
    failures = [fixture[:-1], fixture[:-1]+[fixture[0]], [dict(fixture[0], frames=63)]+fixture[1:],
                [dict(fixture[0], physical_gpu_verified=True)]+fixture[1:],
                [dict(fixture[0], renderer='hardware')]+fixture[1:],
                [dict(fixture[0], byte_comparisons=True)]+fixture[1:]]
    for case in failures:
        try: validate(case)
        except ValueError: continue
        raise RuntimeError('invalid fixture accepted')
    print(json.dumps({'scope':'evidence_schema_self_test','positive':1,'rejected':len(failures)}))


def collect():
    env = dict(os.environ, EGL_PLATFORM='surfaceless', LIBGL_ALWAYS_SOFTWARE='1')
    result = subprocess.run([sys.executable, str(ROOT / 'nexusvi_gl_cache.py')], env=env,
                            capture_output=True, text=True, timeout=90, check=True)
    records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    renderer = validate(records)
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCES}
    print(json.dumps({'scope':'independent_native_software_evidence','python':platform.python_version(),
                      'platform':platform.platform(),'renderer':renderer,'physical_gpu_verified':False,
                      'sources_sha256':hashes,'records':records,'stderr':result.stderr}))


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']: self_test()
    elif not sys.argv[1:]: collect()
    else: sys.exit('usage: nexusvi_native_evidence.py [--self-test]')
