# FLICKER-DEFAULT FD-01 - per-class table (default path, stable pass OFF)

Run: `node tools/flicker-gate.mjs --port 9580 --save --diag` (clone kestrel-2, branch fd01, 2026-10-17, 480x180, rays 4, 9 poses, 30 steps). Baseline saved: `docs/test-reports/flicker-baseline-default.json`.
Columns = % of counted cells (reprojected, same kind+mat); brackets = share of the pose's flips (why.glyphOnly, incl. lineShift). glyphOnly = gated value (lineShift removed). stillPct = 3 zero-move steps with wind on (time, not camera).

```
DEFAULT CLASSES (% of counted cells; share % of the pose flips in brackets)
pose         glyphOnly stillPct        edge   lineShift     linePop    lineCode   m255:stip  m255:blank  m255:other        anim     altSwap  levelLight    levelTex
wallNear          3.69     1.71    1.25(31)     0.22(6)    0.86(22)     0.11(3)     0.00(0)     0.22(6)     0.00(0)     0.00(0)     0.15(4)    0.72(18)    0.45(11)
wallFar           6.54     0.00     0.56(6)    3.08(31)    2.49(25)    1.23(12)     0.00(0)     0.07(1)     0.00(0)     0.00(0)    1.67(17)     0.04(0)     0.81(8)
bushes           10.92     0.01    2.00(14)    2.02(14)     1.33(9)     0.02(0)     0.09(1)     0.25(2)     0.11(1)     0.00(0)    4.12(29)     1.23(9)    3.09(22)
crown             6.00     0.00    2.51(24)    2.66(26)    1.52(15)     0.75(7)     0.00(0)     0.45(4)     0.00(0)     0.00(0)    1.09(11)     0.30(3)    1.11(11)
grassFar          3.87     0.01    0.55(10)    0.95(18)    1.88(36)    1.05(20)     0.00(0)     0.01(0)     0.00(0)     0.00(0)    0.68(13)     0.02(0)     0.11(2)
roadWalk          5.07     0.70    0.81(15)     0.17(3)     0.16(3)     0.06(1)     0.00(0)     0.19(3)     0.00(0)     0.00(0)    3.56(64)     0.26(5)     0.33(6)
forestWalk       11.40     0.53    2.25(18)     0.50(4)     0.36(3)     0.07(1)     0.00(0)     0.00(0)     0.00(0)     0.00(0)    7.19(57)     0.44(3)    1.90(15)
townWalk          4.80     0.33    0.90(10)    3.72(41)    1.67(19)    1.15(13)     0.00(0)     0.15(2)     0.00(0)     0.00(0)    1.02(11)     0.09(1)     0.27(3)
cryptWalk        15.98     5.55     1.44(7)    3.15(16)    7.68(38)    3.20(16)     0.02(0)     0.10(0)     0.01(0)     0.00(0)     1.16(6)     1.53(8)     1.67(8)
jump sub-counts: wallNear lvLight 0.03 lvTex 0.00; wallFar lvLight 0.00 lvTex 0.00; bushes lvLight 0.18 lvTex 0.03; crown lvLight 0.02 lvTex 0.02; grassFar lvLight 0.00 lvTex 0.00; roadWalk lvLight 0.04 lvTex 0.01; forestWalk lvLight 0.01 lvTex 0.00; townWalk lvLight 0.06 lvTex 0.00; cryptWalk lvLight 0.02 lvTex 0.00
```

Mean over the 9 poses (% of cells): altSwap 2.29, linePop 1.99, lineShift 1.83, edge 1.36, levelTex 1.08, lineCode 0.85, levelLight 0.51, m255:blank 0.2. Shares of all flips: altSwap 23 %, linePop 20 %, lineShift 18 %, edge 13 %, levelTex 11 %, lineCode 8 %, levelLight 6 %.

Reading (for the architect, re-order FD-02..04):
- `levelLight` is small everywhere (>= 1.0 only in bushes 1.23, cryptWalk 1.53): FD-02 (bilinear sun PCF) is justified for bushes only.
- `linePop + lineCode` >= 1.0 in cryptWalk (10.9), wallFar (3.7), grassFar (2.9), townWalk (2.8), crown (2.3): FD-03 is justified.
- `levelTex` >= 1.0 in bushes (3.09), crown (1.11), forestWalk (1.90), cryptWalk (1.67): FD-04 justified in those.
- `altSwap` (same ramp level, other glyph = dice/setId) is the LARGEST class (forestWalk 7.19, roadWalk 3.56, bushes 4.12) and no FD-02..04 fix touches it - needs its own story.
- `lineShift` (filtered out of glyphOnly) is 0.2-3.7 %, `edge` 0.6-2.5 % (cells at silhouettes).
- stillPct is small except cryptWalk 5.55 (torches) and wallNear 1.71, roadWalk 0.70: time animation is not the main cause.

Notes: the default path measurement builds the pipeline with `stable=1` (allocates shade's texLevel target; main.js untouched) and `flickerdef=1` switches the stable pass off before measuring (stableOn=false, stableRan=false in the result). Run-to-run noise ~+-0.3 (wallNear 3.69 here vs 2.86 in the architect's baseline, townWalk 4.80 vs 5.62).
