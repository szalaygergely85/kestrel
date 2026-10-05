# Sprint 6 (planned 2026-10-05, owner goal; PO with the manager's authority for this sprint)

Owner: Owner (goal), Product Owner (stories/acceptance). Owner 2026-10-05: "first we need to do a small demo: fight with those boars, be able to get an inventory, loot them, cast a fireball." Basis: D-038 (alive world -> combat -> demo/videos), D-039 (known-FAIL precision rule), D-040 (two hand slots, any item in either hand, LMB = left / RMB = right, tap light / hold charged, inventory screen first with the game paused, first spell now, existing mana bar).

## Goal
**Boar demo: fight the boars with sword (left hand) and fireball (right hand), they die and drop loot, pick it up into an inventory, assign items to hands.**

## Demo script (what the owner does in 2 minutes)
Load plain `game/index.html` (mesh renderer + mesh physics by default). Take the sword in the tower, walk out of the breach onto the hillside: the sword is in the left hand, the ember (fireball) hand is on the right. A boar sees you (`!` over its head), scrapes the ground and charges. Sidestep, hit it with LMB (it flashes and flinches; 4 light hits or 1 hard + 1 light kill it). It tips over, turns to dust and leaves meat (and maybe hide / tusk / a red or blue drop) on the ground. The second boar charges: RMB-tap a fireball at it (5 MP, orange light flies over the grass, burst + flash, boar knocked back), finish it, or hold RMB for a big charged fireball. Walk over the loot ("+1 Boar Meat"). Press `I`: the game pauses, the pack shows sword, fireball, meat, hide. RMB-click the sword to move it to the right hand, LMB-click the fireball to put it in the left hand, eat a meat (+10 HP), close with `I` and fight again with the hands swapped. The two boars never merge into one.

## Stories
| # | ID | Story (one line) | PC | Main files | PC-A prep before PC-B starts | Gate after dev | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | US-079b | Boar HP + hurt + death: 4 HP, flash/flinch on hit, tip over -> dust -> removed, `beast:died` event, not targetable when dead, all back on player respawn/reload | PC-B game | `game/js/quest/sim/beastSim.js`, `beastConfig.js`, beast view code, main.js hook (PC-B main session) | **Architect note 37.13** (death lifecycle: remove vs hide, respawn/resetAll, refresh of the sword + targeting target lists, hurt-flash mechanism for a voxel entity). **Designer:** boar `hurt` flash + `die` tip-over (clips or transform recipe, whichever 37.13 picks), death dust burst numbers | PO (opus, owner-visible first review) -> owner look | sword hits (US-078d, done), US-080a1 (done) |
| 2 | US-079c | Boar fight reads: BUG-BOAR-OVERLAP hard de-overlap + `!` notice glyph + visible windup scrape + only one boar charging at a time | PC-B game (+ `engine/nav/steer.js` only if the fix must live there -> arch-review) | `beastSim.js`, `beastConfig.js`, overlay call | **Designer:** `ui.alert` colour + `!` style, scrape dust burst numbers (can be numbers in the row; PO gave defaults) | PO (sonnet) -> owner walk-test | US-079b (same file, do in sequence) |
| 3 | US-091a | Loot + inventory data: item defs, `player.components.inventory`, boar drop table on `beast:died`, loot drops picked up by walking over them, "+1 Boar Meat" toast, survives save/load and death | PC-B game | new `game/js/quest/sim/inventory.js`, `loot.js`, `pickups.js` (item kind), toast view, main.js hook | **Designer:** `design/items.js` (6 item defs + names placeholder + ASCII icons), loot sprites `lootMeat` / `lootHide` / `lootTusk`, toast style. **Writer (optional):** item names + 1-line texts (placeholders are fine) | PO (sonnet) -> owner look | US-079b |
| 4 | HANDS-01 | Two hand slots: LMB = left item, RMB = right item (tap / hold), sword works in either hand (mirrored pose, swing, trail, hit order), both hands drawn at once, dev hand swap | PC-B cross-track (engine `viewModel.js` + game) | `engine/render/viewModel.js` (+test), `game/js/quest/sim/sword.js`, `swordConfig.js`, new `game/js/quest/hands.js`, main.js input | **Architect note 37.8 amendment "hands"** (per-hand handle + mirror at bind, `hand` param in sword sim generalising `sweepRtoL`, RMB + context menu, input gate). **Designer:** `viewModels.spellHand` (idle glow, cast flick, charge) authored for the LEFT hand and mirrorable | arch-review (opus) -> PO (opus, owner-visible) -> owner walk-test | TORCH-01a ARCH OK, BUG-VM-001 left-hand published (Q16 items 6, 7) |
| 5 | SPELL-01a | Fireball sim: cast from the spell hand (tap 5 MP / hold 10 MP), projectile along the crosshair, swept hits on boars/walls/terrain, explosion via US-136 (falloff, LOS, knockback, `combat:hit` cause fire), no self-damage, deterministic | PC-B game | new `game/js/quest/sim/fireball.js` (+test), `spellConfig.js`, main.js step hook | **Architect note 37.14** (projectile sim game-side vs engine, swept `World.raySegment` per step, beast capsule test, `explosionHits` + `applyImpulse` wiring for beasts and the player, determinism) | PO (sonnet, sim) | HANDS-01, US-079b, US-078d knockback (Q16 item 8) |
| 6 | SPELL-01b | Fireball view: flame sprite + trail + moving warm light, spell-hand clips, burst + flash light + camera kick, light cap, perf + gpucompare pose | PC-B game (+ engine only if 37.14 says a moving-light API is missing -> arch-review) | `game/js/quest/fireballView.js`, particles hooks, main.js render hook | **Designer:** `fireballCore` sprite (4 frames), particle presets `fireTrail` + `fireballBurst`, light presets `fireballLight` + `fireballFlash`, preview page `design/preview/fireball.html`. Architect 37.14 covers the light budget | PO (opus, owner-visible) -> owner look | SPELL-01a |
| 7 | US-091b | Inventory screen: `I` pauses, hands strip + 6x4 grid with ASCII icons + details, LMB/Q -> left hand, RMB/E -> right hand, click a hand to empty it, use meat (+10 HP) | PC-B game/UI | new `game/js/quest/inventoryView.js` (+test), main.js pause gate | **Designer:** `uiStyle.inventory` (layout at 240x90 and 400x150, colours, cursor, hand slots, empty-hand glyph) in `design/items.js` or m3_props.js | PO (opus, owner-visible) -> owner walk-test (the whole demo script) | US-091a, HANDS-01 |

**Split / AC changes (PO 2026-10-05, from architecture.md 37.16 / 37.8a / 37.14 + D-042 + owner answers):**
| Story | Change |
|---|---|
| US-079b0 (new) | Engine seams: `voxel.hidden` + `World.addInteractable/removeInteractable`, ~0.3 d, PC-B cross-track -> arch-review. Precedes US-079b. |
| US-079b | Corpse stays until looted (E) or 60 s, then sinks (dust) and is hidden; a light hit during a charge only flashes; any hit makes the boar chase. |
| US-091a -> US-091a1 + US-091a2 | a1 = inventory data, demo start state, sword take (after HANDS-01b). a2 = loot roll at death, `[E] Loot boar` corpse prompt, toast (after US-079b + a1). HP/MP orbs may still drop on the ground. |
| HANDS-01 -> 01a + 01b + 01c | 01a view-model mirror + winding flip (core render, first review); 01b input/router/sword hand/start state, `?demo=0`; 01c spell-hand idle + `handsSwapped` pose. Tap/hold threshold is per item (sword 0.4 s, fireball 0.6 s). |
| SPELL-01a | Mana spent on release; charged release with 5-9 MP casts a normal ball; cast refused at the 4-ball cap without spending; player gets knockback only; `castOffset` from `viewModels.spellHand.castOffset`; one persistent trail emitter per ball; lights bound at 5 m. |

Count: 11 steps after the splits (US-079b0, 079b, 079c, 091a1, 091a2, 091b, HANDS-01a/b/c, SPELL-01a, 01b), each <= ~1 programmer-day. All PC-B; PC-A only preps (notes, art) and reviews.

**Prerequisites already queued (not duplicated here, PC-B QUEUE 16):** MESH-PHYS-DEFAULT (item 3a: the plain URL must use mesh physics so boars and the player collide with trunks/rocks), PROP-COLLIDE-01a/b (3b), BUG-VM-001 left-hand publish (6), TORCH-01a multi-handle view model (7), US-078d knockback (8), UI-XHAIR-01 bigger crosshair (10c, aiming the fireball). BUG-BOAR-OVERLAP (10b) is folded into US-079c (its row stays the bug record; close it with US-079c).

## Order
- **PC-A first (before PC-B reaches each story):** (1) architect note 37.16 boar death -> unblocks US-079b; (2) designer pass A: boar hurt/die + dust, `ui.alert`, `design/items.js` with icons + loot sprites + toast style -> unblocks US-079b/c, US-091a; (3) architect 37.8 amendment "hands" + 37.14 fireball (one opus session, both notes) -> unblocks HANDS-01, SPELL-01a; (4) designer pass B: `spellHand` view model, fireball sprite/presets/lights + preview, `uiStyle.inventory` -> unblocks HANDS-01 (spell hand look), SPELL-01b, US-091b. Then PC-A reviews as items land (arch-review HANDS-01; PO reviews; owner looks).
- **PC-B:** finish the prerequisites in QUEUE 16 order (3a MESH-PHYS-DEFAULT, 6 BUG-VM-001 publish, 7 TORCH-01a, 8 US-078d knockback; 3b PROP-COLLIDE-01 can run beside) -> **lane A:** US-079b0 -> US-079b -> US-079c; US-091a1 -> US-091a2 -> US-091b; **lane B (second programmer, no shared files with lane A except main.js, which the PC-B main session wires):** HANDS-01a -> HANDS-01b -> HANDS-01c -> SPELL-01a -> SPELL-01b. US-091a1 waits HANDS-01b (inventory shape); US-091a2 waits US-079b + US-091a1; US-091b waits US-091a2 + HANDS-01. HANDS-01b starts its `sword.js` work after US-079b merges; SPELL-01a waits US-079b (boar health).
- TORCH-01b (torch pick-up) becomes "torch as an item in either hand" after HANDS-01; it is not in this sprint (only its item def exists in `design/items.js`).

## Rules carried over
- D-032 item 5 determinism for all sim code (fixed step, seeded RNG, no wall clock): boar death, loot rolls, fireball flight. 600-step replay hash stable in every sim story.
- D-039: a new gpucompare pose that fails only on JS/GPU precision is recorded as a known-FAIL baseline; no previously passing row may regress; never widen thresholds.
- The game imports only `engine/index.js`. `engine/physics/` stays stand-alone.
- Scope stays tiny: one spell, 3 loot item types (+ the existing HP/MP drops), no shop, crafting, equipment stats, quick wheel, sorting or item dropping.

## Shared-file risk
- `game/js/main.js`: hooks from all 7 stories -> PC-B main session makes them itself, one story at a time.
- `beastSim.js`: US-079b and US-079c in sequence; SPELL-01a only calls its damage API.
- `sword.js` / `swordConfig.js`: HANDS-01 only (US-078d knockback must be merged first).
- `design/items.js`: designer creates it; programmers read it (US-091a adds no gameplay numbers there that the designer owns; gameplay numbers live in `game/js/quest/*Config.js`).

## Owner answers (2026-10-05)
1. **Looting: press E at the dead boar** (not walk-over). The body stays until looted (or a timeout), `[E] Loot boar` prompt, loot goes straight into the inventory with the toast; US-079b death keeps the body (no instant dust) and US-091a uses an interactable on the corpse instead of ground drops (HP/MP orbs may still drop on the ground).
2. **Fireball: found later in the full game, but for the demo known from the start** (right hand at new game behind a demo flag/start state; a later story places a fireball pickup).
3. **Own fireball: no damage to yourself** (knockback only).
4. **Note numbering:** 37.13 is ME-19 and 37.15 low-poly trees, so the boar-death note is **37.16** and the fireball note **37.14**.

## Review
(PO fills in at sprint end: done / not done / bugs, "missing to be playable", owner walk-test request with the demo script above.)
