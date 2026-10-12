# Batch review 2026-10-12b (PC-B architect opus, owner D-066)

## Part A - OB-073-D2b ASK ARCHITECT (kestrel-4 69cc3b85, engine/render/carpet.js)

**(1) AC2 restated.** A 0.1 m sideways shift is true parallax (blades at 3 m move 8+ cells), so a correct world-anchored carpet must flip cells. AC2 tests "no re-roll / no sliding window", not "no parallax". New AC2: wind 0, synthetic 240x90 view, fade front excluded:
(a) a sub-cell eye shift (0.001 m, projected motion < 0.25 cell at the nearest carpet hit) flips < 2 % of cells (as implemented);
(b) for a 0.1 m shift, every hit at pose B equals the brute-force hit at pose B (same lattice id `ix,iy`), and the set of present blades (rank < dens * fade at the blade's own tB) differs between A and B only in blades whose fade value crossed their rank (0 re-rolls). Log the 0.1 m flip % as info only. The real shimmer gate stays D2g (`--mode flicker --walk`).

**(2) AC6 cause + fix.** The `ground`/`wind` callbacks are not the cause: they take a Float64Array and return undefined, so nothing is boxed. The cause is the **double-returning helpers**: `hashFast01` (terrainShade.js:34, returns `u24 * 2^-24`, a non-Smi) is called ~10x per `bladeHit` (6 direct + 4 per `vnoise`, x2 with the gust noise), and `smooth()` (carpet.js:30) is called twice per candidate. In the 1-variant probe TurboFan inlines all of them. With the 2-variant sloped fixture, `bladeHit` (9 call sites in the ring loop of `traceCarpetIn`, plus `vnoise`/`leanRatio`/`classAt`) uses up the cumulative inlining budget. Calls that are no longer inlined then return a HeapNumber each time (~16 B; 100-170 B/trace = ~6-10 boxed returns). Fix, bit-identical results:
- In carpet.js, use a Smi-returning hash, `hashU24(x,y,s) = hashFastU(x,y,s) >>> 8` (export `hashFastU` from terrainShade.js if it is not exported; no value change), and scale at the call site with `* INV_2_24` (`const INV_2_24 = 1/16777216`). Same for the 4 corners in `vnoise`.
- Inline `smooth` by hand at carpet.js:145 (two lines), or write its result into `ctx.q`.
- Leave the callback shape and the `ctx.r/s/q` scheme as they are.
- AC6 then = < 8 B/trace average over 10k traces in the 2-variant sloped fixture, calm and windy. Replace the 400 B guard with that bound. If it still allocates, use `--trace-turbo-inlining` to find the remaining call.

**(3) 3x3 ring cost.** Not OK as written. Worst case 24 steps x 9 = 216 blade tests per cell (~10 hashes each) on ~35k carpet cells is several times over the 0.35 ms iGPU budget. RING stays 1, because correctness needs it: a blade reaches `w - 0.1c` past its cell edge, plus the lean error. Remove the redundant tests instead:
- (a) **Ring dedupe.** Skip ring cells already tested in the previous step: `abs(i - prevCi) <= 1 && abs(j - prevCj) <= 1`, an integer compare, with prevCi/prevCj = the previous step's ring centre (after the upwind shift). That is ~3 new cells per step (+9 at the first step), the same set of tested cells, so the result is bit-identical.
- (b) **Cheap pre-reject before any hash.** If the xy distance from the ray line to the cell centre is > `(0.7071 + ROOT_JITTER) * c + w_max + LEAN_CAP * maxH`, skip the cell.
- (c) Keep the class/rank early-outs first.

Worst case ~78 tests, typical far fewer with the `best` early-out. AC5 (brute == DDA on 10k rays) must stay 10000/10000 with (a)+(b). Measure in D2d. If over budget, tune in the 38.52 order: radiusM, then NMAX, then density.

**Also required in the D2b rework:** there are two `CARPET_DEFAULTS` with different values. `engine/world/carpet.js:4` has patchM 6, classJitterM 0.8, gustM 5, travelM 1.5; `engine/render/carpet.js:12` has 3 / 0.6 / 4 / 1 (+ bladeW). Keep one source: world/carpet.js owns the config defaults (add bladeW 0.06, swayGain 1), and render/carpet.js imports them. `check-deps` must pass; if render->world is not allowed, move them to a shared `engine/render/carpetConst.js` that both import.

D2b verdict: **ARCH CHANGES** (AC2 text as above; AC6 fix; ring dedupe + pre-reject; single defaults). The rest (AC1/3/4/5, lattice, NMAX never-truncate, density-threshold fade) is correct.

## Part B - verdicts

**01bbe87e OB-073-D2a (kestrel-2): ARCH OK with notes.**
1. engine/world/carpet.js:4: the defaults are duplicated with render/carpet.js:12 and differ. Fix this in the D2b rework (above). Do not ship D2d before that.
2. carpet.js:13-15: the validator rejects 0 for `classJitterM` / `travelM`, but 0 is valid (no jitter / no travel), and D2b treats it with `== null`. Allow >= 0 for those two keys.
3. World.js `_rebuildCarpet`: fine. The class map buffer is reused when the size matches, and it is never serialized. The `typeMask` Uint16Array allocated per rebuild (rebake only) is OK.

**c7da006d STREAM-01b (kestrel-2): ARCH OK with notes.**
1. DrawList.js `addMeshStructures`: `if (!shadowOnly || !grid.evaluated) grid.update(lodCentreX(cam)...)`. When the shadow feed runs first on a fresh grid, it classifies from the shadow camera's centre. That is a one-frame mismatch, harmless; it would be cleaner to skip the grid until the camera feed has run.
2. Active touch/request uses `bboxDist` (DrawList), but warm uses xy-to-bbox (lazyMesh.js `warmLazyMeshes`). Use one metric (the 38.51 spec says xy) so a placement cannot flicker between touch paths at the ring border.
3. meshGroups.js `_build`: the instance budget now counts shells at build time. That is better (group membership no longer depends on load order). The `hits[slot] === 0` skip in `push` matches the old dmin=Infinity / drawCount 0 result. Snapshot only on `renderVersion`: setMeshPlacement bumps it, OK.
4. The memory gate (Outwall <= 60 % of tower) is still open: it belongs to 01c, record it there.

**320bf871 FB-01 fireball unlock (kestrel-1): ARCH OK with notes.**
1. Single writer: confirmed. Only `unlockFireball` writes `magic.fireball` (grep).
2. The 0-alloc frozen event, the live `fireballOn`, and the `isEnabled` closure made once per `world:loaded` match 38.53. The double gate (`fbOn && downOf` + `cast` early return) is fine.
3. Owner-visible, for the PO: `START_DEMO` (startConfig.js:4) still puts `spell.fireball` in the right hand. While locked, the player holds a dead spell slot, and the hand view gets `null` (no hand) rather than the plain hand. A locked mana-potion key toasts 'empty'. The PO decides whether the demo start drops the spell until it is unlocked.

**61f33902 OB-086 kit character (kestrel): ARCH OK with notes.**
1. Game-only, engine untouched. The entity is excluded from saves by the `demo.` prefix (saveState.js:94) and respawned on every `world:loaded`, so Continue stays consistent.
2. It is a live entity, so it is in the world hash, replays and collisions. That is fine for a show-off, but keep it out of the determinism fixtures. Plan to put it behind a flag or remove it after the owner look.
3. `composeCharacter` runs at every boot. Accept for now; if boot time matters, gate it (`?kitchar=1`).
