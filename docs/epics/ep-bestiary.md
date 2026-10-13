# EP-BESTIARY - 30+ creature types, proper AI, respawn, roaming, difficulty (D-083, OB-149, OB-150, OB-152, OB-153)

Owner (2026-10-14): "create 30 types for this big map at least. respawn time too, walking around, and proper AI, proper
AI. so could be easy, mid and hard game!". Today the 2.9 km^2 map has boars 48, bears 7, goblins 22, **wolves 0**
(`docs/test-reports/ob152-density.md`); AI "stupid, can't touch me" (OB-150); goblins walk in place (OB-149).
Loot goes through EP-ITEMS-STATS (`docs/epics/ep-items-stats.md` 3, x10 number scale, armour vs attacker level L).
Art rule: realistic voxel shapes, animals on 4 legs. Names below are plain working names - **NEEDS WRITER** for final names.
Owner approves this epic before code (BEAST-00-NOTE may start at once).

## 1. Roster (32 types + 16 region bosses)
HP/Dmg = factor vs a boar of the same level (boar lv1 = 40 HP, hit 6 after the x10 rescale; level scaling per band.js).
Model: **R** = existing voxel model (`design/models/*`), **V** = variant of an existing model (recolour/scale/prop),
**N** = new voxel model (designer). Brain: existing module it builds on.

| # | Name | Regions (biome) | Lv | Archetype | Key move | Weakness | Drop (+ gear % per ITEM 3) | HP/Dmg | Model | Brain |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Boar | tower, roadWest, downs, heartland | 1-3 | grazer (fights back) | charge 7 m/s | side-step, heavy stagger | meat, 5 % | 1/1 | R boarPlaceholder | beastSim |
| 2 | Mountain goat | alpine, whitecombs | 8-9 | grazer | head-butt knockback 4 m (cornered) | ledges | meat, hide | 0.8/0.7 | R goat | groundBrain |
| 3 | Aurochs | downs, heartland | 2-4 | grazer (herd defends) | herd stampede charge | split one off | meat, horn, 8 % | 2.5/1.5 | N | beastSim |
| 4 | Red deer | downs, glasswater, northwood | 1-5 | skittish | flee; stag antler kick if cornered | bow at range | meat, antler | 0.8/0.6 | N | groundBrain |
| 5 | Fox | tower, roadWest, downs | 1-3 | skittish | nip when cornered | - | pelt | 0.4/0.3 | R fox | groundBrain |
| 6 | Grey wolf | northwood, signalHill, heartland W | 4-8 | pack hunter | flank bite, lunge 5 m | fire, heavy stagger | pelt, 8 % | 0.9/1 | R wolf | wolfBrain |
| 7 | White wolf (alpha) | whitecombs | 8-10 | pack hunter (leader) | howl: pack +20 % speed 8 s | kill it -> pack flees | white pelt, 20 % | 2/1.4 | V wolf | wolfBrain |
| 8 | Lynx | thornwood, northwood | 5-7 | ambusher | pounce from rock/branch 8 m | low HP once seen | pelt, 10 % | 0.8/1.4 | N | new ambush |
| 9 | Black bear | alpine, whitecombs foot, heartland | 5-9 | tank | swipe; rear-up slam 2.5 m AoE | arrows to face while rearing | 30 % +1 rarity | 3.5/2 | R bearBlack | bearBrain |
| 10 | Cave bear | westFells | 9-10 | tank | bear moves + roar (player stagger 0.3 s) | fire | 40 % +1 rarity | 4.5/2.4 | V bearBlack | bearBrain |
| 11 | River crocodile | ford, river, reedmire | 4-7 | water ambush | lunge 4 m from water, grab + roll (mash to escape) | slow on land; belly after stagger | hide, tooth, 12 % | 2.5/2 | N | new water |
| 12 | Reed eel | reedmire, glasswater | 5-7 | swimmer | bite + coil (swim -50 % 2 s) only on swimmers | cannot leave water | eel meat | 0.7/0.8 | N | new water |
| 13 | Snapping turtle | river banks, strand, glasswater | 3-5 | swimmer/tank | snap; shell blocks front | hit from behind / heavy flips it | shell plate, 10 % | 2/1.2 | V tortoise | new water |
| 14 | Shore crab | strand | 3-4 | swarm | pincer, side-scuttle, groups 3-6 | back/legs, heavy | crab meat | 0.4/0.5 | N | new swarm |
| 15 | Wood spider | thornwood, northwood | 5-7 | ambusher | drop from canopy, web spit (slow 40 % 2 s) | fire, light | silk, 8 % | 1/1.1 | N | new ambush |
| 16 | Spiderling | thornwood (egg sacs, boss adds) | 5-9 | swarm | bite, swarm 6-10 | any hit kills (1 hit) | - | 0.15/0.3 | V wood spider x0.4 | new swarm |
| 17 | Harpy | signalHill, westHeath cliffs | 7-9 | flyer | dive claw from 15 m; screech | arrows x2, grounded 2 s after hit | feather, 12 % | 1.2/1.3 | N (2 legs, winged) | flyerBrain + attack |
| 18 | Carrion crows | ashMile | 3-4 | flyer | flock of 5-8, peck + scatter | fire, shield block | feather | 0.2/0.3 | R crow | flyerBrain + attack |
| 19 | Dusk bats | westFells, whitecombs caves (night) | 6-10 | swarm (night) | erratic swoops 6-10 | torch light makes them flee | - | 0.15/0.3 | N | new swarm |
| 20 | Skeleton warrior | ashMile, westFells ruins (night) | 3-10 | night-only | sword + shield block | heavy / axe x1.5, Waystone light | bone, 15 % | 1.3/1.2 | N | goblinBrain melee |
| 21 | Skeleton archer | ashMile, westFells ruins (night) | 3-10 | night-only ranged | arrow volley 18 m | close in, shield | bone, arrows, 15 % | 0.8/1 | V skeleton + bow | new ranged |
| 22 | Wisp | reedmire, glasswater (night) | 5-7 | caster | drifts, lures, mana-burn bolt | arrows, any hit | wisp glow (mana) | 0.5/0.8 | N (light) | flyerBrain + caster |
| 23 | Treant | thornwood | 6-7 | ambusher/tank | still as a tree until 5 m; root slam 3 m AoE | fire x2, axe x1.25 | heartwood, 30 % | 4/1.8 | N | new ambush |
| 24 | Troll | westFells, alpine | 8-10 | tank | club sweep; boulder throw 20 m | fire stops regen (2 %/s) | 40 % +1 rarity | 5/2.5 | N | bearBrain + ranged |
| 25 | Goblin warrior | camps (all bands) | 2-8 | pack (melee) | slash, shove | heavy stagger | 15 % | 1.2/1 | R goblin | goblinBrain |
| 26 | Goblin spear thrower | camps | 2-8 | ranged | spear throw 14 m (blockable) | close in | spears, 15 % | 0.8/1 | R goblinSpear | goblinBrain |
| 27 | Goblin archer | camps, far camps | 4-8 | ranged | bow 20 m, keeps 10-14 m | close in, shield | arrows, 15 % | 0.7/0.9 | V goblin + bow | new ranged |
| 28 | Goblin torch-bearer | camps | 2-8 | pack (alarm) | horn/alarm, fire swing | kill first: no alarm | 100 % +1 rarity | 1.2/1.1 | R goblinTorch | goblinBrain |
| 29 | Goblin shaman | far camps | 5-8 | caster/healer | heals 2 nearest +25 % HP / 6 s, hex bolt | stays behind: flank it, a hit cancels cast | 25 % | 0.8/0.8 | V goblin + staff/mask | new caster |
| 30 | Goblin chief | every camp (1) | 3-9 | tank (leader) | war horn: camp +15 % dmg; overhead smash | kill -> others -30 % morale (may flee) | 100 % +1 rarity, camp chest | 3/1.6 | V goblin x1.3 + armour | goblinBrain |
| 31 | Bandit cutthroat | oldWest road, southTrack, headPath | 3-8 | pack (humanoid) | dodge-roll, quick 2-hit combo | blocks badly vs heavy | coins, 15 % | 1.3/1.2 | V human_kit | goblinBrain melee |
| 32 | Bandit archer | same road ambush spots | 3-8 | ranged | bow 20 m from cover | close in | arrows, 15 % | 0.8/1 | V human_kit + bow | new ranged |

Count by archetype: grazer 3, skittish 2, pack 5, ambusher 3, water/swimmer 3, tank 4, ranged 3, flyer 2, swarm 3,
caster/healer 2, night-only 2 (+ bats, wisp at night only) = **32**. New models **N = 13** (aurochs, deer, lynx, croc, eel,
crab, wood spider, harpy, bats, skeleton, wisp, treant, troll); variants V = 11; reuse R = 8.

**Region bosses** (one per playable region, no respawn, 100 % chest min Rare via ITEM-06, health bar, phases at 66/33 %):
tower Great Boar (V boar x1.6, lv2) - roadWest Bandit Captain (V, lv2) - ford Old River Croc (V croc x1.6, lv5) -
heartland Goblin Warlord (V chief, lv3/6 by side) - downs Stag King (V deer, lv3) - strand Sea Serpent (R seaMonster, lv4) -
ashMile Bone Knight (V skeleton x1.4, night, lv4) - northwood Wolf Mother (V white wolf + pack, lv5) - glasswater Lake Eel
(V eel x4, lv6) - outwall Siege Chief (V chief + ballista crew, lv6) - reedmire Wisp Mother (V wisp x3 + adds, lv7) -
thornwood Elder Treant (V treant x1.5, lv7) - signalHill Harpy Matriarch (V harpy, lv8) - alpine Snow Bear (V cave bear, lv9)
- westHeath Broodmother (V spider x2.5 + spiderlings, lv9) - westFells/whitecombs Troll King (V troll x1.3, lv10).

## 2. AI behaviour spec (Normal values; difficulty multiplies them, section 4)
Common rules (every hostile, both brains):
- **Animation follows speed (OB-149):** gait clip picked from the measured ground speed, not the state: < 0.15 m/s ->
  idle clip; walk/trot/run by speed bands; clip rate = speed / clip nominal speed, clamp 0.6-1.6. A walk clip while the
  body moves < 0.15 m/s for > 0.2 s is a test failure.
- **Blocked / re-plan:** wants to move but progress < 0.3 m in 1.0 s -> repath; 2nd fail -> sidestep 90 deg 1 s; 3rd fail
  -> new wander target (calm) or give up chase -> return (engaged). Never walk in place.
- **Readable wind-up:** every damaging attack has a wind-up >= 0.4 s (COMBAT_TARGETS.windupMinSec) with a pose + colour
  flash; big attacks (rear-up, root slam, boulder) >= 0.8 s and a ground marker glyph.
- **Attack tokens:** at most 2 melee attackers on the player at once; the rest circle at 4-6 m and feint; a token is
  handed back after each attack. Ranged get 2 separate tokens.
- **Perception:** cone 120 deg + LOS + near bubble (any direction); sprinting doubles the near bubble; damage always
  aggroes; group alarm 15 m (GROUP_ALARM_M); night: wolves/lynx notice x1.2, grazers x0.6.
- **Leash:** engaged too far from home (leash) or player unseen > lose-sight -> return home at walk, regen 50 %/s after 3 s.
- **Water:** land creatures stop at depth > 0.6 m and wait/throw at the bank (no drowning, no walking on the bed);
  water creatures stay in water except croc (4 m onto the bank, 5 s max).
- **Waystone light (D-080):** non-boss hostiles never enter 12 m of a woken Waystone; they hold at the edge then leave.

| Archetype | Notice cone / near (m) | Aggro | Leash / lose-sight | Engage tactic |
|---|---|---|---|---|
| grazer | 10 / 3 | only when hit (herd mates within 15 m join for 10 s) | 25 m / 4 s | charge, recover 1 s, re-charge; herd of 3+ circles |
| skittish | 18 / 6 | never (stag: cornered < 2 m) | - | flee 25-40 m along open ground, regroup, graze again after 20 s |
| pack hunter | 20 / 5 | hostile | 60 m / 8 s | surround: slots at 120 deg around player, one lunges, others feint; retreat at < 25 % HP |
| ambusher | 8 (hidden, no cone) / 3 | hostile | 30 m / 5 s | wait hidden (no idle anim drift), pounce from <= 8 m, then fight 6 s, re-hide if lost |
| water ambush / swimmer | 12 / 4 (water only) | hostile to swimmers and bank walkers within 4 m | stays in its water body / 6 s | submerged approach, eyes only; lunge; retreat to depth after each attack |
| tank | 14 / 4 | hostile (bear: only if < 15 m or hit) | 40 m / 6 s | slow advance, big wind-ups, punishes standing still; no circling |
| ranged | 22 / 5 | hostile | 50 m / 8 s | keep 10-14 m (archers 14-20 m), back off when player < 6 m, strafe 2 m between shots, use cover |
| flyer | 25 / 6 | hostile | 70 m / 10 s | circle 8-15 m high, dive attack every 4-6 s, land/grounded 2 s after being hit |
| swarm | 10 / 4 | hostile | 30 m / 5 s | shared group brain, spread on a ring and nip in turns (2 tokens per swarm) |
| caster/healer | 18 / 5 | hostile | 45 m / 8 s | stay 12-18 m BEHIND allies (ally between it and player), heal lowest ally < 60 % HP, cast 1.2 s (cancelled by a hit) |
| night-only | as their base archetype | hostile | as base | spawn 20:00-05:00 game time; at dawn crumble/fade only when out of view |

## 3. Spawn + respawn
- **Density** (hostile, alive in the world data): near side (band 1-4) **25-35 per km^2**, far side (band 5-10) **35-50
  per km^2**; + passive grazers/skittish 10-20 per km^2. Every playable region has >= 4 types and >= 1 boss. New
  `density-report` columns per type; no region > 2x the band target (today tower 290/km^2, outwall 246/km^2 -> thin).
- **Groups:** boar 2-4, aurochs 4-6, deer 3-6, goats 3-5, wolves 3-5 (+ alpha in whitecombs), spiders 2-4 + 1-2 egg sacs,
  crabs 3-6, crows 5-8, bats 6-10, skeletons 2-4 (warriors + archers), bandits 3-5 per ambush spot, goblin camps 4-7
  (chief + torch-bearer + mix; far camps add shaman/archer), crocs 1-2 per pool, eels 2-3, lone: lynx, treant, troll, bear.
- **Roaming:** each group gets a seeded route of 3-6 waypoints on walkable ground: grazers 40-120 m loop, packs 150-300 m
  patrol, bandits along a road segment, goblins camp perimeter + 1 pair walking a road between 2 camps; group moves
  together (flock / HERD_PULL_M), pause 3-10 s at waypoints; grazers go to water at dusk.
- **Day/night sets:** night set (skeletons, wisps, bats) 20:00-05:00; day animals bed down at night (perception x0.6).
- **Respawn** (per group, timer starts when the last member dies; counted only while the game runs; saved):
  grazer/skittish 3 min, common hostiles 6 min, packs/swarms 8 min, elites (alpha, troll, treant, cave bear) 20 min,
  **goblin/bandit camps cleared for 3 in-game days**, bosses never (once per save).
- **Never in view:** a respawn needs the spawn point > 60 m from the player AND outside the view cone + 15 deg margin
  (spawner VIEW_MARGIN_RAD rule) AND not on screen-visible LOS; otherwise it waits and retries every 5 s.
- **Caps (perf):** <= 48 live hostiles in the active ring (MAX_BEASTS 96 slots stay the hard cap), <= 12 engaged,
  attack tokens per 2 above; rest dormant (WM-04 tile dormancy); ambient FAUNA_MAX 40 unchanged. Gate: bench-life JS
  p95 <= 8 ms with caps full; 0 alloc per sim step after warm-up.

## 4. Difficulty
| Knob | Easy | Normal | Hard |
|---|---|---|---|
| Enemy HP | x0.7 | x1.0 | x1.4 |
| Enemy damage | x0.6 | x1.0 | x1.35 |
| Player damage taken (falls, drowning, fire, traps) | x0.75 | x1.0 | x1.25 |
| Notice range / notice pause | x0.8 / 1.0 s | x1.0 / 0.6 s | x1.2 / 0.4 s |
| Wind-up time (floor 0.4 s) | x1.25 | x1.0 | x0.85 |
| Melee attack tokens | 1 | 2 | 3 |
| Flanking / surround, healer focus | off (straight chase) | on | on + feints |
| Leash + lose-sight | x0.7 | x1.0 | x1.5 |
| Group size | -1 (min 1) | base | +1, 25 % chance of an elite member (x1.5 HP, gold tint) |
| Respawn timers | x1.5 | x1.0 | x0.7 |
| Gear drop chance | x1.0 | x1.0 | x1.2 |
Settings row: **"Difficulty  Easy / Normal / Hard"** (default Normal), also on the new-game card; changeable any time
outside combat; damage/AI knobs apply at once, HP/group size on the next spawn; stored per save.

## 5. Stories (each <= 1 programmer-day; slots per `docs/pc-b-queue.md`; all game/ + design/ unless noted)
| ID | Slot | Files | AC (short) | Deps |
|---|---|---|---|---|
| BEAST-00-NOTE | architect (opus) | `docs/architecture.md` new section | AI framework: archetype data rows on beastSim states, brain composition (beastSim / wolf / bear / goblin / engine fauna ground+flyer), attack tokens, blocked re-plan, anim-from-speed hook, water + ambush state slots, difficulty hook, respawn store + save shape, perf caps; rule 15 (seeded, no trig, 0 alloc) | none |
| BEAST-01 anim follows speed + no walk-in-place | kestrel-1 | beastSim + beast view/anim picker, tests | OB-149: idle clip when speed < 0.15 m/s within 0.2 s; rate = speed/nominal clamp 0.6-1.6; stuck rule (repath, sidestep, give up) over a walled fixture: no slot with walk clip + < 0.15 m/s for > 0.2 s in 10k steps | none (bug) |
| BEAST-02 wolves spawn fix | kestrel-2 | `regionalBeasts.js` (MODEL wolf -> `wolf`), wolfBrain wiring, density tool | find why REGION_RULES wolf rows give 0 (ob152 report); northwood + signalHill packs alive with voxel_wolf + wolfBrain; density report >= 7 wolves; quest kind 'wolf' counts them | none |
| BEAST-03 archetype data + perception/leash | kestrel-3 | `beastConfig.js` archetype rows, beastSim, tests | section 2 table as data; boar/bear/goblin/wolf mapped; per archetype test of notice, near bubble, leash, lose-sight, Waystone 12 m hold, land creatures stop at 0.6 m depth | 00 |
| BEAST-04 attack tokens + group tactics | kestrel-3 | beastSim / new `sim/tactics.js` + test | <= 2 melee attackers (fixture of 6 wolves); surround slots 120 deg; ranged keeps 10-14 m and backs off < 6 m; healer stays behind allies; wind-ups >= 0.4 s for every attack (combatBalance test) | 03 |
| BEAST-05 difficulty setting | kestrel-4 | `game/js/ui/settings.js` row, new `sim/difficulty.js`, save | section 4 table as data; settings row + new-game card; save round trip; Easy/Hard multiplier tests on hp, dmg, tokens, timers | 00 |
| BEAST-06 respawn + caps + save | kestrel-2 | spawn/respawn module, save, tests | timers per section 3; never in view (fixture: player turning, no spawn in cone or < 60 m); camps cleared 3 in-game days; caps 48/12; saved across reload; bench-life p95 <= 8 ms | 00, 05 |
| BEAST-07 roaming routes + day/night sets | kestrel-4 | regionalBeasts / route data, tests | seeded 3-6 waypoint routes on walkable ground; groups stay within 8 m; night set spawns 20:00, fades out of view at dawn; deterministic ids | 06 |
| BEAST-D1 designer: water + plains batch | designer | `design/models/` crocodile, eel, snapping turtle (V tortoise), crab, red deer, aurochs + clips (idle/walk/run/attack/hit/die; swim for water) + preview html | 4 legs for animals, realistic; owner preview OK | none |
| BEAST-08 water brain | kestrel-1 | new `sim/waterBrain.js` + test (swim/dive water query) | croc submerge/lunge/grab-roll (mash escape), eel attacks swimmers only, turtle front block; none leave water except croc 4 m / 5 s | 03, D1 |
| BEAST-09 water + plains spawns | kestrel-2 | spawn tables, density report | crocs at ford/river/reedmire, eels, turtles, crabs, deer, aurochs per section 3 densities | 08, 06 |
| BEAST-D2 designer: wild batch | designer | lynx, wood spider (+spiderling), treant, harpy, troll, bats | as D1 | D1 OK |
| BEAST-10 ambusher + swarm brains | kestrel-3 | `sim/ambushBrain.js`, `sim/swarmBrain.js` + tests | lynx/spider/treant hidden + pounce <= 8 m; swarm shared brain, 2 tokens, cheap (0 alloc, <= 0.5 ms for 20 units) | 04, D2 |
| BEAST-11 flyer + tank specials | kestrel-1 | flyerBrain attack layer, bear/troll specials | harpy/crow dive + grounded 2 s; troll boulder + regen stopped by fire; bear rear-up | 04, D2 |
| BEAST-D3 designer: undead + variants | designer | skeleton (sword+shield, bow), wisp, white wolf, cave bear, goblin archer/shaman/chief props, bandit outfits (human_kit) | as D1 | D2 OK |
| BEAST-12 ranged + caster/healer | kestrel-4 | ranged/caster layer (reuse arrows.js / fireball.js) | archers, shaman heal + cancel on hit, wisp mana-burn, skeleton block | 04, D3 |
| BEAST-13 full roster spawn + loot rows | kestrel-2 | spawn tables all 32, `lootConfig.js` rows | every region >= 4 types; density within band targets; drop rows per section 1 | 09, 10-12, ITEM-06 |
| BEAST-14 boss framework + reuse bosses | kestrel-3 | new `sim/boss.js`, health bar UI | arena leash, phases 66/33 %, no respawn, chest; Great Boar, Old River Croc, Wolf Mother, Stag King, Goblin Warlord, Sea Serpent | 13 |
| BEAST-15 remaining bosses | kestrel-1 | boss data | the other 10 bosses per section 1 | 14 |
| BEAST-W writer | writer | `docs/story.md` | final names (<= 14 chars), one bestiary line each, boss intro lines | none |

## 6. Owner questions
1. Bosses: one per region = 16; OK that they are bigger named versions of the 32 types (no extra models), and once per save?
2. Undead (skeletons, wisps, bats) at night and human bandits on the roads - fit the world?
3. Difficulty changeable any time (outside combat), or fixed at new game?
4. Respawn in real minutes (3-20 min) and camps 3 in-game days - OK, or longer?
5. Crocodile grab + roll (mash a key to escape, ~25 % HP on Normal) - fun or too harsh?
