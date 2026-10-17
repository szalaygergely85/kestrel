# Batch review 2026-10-12c (PC-B architect, opus; D-066 PC-B may sign)

Spec: architecture.md 38.52 (OB-073 D2), 38.51 (STREAM-01). Diffs read via `git show`; no probes run (nothing looked wrong enough).

## Part A - ASK ARCHITECT answers

### OB-073-D2c (f4b4fe84)
1. **0.4-1.2 KB/frame alloc in carpetCells/bladeHit: accepted, not blocking.** 38.52 puts the 0-alloc rule on the live JS frame (uniform pack only). `carpetCells` is the gpucompare/Node twin, and live JS/Canvas2D runs with the carpet off. Keep a guard in carpetCells.test.js (<= 2 KB/frame) so it cannot grow. Cheap fix if someone touches it: V8 boxes doubles stored into object out-params whose fields started as Smis. Return the hit through a module `Float64Array` scratch (`_hit[0]=tB, [1]=h01, [2]=lean, [3]=variant`), or initialise the out fields with non-integer doubles.
2. **Ramp must be 0..255 RGB: correct, per spec.** The game resolves palette keys to RGB, and the engine never reads palette keys. Change: validate once in `carpetCtxFor` / at World-opt load and throw there with the variant name. Not inside `grassTableFor` on the first carpet frame.
3. **Lean glyph order: the spec default is backwards. Fix it.** `v < 0` means the tip leans to the screen left. Such a blade runs from bottom-right to top-left, which is `\`. So the defaults are `leanL = '\'` and `leanR = '/'`. PC-A should amend the 38.52 item 6 comment to read `, | ' \ /`. Content can still override it via `glyphs`. The designer only needs to judge the look.
4. **No stable level byte: OK for D2c, required in D2e.** Spec 38.52 item 7: a carpet cell writes its ramp level like a mesh cell. Do it in D2e, together with the ramp/glyph table, using the same quantisation in both twins (level = ramp index from h01 + hash shift). Until then a kind-10 cell behaves like terrain (no hold). The carpet is off by default, so that is acceptable.

### OB-073-D2d (b58fbbc1)
1. **Fullscreen render pass into scratch GI/GA/Depth + alias, not compute in place: accepted.** It is equivalent and avoids adding storage textures to GpuDevice. Conditions:
   - every non-carpet cell passes its input through unchanged (no discard holes);
   - the HZB is still built from the pre-carpet depth;
   - all downstream passes read the alias.
2. **No timer slot (16 used), cost counted in 'light': accepted for now.** Measure the budget as the carpet on-minus-off delta of the total GPU frame. Follow-up for PC-A: raise the WG timer query count 16 -> 32. A query set is cheap. This is a small GpuDevice item, not part of D2.
3. **Class map + own r32f near-height texture in passCarpet.js: accepted.** They are not grid-sized, so the pass owns them. Rules:
   - upload only on a version bump (near-band rebake hook, 38.38), never per frame;
   - use the same `nearH` source as the JS twin;
   - dispose both in `dispose()`.
4. **32 B variant table: accepted.** The ramp/glyph table comes in D2e. Total GPU memory must stay <= 16 x 64 B.
5. **Local KIND_GRASS: change before merge.** D2c has landed, so import `KIND_GRASS` from GBuffer.js into carpet.wgsl.js, as the other constant exports are. One source of truth.
   - **DEPTH:** the depth must be in the same convention the GPU terrain/cast passes already write for that projection. If that is distance along the non-unit pitched ray, fine. D2e gpucompare confirms it.
   - **Pitched frames:** D2c skips pitched frames ("shear only"), so the GPU pass must skip them too, the same way as ortho. Otherwise the twins diverge. Pitched support is a later step for both twins together.
   - **f32 world coords:** required in D2e, before the 98 % bar. Pass the lattice origin as i32 cell indices `ix0/iy0` (snapped in f64 on the CPU), plus camera-relative f32 offsets (PREC-01a rule). Then `floor(xy/cellM)` cannot flip at lattice borders around x ~ 1000-2000 m.

## Part B - verdicts

- **3baf75d6 OB-089: ARCH OK.** passRaster.js:193-196 is correct: LOD1 of a masked group uses the open pipe, with or without the AO variant, and the test covers both cases. Note: `meshIsMasked` runs per entry per frame (a small loop, 0 alloc). It could be cached on the group, but that is optional.
- **5b049ad9 OB-088: ARCH OK with notes.** interaction.js `shapeEntry` (113-130): the slab test in the shape frame is correct and allocation-free. The union AABB is kept as the broadphase. The inside-cone check now uses the hit shape's centre, which is good.
  - World.js ~1810: the new JSDoc block was inserted between `propPickBox`'s doc and its function, so the `propPickBox` doc now sits above `propPickShapes`. Move it.
  - `propPickShapes` duplicates the def lookup in `propPickBox`. Optional: factor it out.
  - Cylinders pick as their square box. That is fine.
- **29b6c067 B1 batch: ARCH OK.**
  - `startFor`: the frozen constants are fine.
  - `?stream=0` runs after loadWorld. Fine.
  - The F3 line `Array.from(g.classCells).join('/')` allocates, but only while F3 is shown. That is accepted (dev overlay).
  - The quest prereq is content.
- **662b22f2 BEAR-01: ARCH OK with notes.**
  - Per-slot loseR/leashR/aggroR (beastSim.js:328, 370, 450) are identical for boars and wolves (wolfOverrides sets no loseR), and the sim stays deterministic.
  - Note: sight still uses the shared `sim.cfg.noticeR` (l.355), so `bearOverrides().noticeR` is dead. It only works because both are 12. Read `sim.scfg[i].noticeR` there, or drop the field.
  - The `sink` clip is missing on bearBlack. That is for the designer.
- **d110d355 STREAM-01c: ARCH OK.** 734 is right if "size" is the half-extent: 2r/(r*734) = 2.72e-3 rad = HFOV75/480, one cell. The 38.51 figure of 400 was short by 1.8x. PC-A should amend 38.51.
  - bootPrefetchHook.js reads the private `g._pending`. Add a public getter `pending` to placementGrid.
  - PC-A: check the extra active placements (+80..200 of 2288) against the D-007 budget in the next gpucompare/bench run.
- **Memory AC finding (94/95 meshes resident on every leg).** On world_m1, residency per placement cannot cut payload bytes, because a few distinct meshes are reused everywhere. **PC-A decides. Recommendation: (a)** mark the "Outwall <= 60 % of tower" AC as N/A on world_m1 and assert it on a synthetic world with unique meshes per region (this proves the mechanism). **(b)** If real memory pressure appears later, open STREAM-02 "far-LOD-only payload residency" (unload LOD0 payloads beyond a per-mesh distance). Do not raise warmM or lower reach to force the AC.
- **0da8ba32 STREAM-01b notes: ARCH OK.** DrawList.js: the shadow feed never classifies the grid. A fresh grid gives the full list, otherwise the grid's `lastX/lastY` are used. reach, lazy-warm and request now share one xy AABB metric, `bboxDistXY`, which is 0 alloc.
- **c0f44dc5 OB-090: ARCH OK.** Content/tool only. fordZ -89.85 gives a 0.2 m column over the -90.05 bar, still wadeable. Shallow colour and tintDepth are design.
