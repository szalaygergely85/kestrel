# M5 Sprint 5 - queue refill (PC-B PO sonnet 2026-10-13, owner-authorised; manager to ratify)

**Goal:** the Outwall people talk and move, the river can be swum, and the west bank gets its next quest batch.
**Scope rule:** approved scope only: D-069 (12 characters approved 2026-10-12), D-070 (swim, dive, stamina, sea monster, free river crossing), OB-104. Skipped on purpose: US-054 (dropped), US-102 sentinel, EQ-22 tier look, grass presets (owner pending).
Files named below are the expected ones; the programmer confirms the exact path in the first 3 tool calls. No two stories in flight share a file. Only kestrel-1 edits `game/js/main.js`; other slots write `NEEDS B1-main:` in their lane entry.

## A. Ready now (one per slot, start together)

### OUT-01 Hesk + Dorrin talk at Outwall  [slot kestrel-1] [ready now] [ends po-review]
Files: `game/js/main.js` (hook only), `game/js/quest/outwall.js` (new), `game/js/quest/outwall.test.js`.
- [ ] Hesk (905,940) and Dorrin (forge) spawn from existing meshes / `char.kit` (no new mesh), face the player within 6 m.
- [ ] Interact opens the existing dialogue box with 2 lines each; texts are placeholders marked `NEEDS WRITER`, ids in one data table so the writer can replace them.
- [ ] Talk sets flags `ow.hesk.met`, `ow.dorrin.met` (feed mq.ow.names later); flags survive save/load; Node test covers spawn table + flags.
Deps: none (D-069 approval).

### SWIM-02 Stamina + drowning logic (pure module)  [slot kestrel-2] [ready now] [ends arch-review, wiring waits on SWIM-01]
Files: `game/js/quest/stamina.js` (new), `game/js/quest/stamina.test.js`. No engine, no main.js.
- [ ] `stepStamina(state, dt, {swimming, diving})` drains 100 units over 12 s swimming, 6 s diving; refills 25 units/s on land; all numbers in one config object (swim speed and monster distance stay open per D-070).
- [ ] At 0: drown timer drains 1 heart per 1.5 s until death; refills cancel it; `onDeath` reports cause `drown`.
- [ ] Node test: drain, refill, drown tick, death, config override.
Deps: none (logic only). Wiring to the controller + HUD ring = SWIM-05.

### OUT-02 Outwall idle routines  [slot kestrel-3] [ready now] [ends po-review]
Files: `game/js/quest/outwallRoutines.js` (new) + test. No main.js.
- [ ] Data-driven routine table (waypoints, dwell seconds, time-of-day window) for Hesk, Dorrin and the next approved Outwall chars Sorrel, Pell, Tam (existing meshes / recolours only; missing mesh = entry marked `NEEDS DESIGNER`).
- [ ] `stepRoutine(npc, clock, dt)` returns target position + pose (idle / walk / work); NPC stops when the player talks to it and resumes after.
- [ ] Node test: full-day loop, interrupt/resume, no waypoint inside a collider (uses existing collision query).
Deps: none; spawn wiring by OUT-01 later (`NEEDS B1-main:` after merge).

### QL-23 West-bank quest batch  [slot kestrel-4] [ready now] [ends po-review]
Files: quest data file used by QL-22 (`game/js/quest/*quests*.js`, new batch file), `tools/validate-content` expectations if a count changes.
- [ ] 6-8 quests from quest-roadmap.md sec. 3 west-bank rows (e.g. sq.ow.* fetch/collect/kill/deliver), template pipeline only, no new code paths.
- [ ] Givers only approved characters; existing anchors/meshes; every objective text <= 38 chars; prose marked `NEEDS WRITER`.
- [ ] `node tools/validate-content` passes; flags chain from the `requires` column; quest count in the test updated.
Deps: none.

## B. Next in each slot (ready after the above)

### SWIM-06a Sea edge trigger (pure)  [kestrel-2 after SWIM-02] [ready now]
Files: `game/js/quest/seaEdge.js` + test.
- [ ] `seaEdgeState(pos, shore)` returns `safe | warn | kill` by distance from the Long Strand shore line (config, default warn 60 m, kill 90 m; owner distance still open).
- [ ] Warn band yields a "dark shape circling" spawn point; kill band yields a strike trigger; Node test on 3 positions.

### OUT-03 Ama, Cobb, Skip talk stubs  [kestrel-1 after OUT-01] [ready now]
- [ ] Same pattern as OUT-01 for the remaining approved coastal characters whose mesh exists; others listed `NEEDS DESIGNER`.

## C. Waits on the architect (ARCH-NOTE NEEDED; do not design here)

- **SWIM-01 (engine) - NOTE DONE:** architecture.md 38.54 (PC-B architect opus 2026-10-13, owner-authorised, PC-A to ratify). Water fed to the body as `waterZ`/`waterFloorZ` (physics stays stand-alone), swim in/out 1.15/0.95 m, float lock, climb-out, dive, reduced 35.6 under look (one shade function, both twins), sea monster, gear stowed. Deep-water wall + `wadeRescue` removed.
- **SWIM-03 Swim on the surface** -> steps **SWIM-03a** (engine/physics `swim.js` + integrate branch, k2) -> **SWIM-03b** (game `swimFeed.js` + wading/vitals changes, k3) -> **SWIM-03c** (main.js wiring, gear stowed, k1). ACs: 38.54 step table.
- **SWIM-04 Dive** -> **SWIM-04a** (engine/physics dive + `controls.swimUp`, k2) -> **SWIM-04b** (engine/render `underwater.js` JS twin, k4) -> **SWIM-04c** (WGSL twin + ShadeU append + gpucompare `underwaterLake`, k4) -> **SWIM-04d** (dive key + bottom chests, k1). Needs SWIM-03a.
- **SWIM-05 Stamina ring wiring** (k3 + k1 hook): SWIM-02 driven from `body.swimming/diving`, `vitals.kill(cause)` + `deathCause`, HUD ring. Needs SWIM-03b. ACs: 38.54.
- **SWIM-06b Sea monster** (k2 + k1 hook): `seaMonster.js` (hidden/circle/rise/strike, 4 Hz `seaEdgeState`), designer model `seaMonster` + clips. Needs SWIM-06a, SWIM-05. ACs: 38.54.
- **OB-104b Glasswater outlet-notch cliff - NOTE DONE:** architecture.md 38.55. Chosen: rock look on steep faces (N.z < 0.5, non-forest types) with biplanar (along-wall, z) noise, in both twins; notch shape unchanged. Steps **OB-104b1** (JS twin, k4, 0.5 d) -> **OB-104b2** (WGSL + gpucompare pose `lakeEdge`, k4, 0.5 d).
- **EP-LIFE (D-071) - NOTE DONE:** architecture.md 38.56. Steps: **LIFE-01** (engine/nav path reuse, k4) -> **LIFE-02** (schedule, k3) -> **LIFE-03** (mover + villagers + LOD, k3) -> **LIFE-04** (main.js, k1); **LIFE-05** (NPC chat + barks repeat, k2); **LIFE-06** (engine/fauna predator-prey, k4) -> **LIFE-07** (beastSim hunt/eat, k2); **LIFE-08** (raids + beastSim goal/alt targets, k3) -> **LIFE-09** (defend-the-farm quest, content, k4); **LIFE-10** (bench-life, k2). PO writes rows from the 38.56 table.
- **US-055 floating props** (engine -> arch-review, ARCH-NOTE NEEDED): water splash + props that float; follows SWIM-03.
- **STREAM-02+ (streaming steps 2 and later)** (engine -> arch-review, ARCH-NOTE NEEDED): waits on OB-073 and the architect note; a 5th-agent architect may write it now.

## D. Designer and writer (not programmer slots)
- Designer: Wick swim and dive clips (surface stroke, tread, dive, rise; 4-6 frames each); sea monster model + rise/strike clip; recolours/variants for any Outwall character without a mesh.
- Writer: sea-monster lore line (warning sign text), Outwall Hesk/Dorrin/Sorrel/Pell/Tam lines, QL-23 prose. Tag `NEEDS WRITER`.

## Order of work
Wave 1: OUT-01 (k1), SWIM-02 (k2), OUT-02 (k3), QL-23 (k4). Wave 2: OUT-03 (k1), SWIM-06a (k2). Architect (5th agent, opus) in parallel: SWIM-01 first, then OB-104b and US-055 notes.
