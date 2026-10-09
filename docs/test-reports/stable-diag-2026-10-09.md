# STABLE-DIAG-01 - why the US-073 stable pass did not change flips (2026-10-09, kestrel-2)

Tool: `node tools/capture-browser.mjs --mode flicker --backend webgpu --port 96xx --query "flicker=1&stable=1&stablediag=1&backend=webgpu"`
(`game/js/dev/modes/stableDiag.js`; GPU readbacks of frames N-1/N, twin reject chain replayed per cell). Pose: flicker pose, 160x60 grid,
90 frame pairs (fwd/strafe/yaw, 0.02 m / 0.1 deg), 826175 non-sky cell-pairs, 2786 surface-key changes (stable can't touch those).

## Root cause: (d)-class wiring bug, NOT a rule problem
`stable.wgsl.js` tested the WATER layer word unconditionally. With no water drawing, `WgStablePass` binds a **1x1 dummy** texture;
out-of-bounds `textureLoad` returns 0, and `0 != 0x7f800000` read as "water cell" -> **every cell rejected as fresh**, on all frames.
gpucompare `stable pan` passed because the pose has a real full-size WATER layer bound (and fg/bg barely differ there), and the twin
comparison only checks the GPU against the twin on that data. Evidence before the fix: of 445382 cells the twin says "took history", GPU
output == final in all of them (rgb and glyph); of 13977 "took + level delta <= 1 + hist glyph != cur glyph" cells GPU out = cur glyph in all
(twin: hist). diffN = 0 on the last frame. Uniforms (histValid, dEye, grid, snap) were correct.

## Fix (implemented, 3 lines + test)
`StableU.pad0` doubles as `waterOn`; WGSL `if (u.pad0 != 0 && wl.x != 0x7f800000u && ...)`; `WgStablePass.run` writes it from
`inputs.waterOn`; `WgCellPipeline._runStable` passes `inp.waterOn = wOn`. `stable.wgsl.test.js` probe sets pad0 = 1 and asserts the gate text.
After: GPU out = hist glyph in 99051/99051 held cells (== twin). Layout/size unchanged.

## Histogram (flips = same surface key, glyph differs N vs N-1; 68463 flips stable OFF; same data)
| class (cell N) | all cells | flips off | flips ON (after fix) |
|---|---|---|---|
| took history | 445382 | 21852 | 11775 |
| level 255 cur (non-ramp glyph) | 294673 | 29154 | 29141 |
| level 255 hist | 16202 | 10970 | 11023 |
| edge cell | 31910 | 1568 | 1391 |
| UV drift >= 0.5/detail | 34944 | 4905 | 4902 |
| out of grid / hist kind | 278 | 14 | 14 |
UV drift overshoot: 1-2x limit 23672, 2-4x 8597, 4-16x 2638, >16x 37 (so (a) is minor: ~8 % of cells, 7 % of flips).
Took-history flips: level delta 0 = 21164, 1 = 688, >1 = 0 (so (c) is absent). Of took flips, 10471 are same-level glyph changes (hist != cur), now held.
Dominant remaining class: **level 255 (cur or hist) = 60 % of flips** (non-ramp glyphs: texel/grid/overlay glyphs) - the rule never touches them (38.25 item 4).

## Result
changed-glyph share (gpuRow.avg, same run set): stable OFF 8.61 %, stable ON before fix 8.61 % (ratio 1.00), **after fix 7.37 % (ratio 0.86)**.
Target <= 0.6 not met: even a perfect stable on all "took" cells (21852 -> 0) leaves 46 611 / 68 463 = 0.68; more is needed from level-255 cells.
(`&lit=1` had no effect on the numbers in this mode - unlit still; not investigated.)

## Proposed story rows
- **STABLE-LEVEL255-01** [B2/ASK ARCHITECT, changes 38.25 item 4]: allow history for level-255 cells too (hold glyph when kind/plane/UV match and the *glyph* code is a texel glyph, i.e. replace `level == 255` rejects by a rule "level 255 both sides: hold glyph if UV drift < lim", keep sky/model/edge/water rejects). Expected: flips 68463 -> ~28000 (level255 cur 29154 + hist 10970 mostly become held) => ratio ~0.45-0.55. Risk: a held non-ramp glyph (e.g. gradient/overlay glyph) lags animated materials; limit by kind/material flag.
- **STABLE-UVLIM-01** [B2, small]: UV window `0.5/detail` -> `1.0/detail` (or use the cell's real texel density instead of DEFAULT 16): recovers ~3-4k of 4905 uvDrift flips => ratio -0.05. Needs architect OK (38.25 rule).
- **STABLE-GATE-TEST-01** [B2]: gpucompare `stable` row must run once with water inactive (dummy) so this class of bug is caught (`used%` of the GPU, not only the twin, e.g. compare GPU out != final count).

## 38.25 amendment measured (STABLE-GATE-TEST-01 + UVLIM-01 + LEVEL255-01a/b, 2026-10-09, kestrel-2, uncommitted)
Same command and pose (160x60, 90 pairs, 826175 non-sky cell-pairs). Changes: UV limit 1.0/detail, level 254 'animated', mixed 255/ramp fresh,
both-255 hold unless fg snapped (anchor u/v), flags default OFF (`?stable=1`).
changed-glyph share (gpuRow.avg): stable OFF 8.61 %, stable ON **6.92 %** -> **ratio 0.80** (was 0.86; target <= 0.6 NOT met; the estimate 0.57 was too optimistic).
Flips (same surface key): OFF 68463, ON 54509 (0.80). Per class (cur-frame cell), flips ON / cells: took ramp 12607 / 469054; **both255 6656 / 202760**
(was ~11000 + 29141 flipped as 'level 255', now held mostly); **mixed255 22840 / 32130 (71 % of those cells flip, the biggest remaining class, 42 % of ON flips)**;
uvDrift 10403 / 64338; edge 1972 / 54579.
Why UVLIM gave little: 60706 of 64338 uvDrift cells are at 1-2x the (now 1/16 m) limit, while the camera moves 0.02 m/frame. The drift is the
nearest-history-cell offset (up to half a cell footprint, 0.1-0.3 m at range), not motion, so a fixed 1/detail limit rejects most distant cells; a limit
scaled by the cell footprint (needs per-cell footprint, e.g. from GD/deriv) is the lever, not a bigger constant. mixed255 (ramp<->non-ramp across the
reprojected neighbour) is the other: when a texel/ramp boundary sits on a cell, the 1-cell history offset flips the class between frames.
gpucompare (webgpu, RTX 4060): `stable pan` sub-case water inactive PASS (used 66.1 %, held twin/gpu 501/501, held255 1222, ties 0.458 %, 0 mismatches);
sub-case water drawn (water pond top-down, waterOn true) PASS (live 48.3 % of non-sky, held 541/541, held255 3365, ties 0 %, 0 mismatches). The 2 FAIL rows
(crash room, voxel half occluded) are the recorded known-FAIL rows of the baseline. No new rows, no regressions in the stable-off rows seen.
Not decided here (architect note says no further rules without a new note): footprint-scaled UV limit, and a mixed255 rule (e.g. allow mixed when the
current cell is on the same reprojected ramp level +-1 and fg is within snap).
