# SPDX-License-Identifier: GPL-3.0-or-later
"""Independent Vulkan loader/instance/device discovery; no workload claim."""
import ctypes as C
import json
import sys

P, U, I = C.c_void_p, C.c_uint32, C.c_int32

class InstanceInfo(C.Structure):
    _fields_ = [('sType', I), ('pNext', P), ('flags', U), ('pApplicationInfo', P),
                ('enabledLayerCount', U), ('ppEnabledLayerNames', P),
                ('enabledExtensionCount', U), ('ppEnabledExtensionNames', P)]

def bind(lib, name, result, *args):
    f = getattr(lib, name); f.restype = result; f.argtypes = args; return f

def probe():
    lib = C.CDLL('libvulkan.so.1')
    create = bind(lib, 'vkCreateInstance', I, P, P, P)
    destroy = bind(lib, 'vkDestroyInstance', None, P, P)
    enumerate_ = bind(lib, 'vkEnumeratePhysicalDevices', I, P, P, P)
    info = InstanceInfo(); info.sType = 1
    instance = P(); rc = create(C.byref(info), None, C.byref(instance))
    result = {'scope':'independent_vulkan_discovery','instance_result':rc,'device_count':None,'physical_gpu_verified':False,'workload_executed':False}
    if rc != 0:
        result['status'] = 'instance_unavailable'; return result
    try:
        count = U(); rc = enumerate_(instance,C.byref(count),None)
        result['enumerate_result'] = rc
        if rc != 0:
            result['status'] = 'enumeration_failed'; return result
        if count.value > 256: raise RuntimeError('unexpected device count')
        devices = (P*count.value)()
        if count.value:
            rc = enumerate_(instance,C.byref(count),devices)
            result['enumerate_result'] = rc
            if rc != 0:
                result['status'] = 'enumeration_failed'; return result
            if count.value > len(devices): raise RuntimeError('device count changed')
        result['device_count'] = count.value
        result['status'] = 'devices_found' if count.value else 'no_devices'
        return result
    finally: destroy(instance,None)

if __name__ == '__main__':
    try:
        result = probe(); print(json.dumps(result))
        sys.exit(0 if result['status']=='devices_found' else 2)
    except (OSError, RuntimeError) as exc:
        print(str(exc),file=sys.stderr); sys.exit(1)
