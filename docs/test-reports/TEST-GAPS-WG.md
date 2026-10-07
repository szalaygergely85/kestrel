# TEST-GAPS-WG (PC-B, 2026-10-07)

The new render-target test replaces a grid with cached presented texture handles, verifies those handles are invalidated before disposal, and proves readback rejects the old grid until a new present. Afterward it reads only the replacement textures.

The factory test uses a small DOM/WebGL stub and a WebGPU adapter failure. It verifies the returned WebGL2 target, fallback info label, original canvas context calls, grid and warning; it also checks the ordinary WebGL2 label.

The live presenter gate now compares every glyph pixel with a separate Canvas2D strip drawn directly with `fillText`, bypassing the shared glyph-atlas helper. A continuous strip preserves authored font overhang at cell boundaries. The two-channel tolerance remains 2; no pixels are excluded. All 95 printable glyph indices must be checked, with nonzero sensitivity to flipping, mirroring and index shifts. Failed `webgpu-present` captures exit 1; existing gpucompare known-FAIL reporting is unchanged.

Real RTX 4060 / Chrome 154 baseline: 620,000 pixels, 95 glyphs, zero glyph mismatches, maximum channel difference 1; foreground/background bytes and space pixels also match; no GPU validation errors.

Negative controls mutate the actual GPU atlas while keeping foreground/background cell bytes unchanged:

| Mutation | Glyph mismatches | Maximum channel difference | Foreground/background mismatches |
|---|---:|---:|---:|
| Vertical flip | 123,074 | 253 | 0 / 0 |
| Horizontal mirror | 95,663 | 253 | 0 / 0 |
| Shift glyph index | 136,989 | 253 | 0 / 0 |

All three controls return FAIL without GPU validation errors. Focused Node target/factory/capture tests and glyphAtlas 11 checks pass. Shipment: 263/263 suites PASS, check-deps OK (462 files, existing warnings), validate-content 3233; real-GPU 400x150 mesh route reaches the end. Final webgpu-present capture PASS. No game rendering behavior changes.
