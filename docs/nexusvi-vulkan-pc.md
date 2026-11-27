# Independent Vulkan validation on a real PC

This is an original compute fixture, not an Xbox compatibility test or commercial game benchmark. Never use proprietary or leaked files. No automatic downloads, installation, telemetry or uploading. The runner uses the known repository shader and an isolated temporary build directory.

## Windows x64
Install official GPU drivers, Python 3.10+, Visual Studio Build Tools with Desktop development with C++, and the LunarG Vulkan SDK with validation layers and command-line SPIR-V tools. Open x64 Native Tools Command Prompt for VS. Clone or obtain only the independently authored fixture files if the inherited repository is not appropriate to redistribute. Run from the checkout:

```
python scripts/nexusvi_vk_runner.py --self-test
python scripts/nexusvi_vk_runner.py --mode nvidia > nexusvi-vulkan.json
```

For AMD or Intel change the mode. Linux: install C++17, Vulkan headers/loader, appropriate GPU driver, glslang and SPIRV-Tools plus Khronos validation layers, then run python3 with the same arguments. Software mode is explicit, default, and does not silently fall back from GPU mode. The first suitable compute queue on a matching vendor/device type is selected. The program reports the actual vendor/device IDs and driver version, not a user-provided GPU name. Device type is driver-reported, not independent proof of hardware. No actual VRAM budget or FPS is measured.

Success requires both original and optimized modules on the same reported device, 120 dispatches and 493560 checked values per module, no validation errors, including guard words. The runner hashes source and SPIR-V files. Wall times include host work; do not claim optimization speedup from one run. Share the JSON only after reviewing it. No host name, user name or serial number intentionally collected. On failure share the error, not a fabricated report.

References: https://vulkan.lunarg.com/doc/view/latest/windows/getting_started.html ; https://docs.vulkan.org/refpages/latest/refpages/source/VkPhysicalDeviceType.html .

## Review status
Python schema self-test: two synthetic positive fixtures and 17 rejected invalid fixtures, passed locally. Python compilation passed. Real collection stopped at missing glslangValidator locally. Native C++ changes, SDK build and execution on Windows/Linux Vulkan remain unverified until actually run. Existing OpenGL five-record baseline passed again on llvmpipe. This guide is a reproduction candidate, not a claim of readiness.
