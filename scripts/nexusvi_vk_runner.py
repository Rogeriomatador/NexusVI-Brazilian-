# SPDX-License-Identifier: GPL-3.0-or-later
"""Build and run only the repository's original Vulkan compute fixture."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
FILES = ('nexusvi_vk_compute.cpp', 'nexusvi_vk_compute.comp', 'nexusvi_vk_fixture.hpp',
         'nexusvi_vk_fixture_test.cpp', 'nexusvi_vk_runner.py')
VENDORS = {'nvidia': 0x10DE, 'amd': 0x1002, 'intel': 0x8086}


def validate_pair(rows, mode):
    if mode not in ('software', *VENDORS):
        raise ValueError('unknown mode')
    if len(rows) != 2:
        raise ValueError('two shader variants required')
    identity = ('vendor_id', 'device_id', 'driver_version', 'api_version', 'device_type')
    for row in rows:
        if not isinstance(row, dict) or row.get('scope') != 'independent_vulkan_compute':
            raise ValueError('wrong workload')
        for field in identity + ('heap_index', 'allocation_bytes', 'heap_capacity_bytes'):
            if type(row.get(field)) is not int or row[field] < 0:
                raise ValueError('invalid integer field: ' + field)
        for field, expected in (('dispatches', 120), ('values_checked', 493560), ('validation_errors', 0)):
            if type(row.get(field)) is not int or row[field] != expected:
                raise ValueError('invalid count: ' + field)
        if row.get('physical_gpu_verified') is not False:
            raise ValueError('driver report is not independent hardware verification')
        if not 16452 <= row['allocation_bytes'] <= row['heap_capacity_bytes']:
            raise ValueError('invalid memory report')
        t = row.get('wall_ms')
        if type(t) not in (int, float) or not math.isfinite(t) or t < 0:
            raise ValueError('invalid time')
        if mode == 'software':
            if row['device_type'] != 4: raise ValueError('not a CPU Vulkan device')
        elif row['device_type'] not in (1, 2) or row['vendor_id'] != VENDORS[mode]:
            raise ValueError('requested GPU vendor/type not reported')
    if any(rows[0][k] != rows[1][k] for k in identity):
        raise ValueError('different device across variants')


def execute(args, cwd, timeout=60):
    result = subprocess.run([str(x) for x in args], cwd=cwd, capture_output=True,
                            text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name}: exit {result.returncode}\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}')
    return result.stdout


def tool(name):
    found = shutil.which(name)
    if not found: raise RuntimeError('required tool not found: ' + name)
    return found


def collect(mode):
    if platform.system() not in ('Windows', 'Linux'):
        raise RuntimeError('Windows and Linux only')
    sdk = None
    if os.name == 'nt':
        if not os.environ.get('VULKAN_SDK'): raise RuntimeError('VULKAN_SDK missing')
        sdk = Path(os.environ['VULKAN_SDK'])
        compiler = tool('cl')
    else:
        compiler = tool('c++')
    compiler_shader, validator, optimizer = map(tool, ('glslangValidator', 'spirv-val', 'spirv-opt'))
    with tempfile.TemporaryDirectory(prefix='nexusvi-vk-') as tmp:
        work = Path(tmp)
        exe = work / ('control.exe' if os.name == 'nt' else 'control')
        original, optimized = work / 'original.spv', work / 'optimized.spv'
        execute([compiler_shader, '-V', '--target-env', 'vulkan1.0', '-S', 'comp', ROOT / FILES[1], '-o', original], work)
        execute([validator, '--target-env', 'vulkan1.0', original], work)
        execute([optimizer, '--target-env=vulkan1.0', '-O', original, '-o', optimized], work)
        execute([validator, '--target-env', 'vulkan1.0', optimized], work)
        if sdk is not None:
            execute([compiler, '/nologo', '/std:c++17', '/EHsc', '/O2', '/I'+str(sdk/'Include'), ROOT/FILES[0], '/Fe:'+str(exe), '/link', str(sdk/'Lib'/'vulkan-1.lib')], work, 120)
        else:
            execute([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror', '-O2', ROOT/FILES[0], '-lvulkan', '-o', exe], work, 120)
        rows = [json.loads(execute([exe, spv, mode], work)) for spv in (original, optimized)]
        validate_pair(rows, mode)
        return {'scope':'nexusvi_vulkan_local_control', 'requested_mode':mode,
                'system':platform.system(), 'architecture':platform.machine(),
                'physical_gpu_verified':False, 'records':rows,
                'sources_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in FILES},
                'spirv_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (original,optimized)}}


def self_test():
    base = dict(scope='independent_vulkan_compute', vendor_id=0x10DE, device_id=1, driver_version=2,
                api_version=3, device_type=2, heap_index=0, allocation_bytes=16452, heap_capacity_bytes=65536,
                dispatches=120, values_checked=493560, validation_errors=0, wall_ms=1.5, physical_gpu_verified=False)
    validate_pair([base, dict(base)], 'nvidia')
    cpu = dict(base, vendor_id=0, device_type=4)
    validate_pair([cpu, dict(cpu)], 'software')
    cases = [([base], 'nvidia'), ([base, cpu], 'nvidia'), ([base, base], 'amd'), ([base, base], 'software')]
    for changes in (dict(device_id=2), dict(driver_version=3), dict(dispatches=119), dict(values_checked=1),
                    dict(validation_errors=1), dict(validation_errors=False), dict(physical_gpu_verified=True),
                    dict(allocation_bytes=1), dict(heap_capacity_bytes=1), dict(wall_ms=float('nan')),
                    dict(scope='unrelated'), dict(device_type=3), dict(vendor_id=True)):
        cases.append(([base, dict(base, **changes)], 'nvidia'))
    for rows, mode in cases:
        try: validate_pair(rows, mode)
        except ValueError: continue
        raise RuntimeError('bad report accepted')
    print(json.dumps({'scope':'runner_schema_fixture_only','accepted':2,'rejected':len(cases)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('software', *VENDORS), default='software')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test: self_test()
    else: print(json.dumps(collect(args.mode)))
