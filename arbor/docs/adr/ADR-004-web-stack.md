# ADR-004: three.js WebGPURenderer with WebGL2 fallback, Worker-hosted kernel, Vite, Tweakpane

- Status: Accepted (2026-09-06)

## Context

WebGPU is enabled by default in Chrome/Edge, Safari 26 and Firefox (Windows/macOS) as of 2026;
three.js ships `WebGPURenderer` as production-ready since r171 with automatic WebGL2 fallback.
Headless CI (SwiftShader) has no WebGPU, so the fallback path must always work.

## Decision

- Renderer: `three/webgpu` `WebGPURenderer`; materials written so the WebGL2 fallback renders the same
  scene. TSL node materials are adopted only when they degrade gracefully.
- Generation runs in a Web Worker; results cross as transferable typed arrays. The main thread never
  runs the kernel.
- UI: Tweakpane v4; state mirrored in the URL hash so any tree is a shareable link.
- Export: glTF binary via `GLTFExporter` (branches mesh + leaves `InstancedMesh`, which the exporter
  writes with `EXT_mesh_gpu_instancing`).
- Smoke test: Playwright + headless Chromium renders three reference trees to PNG in CI.

## Consequences

- One code path for browser preview and CI verification.
- Desktop packaging (Tauri) reuses the same bundle later.
