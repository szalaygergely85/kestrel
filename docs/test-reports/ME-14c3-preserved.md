# ME-14c3 preserved candidate - 2026-10-05

Status: **NEEDS PC-A: resolve the existing parapetSky GPU regression before activating this patch.** The complete candidate is preserved on `wip/pc-b-me14c3` as `docs/work-in-progress/ME-14c3.patch.gz`, based on master a1b6a86. It includes all 26 source/asset/test changes, so earlier work is recoverable without keeping dirty shipping files. The WIP branch contains the archived proposal, not an active renderer change; merging that branch alone does not apply the patch.

The earlier local patch was three-way integrated with master, retaining D-043 shadow-map defaults and ME-15f tree-shadow changes. Programmer audit found A1-A5 twins and authorized tolerances intact. Unrelated vmhide diagnostic logic was removed. The content test now asserts <=4,000 triangles per piece and <=30,000 total. PillarRound is 3,448 triangles and WallBrokenMD 3,214 (6,662 total), with flat normals; THIRD_PARTY_NOTICES.md covers the original Ruins CC0 GLBs. Unreferenced burner.vox/map and old diagnostic files were moved into a reversible local archive, not added as unverified third-party assets.

## Proposed-code checks

- Twelve focused suites PASS. Full candidate **224/224 suites PASS**, zero FAIL/TIMEOUT/WARN, including typecheck/content; explicit check-deps OK: 396 files and 1,306 advisory warnings.
- Real-GPU master baseline: **140 rows, seven existing FAIL**. Candidate: **142 rows, eight FAIL**. Both new Ruins rows (main and shadow-depth parity) PASS; outsideNear remains PASS. The only previously passing row that regresses is **world_m1: parapetSky**. No thresholds were changed to bypass this.
- parapetSky geometry and lighting both PASS: kind/depth/u-v/face/normal/material/AO violation counts are zero. Glyph match is 99.31600547195623%, with five glyph mismatches. Eight cells are outside colour bounds, max foreground difference 42 and background difference zero. One independently proved texel tie is accepted; eight equal-key kind-9 cells remain unresolved: (22,52), (25,52), (22,57), (25,57), (22,58), (25,58), (22,59), (25,59). These match the earlier PREC-02 class, now measured under shadow-map defaults.
- Exact per-cell CPU/GPU u/v, derivative tpc, keys, and all seven prior failures are preserved in the WIP branch's `ME-14c3-gpu-findings.json`. In particular at (25,57), v=3.9997425079345703 vs 3.999347686767578 and tpc=6.060500621795654 vs 6.066500186920166.
- D-039 permits precision FAILs for new poses, but requires every previously passing row to remain PASS. Since the current master parapetSky row passes, this candidate remains inactive. The programmer does not widen tolerances or silently redefine that gate.
- Only owned ports 9510/9512 were used. Generated capture JSON was copied for evidence, then removed from the capture directories; no DDA checks and no owner-server changes.

## Recommended next step

**NEEDS PC-A: recommend A — keep the archived proposal inactive and complete the already specified PREC-01a camera-relative work before re-running ME-14c3, because the current master row regresses. Alternative B — PC-A explicitly reclassifies the affected Ruins portion as an approved new-content baseline under D-039; that needs an explicit exception to the existing-row rule.** The archive supports either answer. No owner-visible renderer rollout is claimed.

PROP-COLLIDE-01b was completed and pushed independently as 7a480f4, with 224 full suites and all ten browser route legs passing. The main pc-b checkout no longer contains these older renderer edits.
