# BUG-VERIFY-001 — typecheck and voxel-atlas boot blockers

Owner requested that the remaining typecheck and browser-boot blockers be solved. This patch also publishes the preceding allocation-test warm-up corrections.

## Changes

- `engine/core/commands.js`: annotate saved command records as tuples, so numeric sorting is checked as arithmetic on numbers instead of a number/array union. No runtime change.
- `engine/render/gpu/MeshBuffers.js`: declare the `version` and `mesh` fields that cache entries already return. No runtime change.
- `design/models/sb_stonewall.js` / `sb_village.js`: retain the imported tile library on the existing mesh-only route, including pieces that individually fit the legacy DDA model limits. Their combined voxel storage exceeded the shared DDA atlas budget. Only routing metadata/comments changed; geometry, materials, colours and creative design are unchanged. The imported tiles remain available to mesh rendering; they are explicitly unavailable in DDA, as other mesh-only imports already are. None of these tiles is currently placed in game content.
- `engine/render/gpu/VoxelTextures.test.js`: bind the actual 19 stonewall/village assets plus an ordinary DDA model. Assert all imports remain packed for mesh use and absent from the DDA atlas; the ordinary model retains index zero and its original atlas size. The 256-row overflow assertion remains.
- Particle/shadow tests warm the exact measured workload; 64KiB limits stay unchanged (see separate heap report).

The complete game registry's DDA atlas shrank from **112,161 texels / 439 rows** to **38,433 texels / 151 rows**. No atlas limit was raised, runtime library added, or per-frame allocation introduced.

## Verification

After synchronization through master/pc-a **0903a6c**, full runner: **199 suites, 199 PASS, 0 FAIL, 0 TIMEOUT, 0 WARN**. Standalone typecheck passes. Dependency check: **check-deps OK, 363 files, 1280 existing warnings**. Atlas tests **33/33** including heap check. Particle/shadow suites pass repeatedly with their original limits.

Real-GPU browser: both renderer paths boot. DDA start-pose comparison passes at 160x60 with 100% glyph agreement and zero geometry violations. Mesh full comparison completes on RTX 4060 D3D11; all seven water poses pass after local harness-table/float-precision corrections. Four non-water rows still FAIL: voxel half-occluded stair edge, rtsHill60, cloth, and pitched sword. These four also failed in the initial browser run of this session; the final run adds no new FAIL rows. No thresholds were relaxed. These findings remain for PC-A's existing parity review.

The water implementation and its harness refinements belong to the earlier unfinished Q14 water items and remain separate local work; their browser results are context, not a claim that they are included in this blocker-fix commit. Main.js was not edited in this patch. Earlier queue edits, local config, raw assets and old captures were preserved. No new capture JSON/PNG was retained.

Git synchronization merges have now been completed after all-suite-PASS checks. The fix is submitted for **arch-review**; it is not architect approval.
