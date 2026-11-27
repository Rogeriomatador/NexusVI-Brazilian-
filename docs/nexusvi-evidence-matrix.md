# NexusVI independent evidence matrix

Scope: original authorized synthetic workloads; not a claim of game compatibility.
Base: upstream 4eb6cfdf9e61cb112f1f811344ec0dd309eddd6c. Prior independent checkpoint: 8f7b323ac37779988a8ea334003694e941725a9b.

| Area | Reproduce | Evidence / limitations |
|---|---|---|
| CPU compositing | node scripts/nexusvi_core_v2.js | Prior local exact-pixel tests; CPU only |
| Native OpenGL | python3 scripts/nexusvi_native_evidence.py | Fresh local software run; 5 records checked, source SHA-256 included |
| Vulkan discovery | python3 scripts/nexusvi_vulkan_probe.py | Local -9, no usable driver |
| Vulkan host fixture | c++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -O2 scripts/nexusvi_vk_fixture_test.cpp -o fixture && ./fixture | 30,842 checks passed locally; no Vulkan call |
| Vulkan compute and SPIR-V | native-vulkan-software job in nexusvi-tools.yml | Implemented, native build and execution pending; original and optimized shader variants, validation layer and guard checks required |
| Loader and system libraries | Inherited Rust workspace | No independent runtime validation |
| Shader translation | No independent implementation | GLSL compilation is not console shader translation |
| Graphics translation layer | No independent implementation | OpenGL controls are not a D3D translation layer |
| Other authorized game | Not tested | No proven-on claim |
| Physical GPU | Not tested | No FPS or VRAM claim |

Local software evidence at 2026-11-27: Linux x86_64, Mesa llvmpipe LLVM 19.1.7. Exact source Git blobs for all five existing GL controls match the prior remote checkpoint. New evidence collector self-test: one valid fixture, six invalid fixtures rejected; actual execution: five records validated. Source blob 78b670165581ce18fd86e60b6bf08f7fed47cb63. The collector does not authenticate externally supplied reports; it executes the fixed local suite itself. CI artifact upload added; remote result pending.

PortWatch rules: https://github.com/4lwayz/portwatch-vi/blob/main/EDITOR.md ; scoring: https://github.com/4lwayz/portwatch-vi/blob/main/assets/js/scoring.js . No score claimed; editorial review is independent. No external submission made. Research references: Khronos Vulkan Samples, SPIRV-Tools, Vulkan Validation Layers, VMA and VK-GL-CTS (design references only; no imported source).
