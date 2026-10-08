# Owner walk-test checklist - 2026-10-08 (S8-A-16)

Server: http://localhost:8000/ . Report each item as `ok` or `not ok + one word`. Sources: batch-review-2026-10-08.md owner to-dos, PC-A handoff (backlog.md), lane logs, triage sheet.
Branch: **master** = merged (d1d6f23: pc-b through WG-4b / ALPHA-01b). **not on master yet** = pc-b / pc-b2 / pc-c only (pc-c merge was blocked on 2 fixes, now ARCH OK; check `git log master` before testing).
Exact paths are quoted from the reports; where none is stated it says "path: ask lane X".

## A. 5-minute looks (one page, one glance)
- [ ] **WebGPU vs WebGL2 look** - open `game/index.html?backend=webgpu`, then `?backend=webgl2`. Good: shadows, water, sprites and HUD overlay look the same. Report: ok / not ok + which (shadows/water/sprites/overlay). Branch: master.
- [ ] **Wake-up eyelid blink on WebGPU** - `game/index.html?backend=webgpu`, reload and watch the wake-up. Good: the eyelid blink is visible (CPU `drawEyelid` hidden once the GPU owns the frame is the suspected bug). Branch: master.
- [ ] **Shadow cast distance** - `game/index.html?pose=roadSouth&shadowcast=25` vs `?pose=roadSouth`. Good: shadows reach as far as expected, no obvious pop. Report: ok / not ok + which. Branch: master.
- [ ] **Boar shadow distance** - walk to a boar, back away at 10, 25, 40 m (with `?shadowcast=25`). Good: boar shadow does not pop or vanish earlier than the prop shadows. Branch: master.
- [ ] **ALPHA-01c leaves on WebGPU** - path: ask lane B1 (no live page with the leaf fixture yet). Good: leaves show cut-out shapes, not opaque blocks. Branch: pc-b, not on master yet. (ALPHA-01b alone has no visible effect.)
- [ ] **ALPHA-01d soft-edge fixture on WebGPU** - path: ask lane B1/B2. Good: soft leaf edges, no hard fringe. Branch: not on master yet.
- [ ] **S8-C-12 quest-log preview** - path: `http://localhost:8000/game/js/ui/questLog.preview.html` (pc-c, merge pending; use `?backend=webgl2` on the Arc if it is blank). Good: log lists objectives readably. Branch: pc-c, not on master yet.
- [ ] **US-090a title menu** - path: `http://localhost:8000/game/js/ui/titleMenu.preview.html` (on master; module only; wiring is US-090w/S8-B1-01). Good: New/Continue/3 slots/Settings are readable and keyboard-navigable. Branch: pc-c, not on master yet.

## B. 15-minute checks (play or short walk)
- [ ] **GFX-01w boot grid + settings on the Arc** - `game/index.html?backend=webgpu` on the Arc. Good: boots at 400x150, settings menu opens and changes apply. Branch: pc-b, not on master yet.
- [ ] **Editor: H help overlay + placed-mesh drag** - path: `http://localhost:8000/tools/editor/index.html`. Good: H shows help; a placed mesh drags and drops without jumping. Branch: pc-c, not on master yet.
- [ ] **Editor: import one of your own .vox files (S8-C-20a)** - path: `http://localhost:8000/tools/editor/index.html`. Good: it appears, selects, one Undo removes it, Redo restores it, no console errors. Branch: pc-c, not on master yet.
- [ ] **MESH-SCALE-01 scaled mesh live check** - path: ask lane B2. Good: one scaled mesh renders and collides at its new size. Branch: pc-b2, not on master yet.
- [ ] **Earlier mesh to-dos (still open)** - `?pose=roadSouth` for road lag + moss look, bump rocks/trees/wall lamp, stairwell cloth, gondola fall retest; boar demo walk (sword L/R, fireball tap/hold, loot, `I` pack + eat meat); editor terrain brush. Branch: master (check).

## C. Measurements on your hardware (command or numbers needed)
- [ ] **Chart freshness** - run `node tools/bake-chart.mjs --check --index`. Good: reports fresh (else rebake per `tools/editor/README.md`). Branch: pc-c, not on master yet.
- [ ] **GFX-04 p95 numbers** - re-measure Low/Medium on an idle Arc and High/Ultra on the 4060 (also confirm Ultra auto-pick on the 4060). Path: ask lane B1 / PC-A (GFX-04 is PC-A's). Report: p95 ms per preset.
- [ ] **Electron probe** - run the EP-DESKTOP-SPIKE probe in `tools/desktop/` (lane C log f79e6dc; command: ask lane C). Good: game boots from disk with WebGPU. Branch: pc-c, not on master yet.
- [ ] **WG-4c gate** - `game/index.html?pose=roadSouth&backend=webgpu`, gpucull on and `?gpucull=0`. Good: identical image, p95 no worse with cull on. Needs MESH-PERF-01 Arc numbers first (PC-A). Branch: master.

## D. Only after a later story lands (do not test yet)
- [ ] Play-time label after S8-B1-01 (Continue loads the S8-B1-01 save).
- [ ] ALPHA-01e, WG-5a/5b, QUAT-TREES-01 (`?pose=roadSouth` + forest walk) once B2 TREES-LP-b/c land.

## Decisions needed (owner)
- [ ] **BACKLOG-TRIAGE sheet** (`docs/backlog-triage-sheet.md`): all Decision cells are blank. Advisory counts for US/ME/PX rows: 168 rows = keep 136, drop 9, archive 23 (US 135: 110/4/21; ME 24: 17/5/2). WG (21) and MESH (7) rows are unclassified, left to their lanes. Answer: accept all advice / list exceptions. Janitor archives after you decide.
- [ ] **Editor US-031..034 archive** - sheet recommends archive after your editor sign-off (covered by the editor checks in B).
- [ ] **Cog currency** - not found in sprint-8-queue, decisions.md or lane logs: ask the manager which doc holds the question.
- [ ] **Lint scope** - not found in the same docs: ask the manager which doc holds the question.
- [ ] **Licences (sprint-7 owner decision 5)** - publisher URLs + terms for Ruins, Voxel Pack, Cozy Nature, StickyBizcuit in `docs/licences.md`; Ruins redistribution finding escalated to the manager (D-046 revisit); US-116 engine licence.
- [ ] **PX pixel-output engine work** - sheet keeps it deferred; game stays ASCII pending your decision.
- [ ] **QUAT-LOD-01** - pick LOD1 meshes from a preview (no silent decimation); path: ask lane C.
- [ ] **MESH-FULL-01** - 4 of 37.19 items fail; you said leave to PC-A (recorded; no action unless you change this).


Note (PC-A): lint scope is decided (D-049: first lint step = current inline refs only). `cog` currency is still an open owner question. Paths not listed above are not stated in any lane report yet - ask the lane.
