# Bug hunt round 2, area E (editor / logic / content) - 2026-10-15

Architect (fable), 10-minute cap. Static trace only (no Node probe fit in the cap); every item below is an exact file:line trace. Skipped: items already in bughunt-2026-10-15-*.md, batch-review-2026-10-15-pca-A/B.md, docs/bugs.md.

## BH2-E1 (P1, gameplay) - `beasts.resetAll()` revives every logic-reserve group (round-1 suspect confirmed)

- `game/js/quest/sim/beastSim.js:1861` `resetAllSim`: `for (i < count) { sim.down[i] = 0; resetSlotSim(sim, i); }` - unconditional for every slot, reserve groups included (`resetSlotSim` sets hp = max, state = WANDER, transform = home).
- Reserve groups are only parked by `sim.setDown(i, true)` at creation (`beastSim.js:550`) and by `despawnGroup` (`:545`); `logic.groups[g]` (0/1/2) is not consulted by reset.
- `resetAll` is called on map travel / Unstuck: `game/js/main.js:1427`.
- Listeners of `beasts:reset`: `goblinCamps.js:93` (re-parks its own cleared camps), `loot.js:190`, `telegraphWire.js:19`. `game/js/logic/logicWire.js` has no listener and `onWorldLoaded()` (`logicWire.js:70-76`, the only place that re-applies `spawnGroup/despawnGroup`) runs only on `world:loaded` (`main.js:1641`).
- Result: after a waystone travel or Unstuck, the cemetery trio (`regionalBeasts.js:246`, `brain.reserve = true`), `aireserve.*` test slots (`aiReserve.js:18`) and every ED-LOGIC-01c reserve/cleared group stand alive at their homes while `logic.groups[g]` still says 0/2 - `group` conditions and `group.cleared` events are then wrong for the rest of the session (a cleared group can never "clear" again; a reserve group is visible before its spawn block fires).
- Cause: `resetAll` was written for the camp/director slots (US-079b) before reserve groups existed; the group layer never hooked the reset.
- Fix (one line of intent): in `logicWire.js` subscribe `sim.events.on('beasts:reset', ...)` and re-run the group re-apply loop from `onWorldLoaded` (`groups[g] === 1 ? spawnGroup : despawnGroup`), or make `resetAllSim` skip slots whose `brain.reserve === true` unless `logic.groups` says 1. Unit test: reserve group + `resetAll()` -> `groupAlive(g) === 0`.
- Slot: kestrel-3 (engine logic/sim).

## BH2-E2 (P2, perf / alloc) - logic wire re-serialises the whole logic state every fixed step while any delayed action is pending

- `game/js/logic/logicWire.js:66`: `if (dirty || logic.pending > 0) { world.state.logic = logic.save(); ... }`.
- `engine/core/logic.js:212-226` `save()` allocates `b` (one object per block, up to 128), `p`, `e` and `JSON.parse(JSON.stringify(extra))` every call.
- A block with `after: 3600` (allowed by `LOGIC_LIMITS.afterMax`, `logic.js:14`) therefore allocates ~130 objects + a JSON round trip on every one of 3600 consecutive steps - against the "step() allocates nothing" rule in the file header and the D-007 JS budget. The save is only needed when the pending table changes (an action ran or was parked), not while counters tick down.
- Fix: save when `used > 0`, when an event was pushed (`dirty`), or when `logic.pending` changed since the last save (track `lastPending`); the countdown values themselves can be rebuilt on load from `tick` delta or simply accepted as "up to one step stale".
- Slot: kestrel-3.

## BH2-E3 (P3, determinism / save) - `resume` (partially handled event after a deferral) is not part of the state hash

- `engine/core/logic.js:259-264` `hashInto` mixes `count`, `pCount`, `fired`, the queue and the pending table but not `resume`; `save()` does persist it as `r` (`:224`).
- Two sims that differ only in `resume` (one has already run the first k blocks of the head event, the other none - which blocks is observable because `fired[]` is counted... but a block with `max` unset and zero-length conds that was skipped by `b.key` filter leaves `fired` untouched) hash equal while their next step runs different blocks. Low frequency (needs `maxPerStep` overflow in one step) but it is exactly the case the gpucompare/replay hashes exist for.
- Fix: `h.u32(resume)` in `hashInto`.
- Slot: kestrel-3.

## Not confirmed / out of time

- Editor Quests/Foliage/Creatures/Logic tabs (`tools/editor/*Panel.js`, `livepatch.js`, `io.js`), `tools/content-lint*.mjs`, `content/beasts/*` loaders: not reached within the cap; no finding, no clearance. Recommend a round 3 on those files with a Node round-trip probe (load -> save -> deep-equal) for each editor tab's writer.
