# Lane C queue, timing and heap audit (2026-10-09)

Completed the explicit fallback in QUEUE UNBLOCK item 8 after shipping mesh live
patches and prefab editing. No game/engine/design/content changes.

Current queue blockers, rechecked after fetch/merge:
- NEWPACK-01/02: lane log names docs/sprints/sprint-8-queue.md section
  "New Quaternius packs", but no such section or story IDs exist there.
  design/meshes/source/ is absent in both the clean continuation clone and
  the owner's original checkout. No matching new-pack notice was found.
  NEEDS PC-A: recommend push the named spec, source availability/path and
  allowed-pack notices before C builds the requested preview; alternative
  explicitly identify an already-shipped pack and authorize that preview.
- QUAT-TREES-01/QUAT-GROUND-01: imports and meshGroup seam exist, but the
  current meshGroup initializes only part 0 (instances.js:346-347), matching
  batch 20's ALPHA-01f-fix blocker for masked multi-range geometry. The owner
  leaf look is still described as strange/not final in the B2 lane log.
  Recommend land the B2 fix and PC-A species/material/spacing/ground weights
  plus owner leaf acceptance; alternative explicitly authorize a separate
  opaque hand-placed preview. C does not change renderer or invent art choices.
- Chest/boar/spawn: proposal already published; owner approval still pending.
- Desktop spike and node_modules gate follow-up already shipped and reviewed;
  the old WG-3f dependency note is historical, not new work to repeat.

README doc pass corrected two stale statements: H requires H again to dismiss;
prefab directory Save now explicitly writes the file and manifest to the chosen
content directory. No rendered change, so no new screenshot required.

Initial full sequential gate: 371/372 PASS, terrainStroke FAIL; isolated rerun
1/1 PASS at 1,942 ms. The initial default log did not retain its assertion output;
no cause is claimed (the suite includes a <=150 ms rescatter check). Final full
rerun with detailed JSON on failure: 372/372 PASS, zero FAIL/TIMEOUT/WARN.
Initial audit timings: 86 scoped suites, 85 <=5 s; beastSim.test.js 18,328 ms.
Slowest editor suite terrainBrush.test.mjs: 1,568 ms. Final timings: 86 scoped suites; 85 <=5 s; game/js/quest/sim/beastSim.test.js 16,428 ms; slowest editor tools/editor/terrainBrush.test.mjs 1,492 ms.
Scope means tools/editor, tools/demo, tools/bake-chart and game/js/quest plus game/js/ui;
it includes earlier suites written by other lanes and is not an authorship claim.
The prior clean prefab gate had 86 scoped suites; only beastSim exceeded 5 s
(20,003 ms). Timings describe this machine/run, not portable performance limits.

Heap assertions: mapChart and mapFog self-launch with --expose-gc and check
100,000 warmed pose/visit operations (bounded retained heap <300,000 bytes),
with reference/serialization invariants in their existing tests. They run in the
full gate. This is retained-heap evidence, not proof of zero transient allocation.
beastSim's optional --expose-gc heap check is skipped by the plain default runner;
no heap claim is made for it. No threshold changes or test optimizations.

check-deps OK (651 files, 1,358 existing warnings). Final sync: master 33d7a40
and pc-a 467a0bf unchanged; diff check clean.
Only README, this report and lane C status change. Original owner world edits
remain untouched; no browser/server processes started and port 8000 untouched.
