# Batch review 2026-10-12f (PC-B architect opus, owner D-066)
Diffs: e14e44b2 (engine/), 6a84fef5, c1e9cc26 + a13b0d33 + 39a38f34 (engine/). Spec: architecture.md 38.52 + amendments (OB-096, grass mask, tuft atlas). Evidence from main session (carpet / carpet.wgsl 3000 rays 0 mismatches / carpetCells / tuftAtlas PASS; gpucompare Intel 0 PASS->FAIL, carpetMeadow PASS) accepted; no probes run.

## 1. OB-101 class map (e14e44b2) - ARCH OK
- Skipping structures with both bbox sides < 4 m is safe: `rebuildCarpetMask` always stamps every structure bbox (+ feather) into the 0.5 m density mask, and `m < MASK_MIN` = no tuft, so small props keep a hard zero core. Big structures (floors/interiors, OB-096 a) still zero class cells.
- Note (no change): `CLASS_ZERO_MIN_SPAN` is an engine literal; fine as a constant. A small hut < 4 m now relies on the mask only - acceptable.

## 2. OB-101 reach (6a84fef5) - ARCH OK (with a doc follow-up)
- Truncate-nearest-first is correct in both twins (`nSteps = min(steps, NMAX)`, the early `tEnter - margin > best` break unchanged); brute oracle drops the budget and tests compare only steps <= NMAX - right.
- GPU cost: the 10-20x estimate in the lane note was measured at cellM 0.10. With TUFT-01a cellM 0.35 a 12 m disc needs <= ~50 DDA steps, so NMAX 128 never binds on content defaults and per-ray work is bounded by segment length, not by 128. A cheaper bound is NOT required now. Follow-up only if the TUFT-01b GPU p95 (iGPU <= 0.35 ms at 480x180) fails: per-class maxH for setRay, then `carpetRadiusScale`.
- Required doc change (main session / PC-A ratify): 38.52 item 4 ("NMAX 24, never truncated"), the "Do not: truncate a trace at NMAX" line and the tuft amendment "NMAX 24 stays" are superseded: NMAX 128, truncate far side. Truncation cannot slide a visible window at defaults (128 x 0.35 m >> radiusM).

## 3. TUFT-01a part 2 + TUFT-01b (c1e9cc26, a13b0d33, 39a38f34) - ARCH OK for the code; TUFT-01b stays open on its GPU AC
- tuftHit matches the amendment in both twins, same order: pick chain, exact sheared-plane solve, |den| < 1e-6 miss, [t0,t1] + [0,h] + |u|<=1, textureLoad (no sampler), per-stroke wHit cap, nearer plane wins, fade on rank with bladeW. Shape `(hash24*n)>>>24` is exact in JS and u32 WGSL (hash < 2^24, n <= 255). Atlas uploaded once (signature at setCarpet, not per frame); slot 6 rg8ui, block 1056 B; dispose covers texAtlas. Return 2 (exact root cull) not counted as a test - consistent with the <= 2 tests/cell AC.
- Minor (follow-up, no block): JS tuftHit uses `ROOT_JITTER_TUFT` directly while rej/bladeAtCell/WGSL use ctx.rootJit / cu.rootJit (equal today) - use ctx.rootJit for one source. The blade path (`TUFTS=false`, `cu.tufts`) is now dead in production; drop it in a cleanup story once the owner accepts tufts.
- Still open for TUFT-01b done: GPU p95 timing (38.52 budget) and the owner walk-check (clumps, no squares). OB-102 to be verified by the owner.

**Verdict:** 1 ARCH OK; 2 ARCH OK + doc amendment; 3 ARCH OK (code), TUFT-01b closes after GPU p95 + owner walk-check.
**Next steps:** main session amends 38.52 NMAX text; programmer measures carpet GPU p95 (iGPU, 480x180 meadow) and does the rootJit one-liner; owner walk-checks OB-101/OB-102.
