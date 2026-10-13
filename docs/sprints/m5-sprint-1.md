# M5 sprint 1 - "Across the river"

(PC-B PO opus, sprint planning 2026-10-11; owner-authorised "continue with stories", PC-A offline. **PC-B, manager to ratify.**) Rows in `docs/pc-b-queue.md` `## M5 sprint 1`. M4 closes on the owner walk QL-20 / EQ-14 (route: docs/sprints/m4-review-2026-10-11.md section 4); this sprint does not touch M4 files beyond what is named.

**Goal:** wade the Braid, walk a short track to a walled Outwall that looks inhabited, and fight a wolf pack that is clearly tougher than the boars (band 5).

Owner rules applied: environment only from existing meshes (Quaternius / Medieval kit in content/meshes), no new env designs; animals realistic on 4 legs; no "Esc to close" text; magic off; character names not approved (quest-roadmap.md 2b) stay placeholders (`exile.elder`, no "Hesk" in data or text); writer keys only, missing text = `NEEDS WRITER:`.

## Stories

| id | slot | topic | arch note | ends |
|---|---|---|---|---|
| MAP-26 | kestrel-4 | Outwall blockout (ws_outwall site, no NPCs, no dungeon) | no (38.36 relay pattern) | po-review (owner look) |
| QL-21 | kestrel-5 | Ch3 opening + west-bank quests on the template pipeline | no | po-review |
| WOLF-D1 | kestrel-6 | Voxel wolf model + clips (designer) | no | po-review (preview) |
| WOLF-01 | kestrel-1 | Wolf beast family (brain, config, asset registration) | no (beastSim pattern) | po-review (owner look) |
| US-129a | kestrel-3 | Zone band -> beast tier stats + drop gear tier | no | po-review |
| US-055a | kestrel-2 | Wade splash + leg ripples (engine particles) | **ARCH-NOTE NEEDED** | arch-review |

Files never shared: k1 `beastConfig.js`, new `wolfBrain.js`, `main.js`; k2 `engine/**` per the note; k3 new `band.js`, `beastSim.js`, `loot.js`, new `content/beasts/tiers.json`; k4 `content/worlds/world_m1.world.json`, new `tools/gen-outwall.mjs`; k5 new `content/quests/ch3/pack.json`, `content/quests/areas.json`; k6 new `design/models/voxel_wolf.js` + preview.

## ACs (short)

**MAP-26 Outwall blockout** (~1 d). Walk area from the ford west bank to the Outwall site (905,940), polygon bounds opened for it (MAP-11 data). Palisade ring (Medieval kit fences/walls) with one gate gap at the south-east, 6-8 house shells inside (existing meshes, roofs, chimneys with the MAP-25 smoke billboards), forge shell, board post, dead relay `ws_outwall` at (912,952) per 38.36 (no wake yet). Goose farm fence at (860,990), barley-farm gate prop at (975,900). Anchor contract (ids exact, used by QL-21/WOLF-01): `owGate`, `owBoard`, `owRelay`, `owForge`, `owPathPost` (track start ~985,1040), `gooseFarm`, `barleyGate`, `pierStone` (1045,1320, inspect `note.pierStone`), `signArm` pickup in the shallows near (985,1062), wolf spawn anchors `wolf1..5` around the goose farm (8-20 m out). No NPCs.
- AC1 `node tools/validate-content.mjs` 0 findings; every placement uses a mesh already in content/meshes (test lists ids, fails on unknown).
- AC2 route-walk: new leg ford -> owPathPost -> owGate -> inside the palisade -> gooseFarm -> back, grid + mesh paths, no stuck spot, no fall, no `band:late` (`node tools/route-walk.mjs --leg outwall`).
- AC3 bench pose `outwall` (inside the gate looking at the relay): JS p95 <= 8 ms ultra, recorded in the lane entry.
- AC4 headless still from the gate and from the ford west bank (`tools/capture-browser.mjs ?pose=outwall`): village reads as a walled settlement at 240x90.

**QL-21 Ch3 opening + west bank quests** (~0.75 d). New pack `content/quests/ch3/pack.json` on the template pipeline (38.44): `mq.ow.path` (explore, area `owPath` r10 at owGate, opensAfter mq.smoke), `mq.ow.fence` (kill 5 `wolf` at gooseFarm, opensAfter mq.ow.path; compass to gooseFarm), `sq.hw.piers` (read `pierStone` = accept + done, reward arrows 10 + lore, opensAfter mq.ford.mirror), `sq.fc.sign` (fetch `signArm` back to the crossroads signpost, reward arrows 10, opensAfter mq.ford.mirror). Talk beats with exile characters (mq.ow.names onward) are NOT in this story (names pending). Pack registration: content manifest only; if it needs a main.js line, hand that one line to kestrel-1.
- AC1 `node tools/quest-sim.mjs` all quests OK including the 4 new; `node tools/validate-content.mjs` 0 findings (anchor ids from MAP-26 exist).
- AC2 Node chain test with fed events: mq.smoke done -> path -> fence (5 wolf kills, kills before accept count like boars) -> done.
- AC3 every text is a story.md key or `NEEDS WRITER:` (HUD objectives <= 38 chars); no "Wick", no names from 2b.

**WOLF-D1 voxel wolf** (designer, ~0.75 d). `design/models/voxel_wolf.js` from voxels, realistic grey wolf on 4 legs: body ~1.4 m nose-to-rump + 0.45 m tail, shoulder 0.8 m, pointed ears, long snout, grey-brown back fading to pale belly/legs (3-4 palette entries appended to design/palette.js, small edit). Clips: idle 2 frames (breath), trot 6, run 6, lunge telegraph 3 (crouch, head low, 0.5 s), bite 2, hit 2, die 4. Same rig/socket conventions as voxel_beast (boar). Preview `design/preview/wolf.html` at 240x90 lit day and night.
- AC1 reads as a wolf (not a dog/boar) at 10 m in the preview; the crouch reads as "about to jump" at 8 m.
- AC2 voxel count within the boar budget +20 %; clips loop without a pop.

**WOLF-01 wolf beast family** (~1 d). Kind `wolf` in `beastConfig.js` + `game/js/quest/sim/wolfBrain.js` (new), model registered in main.js (placeholder: boar model until WOLF-D1 lands). Behaviour (tier 1 values, US-129a scales them): HP 0.75x boar, run speed 1.3x boar, packs of 2-3, circle at 4-6 m, **only one wolf attacks at a time** (token), telegraph 0.5 s crouch then 5 m leap, bite = 1 heart, retreat 1.5 s after a bite, a lone wolf under 25 % HP flees 30 m. Shield block stops the bite (EQ-06 path); an arrow hit interrupts the crouch.
- AC1 Node tests (fake world, seeded): attack token never held by 2 wolves over 10k ticks; telegraph always >= 0.5 s before damage; block = 0 damage; arrow during crouch cancels the leap; flee rule; 0 alloc per step.
- AC2 kills emit the same event as boars (QL-21 `kill wolf` counts), corpse/loot via the boar path.
- AC3 one browser pass at `?pose=outwall` with wolves spawned from `wolf1..5`: owner-visible telegraph, no wolf stuck in the palisade.

**US-129a zone band -> tier stats** (~0.75 d). `game/js/quest/sim/band.js` (new): `bandAt(x,y)` from world_geo.regions `lv` (pure, cached grid, 0 alloc). `content/beasts/tiers.json`: per band 1-10 a tier 1-3 and multipliers (tier 1 = x1 HP / x1 damage / +0 % speed, tier 2 = x2 / x1.5 / +10 %, tier 3 = x3 / x2 / +20 %); a placed entity may override with `entities[].tier`. `beastSim.js` applies the multipliers at spawn for every kind (boar + wolf). `loot.js` gear drop tier = band table (T1 b1-2 .. T5 b9-10, quest-roadmap section 0) instead of the fixed table, chances unchanged.
- AC1 Node: bandAt on 6 fixed points (meadow 1, ford east 4-5, Outwall 5, Thornwood 6-7, West Fells 9-10, out of map = nearest); tier stats applied once (respawn does not stack); explicit tier wins.
- AC2 loot sim 10k boar kills at Outwall -> gear tiers only T3; rolls at the meadow unchanged vs today (golden test).
- AC3 colour/look of tiers is NOT in this story (US-129b, waits on the owner question below).

**US-055a wade splash + ripples** (engine, ~1 d, after OB-045 lands on kestrel-2). ARCH-NOTE NEEDED: where the particles live (engine/render particle pool vs billboards), GPU path (WGSL twin + gpucompare row) or JS-overlay only. Intended feel: stepping into water at > 1 m/s throws 6-10 droplets (`. ' ,` in the water foam colour, gravity, 0.6 s life); while wading and moving, a ring ripple at the feet every 0.4 s (radius 0 -> 1.2 m over 0.8 s); an arrow into water makes a 4-droplet splash. Fed by `waterAt`/wading.js state (RIVER-01b), no game imports in engine.
- AC1 Node: pool cap 64 particles, 0 alloc per frame, deterministic seeded spawn, ring timing; <= 0.1 ms per frame at 64 live (JS twin).
- AC2 gpucompare row `wadeSplash` PASS (skill `gpucompare`), no existing row changes.
- AC3 headless still at the ford mid-crossing shows droplets + ring (`tools/capture-browser.mjs ?pose=riverFord`).

## Not in this sprint (next)
US-129b tier look, Outwall NPCs + mq.ow.names onward (need character approval), region-entry banner with the approved place names, QL-19 wet-stone wiring into movement (M4 leftover), US-102 sentinel, US-026b (MAP-10..14 band grid covers streaming for now).

## Owner questions
1. Approve the 12 new characters (quest-roadmap.md 2b) - Ch3 talk beats wait on this.
2. Tier look (US-129b): the old sketch says green/blue/red beasts; PO default under "realistic animals" = natural fur shades per tier (brown / grizzled grey / near-black with scars) plus the tier colour on the health tag only. OK?
3. MAP-26 was gated on "owner go after the stage 2 walk"; PO reads "continue with stories" as the go - confirm.
