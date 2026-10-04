# ME-14c3 A5 findings — 2026-10-04

NEEDS PC-A: A5 STOP. outsideNear now PASS, but parapetSky still FAILs with eight mismatched kind-9 cells whose permitted hash keys are identical. All ME-14c3 implementation/content remains local and unpublished; ME-14c4 remains gated.

The programmer implemented the exact same-plane AO tolerance bound, the optional glyph/colour skip mask (poison checks stay active), proven kind-9 detail/grid texel ties and the 16-cell cap. GPU derivatives are read for diagnostics and octave flips are never excluded. No colour/glyph/depth/light bar, placement, asset or shader was changed for A5.

Focused comparison checks: 46/46 (+8: three required AO cases and five mask/poison cases), all three comparison suites PASS. Isolated prospective checkout based on 5264697, with only Ruins changes and no unpublished sword changes: 217/217 suites PASS, typecheck PASS, check-deps OK (383 files). Main sync before A5: 218/218 suites PASS, deps OK. Prior A1-A4 normal/performance/shadow evidence remains in ME-14c3-amendment-findings.md.

## Real-GPU evidence

RTX 4060 / ANGLE D3D11, mesh, 160x60. Baseline d3d7e3c outsideNear: index 8055 (55,50), kind 2 on both twins, plane 50331654 on both, AO .12694193422794342 / .12810683250427246; depth/u/v pass. Its difference exceeds the original AO bound, proving the previously exposed AO violation predates the Ruins implementation.

A5 full run: 69 rows, five FAIL (four unchanged baseline failures plus parapetSky). outsideNear PASS: aoViol=0, violNonMesh=0, 12 proven texel ties. Ruins PASS. No previously passing baseline row regressed. The four baseline failures are voxel half occlusion, rtsHill60, cloth and pitched sword rest.

parapetSky: geometry and light PASS, one proven tie at (24,56), five non-edge glyph mismatches remain (99.0636704% match), eight colour-outside cells (1.1034483%). Allowed keys for the excluded cell are [-22,312,10,-1] / [-21,312,10,-1], kind/face/mat/plane 9/2/1/-535822171 on both twins; octave -3 on both. Full-run and single-pose diagnostic run agree.

## STOP cells

All eight below are kind 9 and material 1 on both twins; face and plane agree. Each JS/GPU key tuple is identical, and both octaves are -3. Keys are [floor(u*detail*4), floor(v*detail*4), course, bix]. No exclusion or parity fix is permitted for them by A5.

| Cell | Face | Plane | JS u,v | GPU u,v | Keys (both) | JS/GPU tpc |
|---|---|---|---|---|---|---|
| (22,52) | 2 | -535821943 | 0.0194920469075441, 5.68115091323853 | 0.0194920282810926, 5.68110942840576 | [1,409,14,0] | 6.03083324432373 / 6.04403400421143 |
| (25,52) | 1 | -535821689 | 0.555429637432098, 5.6827974319458 | 0.555429577827454, 5.68279647827148 | [39,409,14,0] | 6.06098556518555 / 6.06100434064865 |
| (22,57) | 2 | -535822270 | 0.0194920469075441, 4.005202293396 | 0.0194920282810926, 4.005202293396 | [1,288,10,0] | 6.03306913375854 / 6.03306913375854 |
| (25,57) | 1 | -535821935 | 0.555429637432098, 3.99974250793457 | 0.555429577827454, 3.99934768676758 | [39,287,10,0] | 6.06050062179565 / 6.06650018692017 |
| (22,58) | 2 | -535822270 | 0.0194920469075441, 3.67003178596497 | 0.0194920282810926, 3.67003178596497 | [1,264,9,-1] | 6.03327083587646 / 6.03327083587646 |
| (25,58) | 1 | -535821935 | 0.555429637432098, 3.66304802894592 | 0.555429577827454, 3.66231989860535 | [39,263,9,0] | 6.06231594085693 / 6.0653178691864 |
| (22,59) | 2 | -535822270 | 0.0194920469075441, 3.3348388671875 | 0.0194920282810926, 3.3348388671875 | [1,240,8,0] | 6.03347253799438 / 6.03347253799438 |
| (25,59) | 1 | -535821935 | 0.555429637432098, 3.32615184783936 | 0.555429577827454, 3.3254234790802 | [39,239,8,0] | 6.06413125991821 / 6.06413555145264 |

NEEDS PC-A: next permitted investigation/fix for these equal-key kind-9 shade mismatches. No additional debugging or fix was attempted after the explicit STOP. Browser checks used tools/serve.py on owned ports 9880/9900/9910; a failed setup capture on 9890 was stopped by its exact owned process tree. Capture JSON/PNGs were removed; diagnostics remain untracked under .codex/ME-14c3. No frozen DDA check ran. Existing sword edits remain local.
