# PC-B PO batch review 2026-10-14 (sonnet, D-066, claims-only, nothing run)

Sources: lane logs in kestrel-1/2/3/4 `docs/lanes/*.md`, ACs in `docs/pc-b-queue.md`, `docs/epics/ep-items-stats.md`, `docs/epics/ep-bestiary.md`, ARCH verdicts in `batch-review-2026-10-14-pcb.md`.

## Verdicts

### Ground look (kestrel-2)
- **ENV-02b** (JS twin): PO OK -> testing. Look 0 bit-exact 50k, wind 0 frames identical, w=.5 symmetric, 0 extra alloc: claimed. The eye +0.1 m AC (<5 % glyphs > 10 m) was measured at 30 % (10-15 m), 19 % (15-25 m), 1.1 % (> 25 m); the architect changed the AC to ">= 25 m, record 10/15/20 m" and made the flicker walk the real gate. Owner walk: ground flicker while walking (see to-dos).
- **ENV-02c** (look bytes bake): PO OK -> testing. groundLook null = bytes/checksum unchanged, overlap == fresh, ms/MB table (near +22 % MB, far +10 % ms, load only) claimed; ARCH accepted the +22 %. Open content row (not this story): biomeBlend effective width max(blendM, 24 m) for biomes 3/9, then the game passes `groundLook.blendM`.
- **ENV-02d** (WGSL + host, parts 1 and 2): PO OK -> testing (code and Node probes only). 7200 probes, 0 mismatches after the f32 fix, WGSL lint, 0 alloc. NOT yet run by the main session: gpucompare rows lookMeadow/lookForestEdge/lookBorder0, flicker walk, GPU budget bench. Owner must not judge the look before those pass. Carpet (kind-10) look moved to ENV-02e.
- **ENV-02e** (carpet look): PO REJECT: no claim entry exists in `kestrel-2/docs/lanes/pc-b2.md` (or anywhere in kestrel-2 docs), only the ARCH OK line (da46e1e9). Lane must log what was built, the tests and numbers (root tone fixed 0.5, no footprint fade, heap gate -> `allocGate.js`). Re-submit with the entry; the PO OK follows from a claim check.
- **BLD-01** (own buildings step 1, OB-139, D-085): PO REJECT: no claim entry in the lane file or kestrel-2 docs (only ARCH OK ab71e6cb; `buildingBoxShapes` is not in the kestrel-2 working tree either, so the commit may live on another branch). Lane must log: which buildings (bld*) exist in world_m1, collision (stairs/door walk tests at stepUpMax 0.45 / r 0.3), and what the owner sees. Owner approved the preview (D-085), so the look check is owner-side after the claim exists.

### Atmosphere (kestrel-4 / kestrel-2)
- **ENV-03a** (config + driver): PO OK -> testing. 40 checks cover validator, sum(w)+wNone, fade <= dt/1.5, 600 still steps -> 0 bumps, +-1 m jitter, snap, outdoor false, 0 alloc (alloc probe flaky under parallel load, passes alone: ask for `allocGate.js`). Browser effect not visible until ENV-03c.
- **ENV-03b** (engine JS twin): PO OK -> testing. Fit 0.082 <= 0.09, grade vs `L.grade` <= 1/255 over 6000 colours x 4 states, swap symmetry, 0 alloc. Gap: "atmos off -> JS frames byte-identical (3 poses)" was proven on the sky/LUT grid only, not full frames (ARCH accepted). JS grade ~2 ms vs 0.6 ms budget: architect ruling (fuse loops, accept <= 1.2 ms on Canvas2D only) must be applied.
- (ENV-03c is ARCH CHANGES then fixed in `env03c-fix`; not in this batch. It needs the gpucompare rows + `?atmos=0` bench pair before an owner look.)

### Items (kestrel-3)
- **ITEM-01** stat model: PO OK -> testing. All section-7 ACs claimed (means within 1 %, crit within 1 %, DR exact 5/65, cap 60 %, move cap 15 %, 0 alloc rollHit) and the hard-rule hook `meetsRequirement` (D-089) exists. ASSUMPTION TO CONFIRM (owner/PO): attribute bonuses count per point ABOVE base 5. PO confirms this reading (base 5 = starting hero, matches the epic's "base attributes"); change only if the owner disagrees. Not wired to combat yet (ITEM-04).
- **ITEM-03** generator: PO OK -> testing. 10k rolls x 10 iL, slots, determinism, uniques never roll, requirement table and "Steel Bow needs DEX 12" claimed. Names <= 14 chars; all 36 base names are NEEDS WRITER. No `<script>` tag yet (only needed from ITEM-04).
- **Rarity weights 60/28/10/2: CHANGE.** Epic section 3 (owner OK'd, D-084 Q3) defines per side: near band 1-4 = 70/24/5/1, far band 5-10 = 50/32/14/4, Unique only from quests/bosses, chest min Rare. 60/28/10/2 is the average of the two and matches neither. PO ruling: keep 60/28/10/2 ONLY as the generator's neutral default (ITEM-03 AC does not depend on it); ITEM-06 must pass the section-3 weights by band side (70/24/5/1 and 50/32/14/4) through the generator's rarity parameter and verify within 1 pp per side. Add one line to ITEM-06 and to the `itemGen.js` header. Kill bonuses (+1 rarity step for torch-bearer/chief/bear) are also ITEM-06.

### Bestiary (kestrel-3)
- **BEAST-03b** layer dispatch: PO OK -> testing, with three ACs formally deferred (record in the row): (1) 0 B/step probe: measured ~180 B/slot from engine astar/LOS/gridHeight, ARCH ruling = not a blocker, new step NAV-ALLOC-01; (2) Waystone 12 m hold and (3) land kinds never path into depth > 0.6 m: no water mask yet (08a), re-check at BEAST-08a. Dispatch, perception, leash, lose-sight, determinism and goldens are covered (24 checks).
- **BEAST-06a** spawn director: PO OK -> testing. Deterministic gids, timers x difficulty, never-in-view (cone + 15 deg, 60 m, LOS), camp 3 days, `beast.v1` round trip covered. Not visible in game until WIRE (BEAST-WIRE-01, ARCH CHANGES fixed in `beastwire-fix`, awaiting re-review).

### Enemy HUD, POI, routes (kestrel-1)
- **HPBAR-01/02** (bar model + draw): PO OK -> testing. 12-cell bar, top-3 select, 0.3 s fade, edge clamp, Settings "Combat HUD" On/Off default On: claimed. Not browser-checked. Gaps: level from `entities[].level`/`bossName` is read but no content sets them; names cut at 22 cells ("Lv 10 Boa") -> owner look; "hidden while pause/inventory/map" and UI-scale scaling not mentioned in the claim -> owner to-do.
- **HPBAR-03** (difficulty-aware level): PO OK -> testing. Easy -1 / Hard +1 clamped 1..10 via `difficultyFlag`; the Settings difficulty exists (BEAST-WIRE-01).
- **DMGNUM-01**: PO OK -> testing. Pool 24, crit gold "!", red hurt number near hearts, Settings switch: claimed. Open: hurt-number anchor defaults to col 6 / row 2 (real hearts position unknown) and crit only appears once ITEM-04 sets `payload.crit`. Owner look.
- **POI-01/02**: PO OK -> testing. 14 POI rows, generated from world_geo sites (ring search, >= 8 m from authored entities, 20 m apart, seeded), spawn within 200 m / remove beyond 220 m, per-POI `{done, guardianDead, fightClearedAtDay}` persisted (D-088). Missing prop kinds (inspect/view/puzzle/npc have no prop) = known gap, not an AC.
- **POI-03** (+ POI-CHEST-01): PO OK -> testing. One toast "Found: <plain name>" within 12 m, `*` map mark only for found POIs, no counts (D-088), chests earned only (OB-152), loot to pack. Gap: guardian chest lootable before the fight - closed by POI-05; `*` glyph needs an owner look.
- **POI-05** (mixed respawn): PO OK -> testing. Small fight returns after 3 days, guardian never, chest locked until cleared. Note the AC says "10 simulated days: fights 4 returns": with a 3-day respawn 10 days gives 3, so the test uses 12 days (4 returns); the AC is amended to 12 days.
- **POI-05b** (real parked fight members): PO REJECT: hold. ARCH CHANGES (ebeb37fb) is open: drop `activate()` and the direct `sim.steer.*` writes in poiFights.js, use `sim.parkSlot/unparkSlot` once kestrel-3 lands them (parked ghost agents act as invisible obstacles and cost steer time). Resubmit after ARCH OK; the PO check is then re-reading the 20-check real-sim test.
- **BEAST-07** roaming routes + night set: PO OK -> testing. 3-6 waypoint seeded walkable loops, cohesion <= 8 m over 3000 steps, night set unparked at 20:00 and re-parked from 05:00 only out of view, determinism: claimed. NOT visible as a night set yet: no `when:'night'` rule is seeded in REGION_RULES (decision: which region/kind, MAX_BEASTS 96 capacity). Day routes are visible. Owner decision needed on the night rule.

## Owner walk-tests (2 lines each)
- ENV-02b/c/d: Walk the meadow, forest edge and river bank at `?look=1` vs `?look=0`; the ground should show distinct per-biome glyph/colour patches with soft blends and no flicker.
  Stand still, then step 10 cm: ground must not shimmer past ~25 m, and wind should move only the far grass.
- ENV-03a/b: nothing visible alone; check with ENV-03c: cross meadow -> forest -> shore, fog/tint change takes >= 1.5 s with no pop at the border; `?atmos=0` returns today's look.
- ITEM-01/03: no UI yet; owner reviews only the design numbers in `statsConfig.js` / `itemBases.js` names (writer pending). Nothing to play.
- BEAST-03b/06a: invisible until WIRE; after wiring, kill a boar group, leave > 60 m, wait ~3 game minutes; it respawns out of your view cone and never in front of you.
- HPBAR/DMGNUM: fight a boar: a `[#####-----] Lv N Boar` bar with a coloured level appears above it, fades 0.3 s after the fight; hits show white numbers rising, crits yellow `!` (after ITEM-04), damage you take in red by the hearts.
  Settings -> Combat HUD: both switches default On, turn Off and reload, nothing is drawn.
- POI: walk to a generated POI (toast "Found: <name>", `*` on the M map, no x/y counts); small fights return after 3 days, the guardian never; locked chest opens only after the fight (once 05b is OK).
- BEAST-07: watch a grazer herd walk a loop and stay together within ~8 m; at 20:00 expect no new night mobs until the rule is seeded.

## Owner / main-session to-dos (browser-only or not run)
1. Main session: `node tools/capture-browser.mjs --mode gpucompare --backend webgpu` for lookMeadow / lookForestEdge / lookBorder0 / carpet (once a row exists), existing rows unchanged; flicker walk (OB-054 baseline + 2 pp); GPU budget bench for look and grade. If 1-byte look diffs appear, FMA contraction is the cause: report, do not widen.
2. Main session: ENV-03c gpucompare rows + `?atmos=0` bench pair (grade <= 0.05 ms Intel / 0.01 ms 4060).
3. Owner: look at ground richness again (D-085: "I don't see it"): confirm the page/game renders the look with `?look=1`, compare `?look=0`.
4. Owner: HUD readability of the enemy bar (22-cell cap, long names), hurt-number position near the hearts, `*` map glyph.
5. Owner decision: night-set rule (region, kind, count) for BEAST-07, and whether guardian/inspect/view/puzzle POI kinds need props before the POI feature is judged.
6. Lane entries missing: ENV-02e, BLD-01 (rejected above); POI-05b needs ARCH OK after the park API.
7. ITEM-06 gets the section-3 rarity weights per band side (see above); ITEM-01 attribute-above-5 reading confirmed by the PO.
