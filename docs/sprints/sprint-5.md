# Sprint 5 (planned 2026-09-30 night, D-032 amendment 1: back to the RPG)

Owner: Manager (scope), Product Owner (stories/acceptance). This sprint closes M2 (mesh phase-2 gate) and starts M3 "Steel and Hush" with the RTS engine parts we already built (nav, overlay). Draft by the PO. **NEEDS MANAGER: confirm the scope and order** (see "Open").

## Goal
**Walk out of the tower onto a lit hillside on the mesh engine, then meet a beast that finds its way to you and that you can lock on to.**

## Stories
| # | ID | Story | PC | Main files | Owner / gate | Exit test | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | BUG-FP-001 | Black ground outdoors on `?renderer=mesh` (P0). Reproduce in a real browser first, then fix. | PC-A | `engine/mesh/terrainMesh.js`, terrain streaming, main.js bootstrap | architect (opus) -> main session | Walk wake -> breach -> hillside on `?renderer=mesh`: 0 black ground cells. Load time to the first full frame is recorded in the row. | - |
| 2 | ME-12 | Phase-2 gate: the M1 route on `?renderer=mesh&physics=mesh`, gate report, owner walk-test | PC-A | see `### ME-12` | architect verdict -> **owner GO/NO-GO** -> D-029 amendment 3 (manager) | ME-12 ACs 1-11. Owner says it "plays the same" from wake to the waystone. | BUG-FP-001; ME-11 (done) |
| 3 | Q6-11 | Bench pitched pose: `?bench=1` pose option placed with `pitchedEyeFromFocus`. Also measure RE-02b b6 (`fpDown60`) and the ME-12 walk bench at 400x150 / 240x90. | PC-B | `tools/bench-poses.js`, `tools/capture-browser.mjs`, main.js <= 3 lines (PC-B main session) | main session | Numbers are recorded in the RE-02a / RE-02b rows and feed ME-12 AC 6/7. | - |
| 4 | ME-22 | Large voxel models on the mesh path (the owner's big `design/vox/environment` trees). Split into ME-22a engine and ME-22b tools if needed. | PC-B (cross-track -> arch-review) | see ME-22 row | arch-review (opus) -> owner look at one tree | ME-22 ACs 1-5. One environment tree stands on the hillside on `?renderer=mesh`. | ME-07 (done) |
| 5 | US-079a | First beast, brain + nav chase (no damage yet): placeholder boar with the wander / notice / chase / windup / charge / recover / return states, pathing with RE-05 A* + RE-09 steering around rocks and the tower | PC-B (brain, content) + PC-A (architect note first) | `game/js/quest/beast*.js` (new), content `entities[]`, main.js hook (PC-B main session) | **NEEDS PC-A: architect note + PO ACs (done in the row)** -> PO (sonnet) -> owner look | US-079a ACs. Two beasts on the hillside notice you, path around the tower and charge. 600-step replay is bit-equal. | **ME-12 GO** (D-030 item 1) |
| 6 | US-128 | Z-targeting: press/hold to lock the nearest visible target, draw a ring under it + a bar through `engine.overlay`, cycle targets, keep the camera turned to the target | PC-A (camera turn, architect note) + PC-B (game wiring) | `game/js/quest/target*.js` (new), `engine.overlay` calls, playerLook option | **NEEDS PC-A: architect note** -> PO (opus, owner-visible first review) -> owner feel check | US-128 ACs. You can lock on to a US-079a beast, the ring stays under it on slopes, and the lock breaks at 20 m or when the beast leaves line of sight. | US-079a |

**Out of this sprint (next, sprint 6 head unless the manager reorders):** the old-renderer block ME-15 -> ME-16 -> ME-12b -> ME-19 (PC-A), US-078 sword (needs designer art + architect), US-080 health (owner answer 7 changes it to HP + mana, see "Open").
**PC-B filler (queue 6, engine release track, ends in arch-review):** RE-15a instance cull || RE-15b LOD1 build. Then PX-05a and the CO-5 follow-up as before.

## Order
- **PC-A (one agent at a time):** BUG-FP-001 -> ME-12 browser pass + fixes -> owner walk-test -> the architect writes the US-079a and US-128 notes while the owner tests -> US-128 camera part after US-079a. After that, the old-renderer block starts if there is time left.
- **PC-B:** Q6-11 bench pose -> ME-22 (a, b) -> RE-15a || RE-15b -> US-079a once ME-12 is GO and its notes are on master -> US-128 game wiring.

## Rules carried over
- D-030 item 1: no M3 story starts **dev** before the phase-2 gate passes. ACs, notes and art may be done earlier.
- D-032 item 5 determinism rule for all sim code (fixed step, seeded RNG, no wall clock), including the beast brain.
- The game imports only `engine/index.js`. Nav/overlay/instances are used through their exports (RE-EXP).
- `game/js/rts/` is an engine sample. Game code may copy patterns from it (for example `navSetup.js`) but never imports it. The architect decides whether the shared walkability setup moves into the engine.

## Shared-file risk
- `game/js/main.js`: BUG-FP-001 (bootstrap), Q6-11 (<= 3 lines), US-079a/US-128 hooks. Serialise: the PC-B main session makes the PC-B edits itself.
- `engine/voxel/*`, `engine/mesh/voxelMesh.js`: ME-22 and RE-15b both touch `voxelMesh.js`. **Do them in sequence, not in parallel.**

## Open (for the main session)
- **NEEDS MANAGER:** (1) confirm that the old-renderer block (ME-15/16/12b/19) waits until sprint 6 while M3 openers start, instead of running before M3. (2) Move US-026b S2-S4/S6/S7 streaming to sprint 6+. (3) Record the owner's 2026-09-26 roadmap answers (sword in the tower, HP + mana instead of hearts, block + parry in M3, torch as the first tool) as a D-030 amendment, so that the US-078/080 ACs can be rewritten (they still say "hillside sword" and "hearts").
- **Owner:** BUG-FP-001 repro on your machine if the headless probe is unclear; ME-12 walk-test; RE-02b b7 first-person feel check (pitched camera, 70 deg clamp); first enemy = boar (the PO picked it from your "wolves or boar"; wolves come later as a pack), OK?

## Review
(PO fills in at sprint end: done / not done / bugs, "missing to be playable", owner walk-test request.)
