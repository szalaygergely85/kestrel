# DECAL-01 programmer verification - 2026-10-05

Queue 16 item 5; architecture 37.6; clean baseline ad67b8a. Status: **arch-review; NEEDS PC-A: owner scrawl look**.

World.load now collects and validates derived wall decals without spawning entities or adding save fields. The numeric overlay text op projects each glyph along the authored baseline, skips spaces, uses scratch segments below the legibility threshold, and scales foreground RGB. Load-time bindings resolve text/style ids; frame drawing culls back faces and distant decals and samples lighting once per visible decal. The game binds on load/restart and draws after overlay.clear, including cinematics. Both render paths consume the same overlay arrays; no shader or G-buffer change.

Files: engine/world/World.js, engine/ui/overlay.js, new engine/ui/decals.js and test, engine/index.js, game/js/main.js, design/palette.js, content/levels/tower.level.json, game/js/dev/modes/gpucompare.js; meshStructures.render.test.js harness correction described below. Unrelated Ruins/sword/render work is excluded from this commit.

## Checks

- New decals suite: 80 assertions PASS. Four facings plus quarter-turned frame; malformed text/facing/walls/style; derived data excluded from serialized state and its SHA256; load/save reconstruction; text-table reset/copy/caps; left-to-right glyphs, spaces, distant scratch segments, back-face/distance culling, foreground depth occlusion, duplicate-cell first-wins, RGB scaling/saturation, lighting, empty bindings.
- Existing overlay suite: 22 assertions PASS, unchanged. Mesh structures: 20 PASS. Canonical content: 9 PASS. Working full runner: 228/228 PASS; isolated proposed code: 226/226 PASS; no FAIL/TIMEOUT/WARN. Both dependency checks OK (392/390 files), including content validation and typecheck.
- Mesh browser route on port9542, default mesh physics: all 10 legs complete, no falls, end trigger reached after1818 frames.
- 32-decal fixture, 1000 measured frames after warmup: minimum post-GC heap growth -288 bytes over three trials; mean draw+flush .0129635 ms/frame, below .05 ms budget. No frame strings/objects are created.
- Clean live mesh browser, grid400x150, port9548: six tower decals loaded. Presented foreground readback contains KEEP THE LIGHT in reading order (12 non-space glyphs) and the full StickyBizcuit mason mark (25 non-space glyphs). Real R restart replaces the world and reconstructs identical decal records in both probes; no browser exceptions. Headless full-frame and clipped captures inspected. Letters occupy one scene cell and are widely spaced across the physical baseline; the mason mark is deliberately faint. **PC-A owner look remains required for readability/contrast**, especially at the default grid.
- Live draw+flush timing, 600 samples of100-call batches after100 warm batches: scrawl p50 .003 ms / p95 .004 ms / max .010 ms; mason p50 .006 ms / p95 .007 ms / max .011 ms per call. These are amortized batch samples to avoid the browser clock's .1 ms quantization, not individual-frame quantiles. Local RTX4060, not an Arc result.

## Clean mesh GPU comparison

160x60, RTX4060 ANGLE/D3D11: **71 rows; all70 previous rows have byte-identical metrics; nine known-FAIL rows unchanged under D-039; new decalScrawl PASS**. Existing rtsOverlay is unchanged. No thresholds widened. The known-FAIL table in VOX-CAP-01.md remains the exact baseline.

New pose: eye1.5 m north of KEEP THE LIGHT, yaw180, pitch-23.4, lantern lit. Overlay12 cells, shownTwin12/shownGpu12, hidden0, mismatch0, boundary0. Geometry kind agreement100%; depth/UV/face/z/AO/normal violations0; kind8 counts964/964. Light dLMax .00011551380157470703, dLViol0, litFlip0, sunlitMismatch0. Cell glyph mismatch4, match99.95651701271878%, outside4/.0004166666666666667, foreground max45/background max20; existing cell gate PASS. mesh8a geometry0/0/0, k8Outside1. Capture JSON/PNG outputs from the tool were deleted after diagnostic copies; diagnostics remain outside the commit. No frozen-renderer browser checks.

## Spec and fixture notes for PC-A

- Palette scrawl/scrawlFaint keys reuse existing designer stoneLight/stoneMid values (#b8ab94/#8a7f6e); no new art or authored text. The mason prop gains only the specified optional style:decalFaint field, canonical order preserved.
- M1 production placement rejects nonzero yawSteps. The quarter-turn load test uses a test-only placement adapter to supply the existing makeFrame quarter-turn; the production M1 guard is unchanged.
- World exposes serialized state, not a world hash API. The test compares SHA256 of serialized state before/after changing derived decal data, and verifies round-trip reconstruction.
- The isolated meshStructures heap test repeatedly grew66-67 KB with its old50-frame warmup and per-frame camera literals. It now reuses one camera and warms1000 frames before measuring1000; the64 KiB limit and production renderer are unchanged.
- The new pose requires shown glyphs on both twins. Its hidden0 is valid for this unobstructed view, so it gets its own visibility assertion; the existing RTS branch still requires hidden cells. Other poses/camera projections are unchanged.
