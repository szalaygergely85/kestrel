# TOWER-LEVER-01 programmer verification — 2026-10-05

Queue 16 item 3, based on `0e31b1d`. The tower's lever, connecting chains, interaction, quest behaviour and initial pulled flag are removed. Landing G retains its 3 m floor and now has a sky ceiling with no dynamic grate or upper iron geometry. The upper stair is traversable on first load. Main-session grate sound listeners are removed; generic sector animation support remains.

Route legs 5a/5b now cross the open landing and ascend the upper steps without an E interaction, forced animation, reset or lever fallback. The real-content GPU lever pose is replaced by an open-landing pose. Library lever model/animation probes remain generic render coverage.

## Checks

- Tower tests: 98 assertions PASS. Restart tests: 30 assertions PASS, including a saved mid-grate animation from the explicit legacy fixture; deserialization drops `tower.lever`, leaves the landing open and does not mutate the saved input.
- World walk/performance tests: 13 assertions PASS. Content canonical form: 9 checks PASS.
- Working tree: 226/226 suites PASS, no FAIL/TIMEOUT/WARN; dependency check OK, including the runner's typecheck/content checks.
- Isolated proposed commit: 224/224 suites PASS, no FAIL/TIMEOUT/WARN; dependency check OK (389 files). Only task changes are applied; existing local Ruins/sword/render edits are excluded.
- Working-tree and isolated mesh browser routes: 10 legs complete, no falls, `upperStairOpen`, `leverAbsent` and `endTrigger` all true. Isolated route used port 9607, gl2 mesh at 400×150, 1813 frames. Node route: nine legs complete in both grid and mesh physics, no falls, both reach the end trigger; mid-route save/load retains the open stair.
- Isolated real-GPU JS/mesh comparison: 70 rows; no prior-PASS regression, nine existing FAIL rows unchanged. The new landing pose PASSes with zero kind/depth/UV/face/z/normal/light violations; 24 AO cells remain within the existing comparison tolerance. Four shared poses have changed metrics after geometry removal (owner repro, relay distance, summit east, RTS overlay), all still PASS; the other 65 shared rows have identical metrics. No thresholds changed. RTX 4060, ANGLE D3D11, mesh comparison at 160×60.

## Scope notes and review

The dynamic-sector packing, refit, animation, serialization and scaling suites previously used the shipping tower gate as their fixture. They now clone the canonical tower into an explicit test-only dynamic fixture, retaining that engine coverage while shipping content stays permanently open. Engine runtime and GPU shader code are unchanged. The Node route tool also imports the existing sword/practice-target/detail registrations needed to load today's tower content.

Legacy saves may retain an inert `grate` dynamics record and old state key through generic deserialization; neither can restore gate geometry or its removed content entity. No generic save migration is introduced.

Status: **NEEDS PC-A: PO review / owner walk-test**. Next queue item: **PROP-COLLIDE-01 (3b)**. Cinematic captures remain on hold. Generated GPU capture JSON files are removed after verification; diagnostic copies stay outside the commit.
