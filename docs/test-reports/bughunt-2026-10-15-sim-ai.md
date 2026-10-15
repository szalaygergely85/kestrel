# Bug hunt 2026-10-15, area 3: simulation / AI / nav / physics / animation

Architect (fable), branch `pc-a` at a033819e. Read-only review of `game/js/quest/sim/**`, `game/js/life/**`, `engine/nav`, `engine/physics`, `engine/entities`, `engine/voxel/voxelPose.js` leg solve, with Node probes (scratch dir, not in the repo). Cut short by the owner's time cap: 2 bugs probe-confirmed, 2 trace-confirmed, suspects listed at the end.

Known items (batch-review A/B, pc-b-queue fixes, OB rows) are not repeated.

## Confirmed

### BH-A1 (P1, crash) - `beasts.resetAll()` throws whenever a dormant or down slot has a lower index than a dead or down slot
**Where it fires in play:** `vitals.js:207` (player death -> respawn), `main.js:1388` (map travel / Unstuck). The throw is uncaught (main.js only has global `error` listeners -> fatal card). On the default grid world every beast whose home is > 200 m from the player is tile-dormant (`updateTileDormancy`, ~1 Hz) and every goblin camp > 160 m away is camp-dormant (`goblinCamps.step`), so the precondition is the normal state of the open world.

**Root cause:** `resetSlotSim` (`beastSim.js:1542-1547`) re-adds a slot whose steer agent is inactive with `steer.addAgent(...)`, which hands out the LOWEST free slot (`steer.js:285-287`), then throws if that is not `i`. Dormant slots are parked (`applyDormant`, `beastSim.js:405`: `steer.active[slot] = 0`) and are skipped by `resetSlotSim` (`!sim.dormant[i]`), so the first dead/down slot above a dormant one gets the dormant one's index back. Variants:
1. kill any beast with a higher slot than a dormant beast, die -> throw;
2. no kill: a cleared camp (`setDown(true)` parks its slots, `down = 2`) above a dormant camp, die -> throw (`resetAllSim` sets `down[i] = 0` first, so the parked slot is re-added via `addAgent`);
3. `setDown(slot, false)` / `spawnGroup` on a slot that was dormant when `setDown(true)` ran (`down = 1`, agent still parked) with any lower free slot.

**Probe** (`probeA1.mjs`, overworld_far + tower fixture from beastTile.test.js; 3 boars: `far` (slot 0), `near` (1), `res` (2, `reserve: true`)):
```
node probeA1.mjs
dormant[far]= 1 dormant[near]= 0 steer.active= [ 0, 1, 0 ]        # tileNav, spawn 190 m from 'near', 250 m from 'far'
state[near]= 12 (GONE= 12 ) active= [ 0, 0, 0 ]                    # 'near' killed via combat:hit, 4000 steps
resetAll THREW: beastSim.resetAll: re-added dead slot 1 but addAgent returned 0
sim3 active= [ 0, 1, 0 ] dormant0= 1 down2= 2                      # setDormant(0,true) + setDown(2,true), nothing killed
sim3 resetAll THREW: beastSim.resetAll: re-added dead slot 2 but addAgent returned 0
```
**Fix (one line of intent):** never use `addAgent` for a known slot. Give steer an `activateAgent(slot, x, y, radius, maxSpeed, accel)` (writes the SoA fields of exactly `slot`, sets `active = 1`, bumps `_hi`) and call it from `resetSlotSim`; keep parked (dormant) slots parked. Add a test: dormant slot 0 + dead slot 1 + down slot 2 -> `resetAll()` does not throw and slots keep their ids.
**Owner slot:** kestrel-3 (beastSim.js + engine/nav/steer.js; arch-review).

### BH-A2 (P2, AI stuck) - a hunting predator that receives `sim.setGoal` (raid start) never stops hunting and never travels to the goal
**Scenario:** LIFE-07 wolves/bears look for prey every second while wandering (`huntLook`, `beastSim.js:597`). LIFE-08 raids (`raids.js:94`) call `sim.setGoal` on the pack at raid start. `setGoal` (`beastSim.js:392`) leaves `hunt[i] = 1`; `wanderStep` (`beastSim.js:709-710`) takes the `goalOn` branch first, so `huntStep` (the only place `huntT` counts down / the catch happens / `hunt` is cleared on a dead prey) never runs; `huntPass` (`:590`) only clears `hunt` when the state leaves WANDER. `setSteerTarget` (`:1246`) tests `hunt` BEFORE the goal/alt branches and steers straight at `fauna.slots[huntSlot]`. Result: the wolf chases the fleeing prey indefinitely (never catches it: no `huntStep`), ignores the raid goal, the raid times out at dawn as "lost".

**Probe** (`probeA2.mjs`: one wolf, fake fauna with one rabbit 8 m away that runs from the wolf at 6 m/s, player 100 m away):
```
hunting after 1 steps: hunt= 1 huntT= 360
after 60 s with goal set: state= 0 (WANDER= 0 ) hunt= 1 huntT= 360 (was 360 ) goalOn= 1 atGoal= false
  pos= 1400.1 1000.0 rabbit= 1397.5 1000.0 steer target= 1397.5 1000.0
```
(`huntT` never decremented, the steer target is the rabbit, the goal 60 m south is never approached.)
**Fix:** in `setGoal` clear the hunt (`hunt = 0`), and in `goalStep` / `setSteerTarget` give the goal priority over `hunt` (or run `huntStep` inside `goalStep`). Test: hunting wolf + `setGoal` -> `hunt === 0` the next step and `atGoal` within the travel time.
**Owner slot:** kestrel-3.

### BH-A3 (P3, trace) - `perceiveOne` overwrites the charge wall-slow streak (`unseen` is used for two things at once)
`enterCharge` reuses `sim.unseen[i]` as the "moved < 35 % of charge speed" streak counter and `chargePost` (`beastSim.js:1377-1378`) ends the charge as a wall hit (2 s `recoverWall`) at `unseen >= WALL_STREAK (2)`. But `perceiveOne` (`:634`) still runs for a charging slot every `losEvery` (6) ticks and writes `unseen = 0` (LOS ok) or `unseen += 6` (LOS blocked). Trace, boar `i` charging, player stepped behind a pillar: tick with `tick % 6 === i % 6` -> `canSee` false -> `unseen = 0 + 6`; same tick `chargePost`: one slow step (a deOverlap push by a sibling boar, a grazing wall slide) -> `unseen = 7 >= 2` -> `enterRecover(sim, i, true)`: a single slow step becomes a 2 s wall recover. With LOS ok the write of 0 every 6 ticks can split two consecutive slow steps, delaying a real wall stop by one step. `hashSim` hashes `unseen`, so the replay hash also depends on this aliasing.
**Fix:** a separate `Int32Array` `wallStreak` (or skip the `perceiveOne` LOS write while `state === STATE_CHARGE`). **Owner slot:** kestrel-3.

### BH-A4 (P3, trace, non-default world only) - `deOverlap` / `enterFlee` ignore nav sheets
`walkable(grid, x, y)` (`beastSim.js:1392`) reads only the ground `cost`, never `grid.layers`. Under a `nav:"floors"` structure the ground cells are cost 0 (`structureAt` blocks them), so on a sheet (Rook ruin floors, world_m1 with `buildBeastNav` layers) `applyPush` refuses every push: two beasts fighting on the ruin floor stay overlapped (the hard de-overlap of US-079c never applies), and `enterFlee` finds every flee point unwalkable and falls back to walking home. `steer.step` has the layered twin (`walkableAtZ`), this helper does not. Only reachable where sheets are baked (not the grid/tile world: `setNavTiles` in main.js:1584 passes no `layers`). **Fix:** use `walkableAtZ`-style lookup with the slot's z (`zOf`) in `walkable`. **Owner slot:** kestrel-3.

## Checked and NOT bugs (so nobody re-hunts them)
- Sheet padding cells (cost 0, height 0 inside a sheet rect) blocking ground agents in `steer.walkableAtZ`: probed on world_m1, 117 padding cells, 0 false blocks (ground z -86 m there).
- Blended stride near 0 at low speed (ANIM-BLEND-01c handoff): the loco sets start at walk (1.1 / 1.5 m/s), below that `weights()` keeps the single clip -> full walk stride.
- `lookAt` yaw/pitch signs, `legDriver` Phi/stride clamps, `animBlend` non-loop `place`, arrows `GOBLIN_SPEAR_CFG.survivePct = 0`, `tactics` token release, sword/vitals shield-block direction: traced, consistent.

## Suspects (not confirmed, short)
- `resetAllSim` sets `down[i] = 0` for EVERY slot, so logic-reserve groups (`brain.reserve`, ED-LOGIC-01c) and the ED-AI-06 reserve creatures come alive at home on player death (goblinCamps re-parks its own via `beasts:reset`, logic groups have no such hook). No reserve groups exist in content yet; latent.
- `swim.updateSwimState` leave rule `waterFloorZ - z <= stepUpMax` is true for any floor BELOW the feet, so a surface drop > 0.3 m between water regions turns swimming off over deep water for one step (grounded = true, then a short fall until `swimIn`). Needs a content case with adjacent surfaces of different z; none found in the time.
- `resetSlotSim` does not reset `prevX/prevY`, so the first `measureAndUnstick` after a respawn sees a 30 m/s "move" (`mv` jumps to 6 m/s, `moving = 1`): a few frames of walk animation on a standing respawned beast (cosmetic).
- `legDriver.groundZ` FLAT_TOL 0.25 m with landing queries ~1 m ahead of the root: on slopes above ~15 deg every foot query falls back to the flat frame for the whole update, so ANIM-C-03 body tilt is disabled exactly on the slopes it was built for. Design threshold, not probed.
- `enterFlee`/`sim.flee` from CHARGE leaves `steer.accel = CHARGE_ACCEL` (70) for the whole RETURN leg (only `enterRecover`/`enterStagger` reset it).
