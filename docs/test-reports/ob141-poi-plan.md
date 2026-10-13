# OB-141 "nothing out here" - points of interest plan (PC-B PO, opus, 2026-10-14)

Source counts: `content/worlds/world_m1.world.json` entities (128), `design/levels/world_geo.js` regions + `sites`, `game/js/life/farCamps.js`, `game/js/quest/sim/regionalBeasts.js` REGION_RULES. No browser run.

## 1. Why it feels empty
- **All content sits in one strip.** The tower-to-Outwall strip (x 900-1500, y 900-1130, about 0.13 km^2) holds 14 of the 15 chests, 12 of the 14 inspect points and all 4 NPCs: about 30 things to find, or **~230/km^2 (one every ~65 m)**. The rest of the walkable map (about 3.2 km^2, 13 regions) has 10 dormant relays, 1 lake-bed chest, the Sealed Gate, the Strand sign, 3 far goblin camps and ~19 generated beast groups: **~10/km^2, only 2 chests**. Most regions have nothing but a relay and a beast group, roughly one thing every 400-550 m.
- **The owner's spot is the edge of that strip.** At (970, 1062) the crossroads content is used up (Rook, chests, straw targets). Looking west down the Old West Road into the Thornwood (560-860 x 700-1150) there is nothing for ~350 m except 3 black bears at its east lobe. The Thornwood has 5 named sites in `world_geo.sites` (woodcutters' camp, hollow oak, hunter's lodge, charcoal burners, moss shrine), but none exists in play data.
- **What does exist is hard to see from a distance.** Inspect anchors have no mesh, pickups are hidden until the voxel items land (OB-132 removed the sprites), GPU decor has been off since the OB-119 hotfix and the ground is flat until ENV-02. Nothing pulls the eye at 100 m+. Also: about 55 of the ~62 `world_geo.sites` are designed but not built (only the `ex: 1` ones are). **The world design is already done. It just never became play content.**

## 2. Rule: something every ~100-150 m
Three tiers, measured on a 125 m grid over the walkable bounds (tool in POI-03):
- **Glance (pulls the eye), within 150 m of any road/track point, within 200 m off-road:** smoke plume, brazier glow, relay light, a beast group, a ruin silhouette, a camp. No reward needed.
- **Stop (something to do + a reward), one every ~250-400 m, 3-5 per region:** chest (hidden / puzzle / guarded), inspect note, lost NPC, small fight event, view point.
- **Destination, 1-2 per region:** goblin camp, relay errand (WMP-01), cave/ruin cache.
- Gate: no 125 m cell inside a region's walkable area is more than 150 m from a Glance-or-better POI. Region stops >= 3.
- Bands: east of the river (tower side) = levels 1-5, with early quests only here (OB-136). West of the river = 5-10, optional content only, no main-quest objective there before level 5.

## 3. Per-region POIs (existing systems only; sites = `world_geo.sites`)
Rewards use plain names: Health Potion, Arrows, Heart Piece, gear roll (tier by band). All models already exist: chestSmall, brazier, practiceTarget, relay, char.kit, beasts, smoke/farSmoke emitters. No floorLantern (it is a sprite, see OB-132), no new buildings (they wait for OB-139).
- **Heartland, tower side (lv 2-3), first because it is near the owner:** river farm (1100,1250) lost farmer NPC -> Health Potion x2; boar wallow (1330,1150) small fight, 4 boars turn hostile once -> guarded chest (Arrows 10 + gear roll); flower meadow (1300,900) view point note + map reveal; old bridge piers (1045,1320) target puzzle chest (shoot 3 marks) -> Heart Piece.
- **Thornwood (lv 6-7, owner's view west):** charcoal burners (610,1110) small goblin camp (3) + loot chest; hollow oak (650,960) hidden chest inside, scrawl clue on the Old West Road -> gear roll (fine); hunter's lodge (760,880) inspect note + Arrows cache; moss shrine (720,790) target puzzle -> Heart Piece; woodcutters' camp (820,1150) smoke + brazier glance + lost woodcutter -> Health Potion.
- **Glasswater (lv 4-6):** reed-cutters' camp (1360,560) brazier + boar group; island ruin (1270,520) swim-to chest; fisher's jetty (1100,560) view point note; north bank ruins (1150,800) small fight event.
- **Northwood (lv 4-5):** wolf den (1800,780) guarded chest; grey quarry (1520,460) hidden cache; logging camp (1600,700) lost NPC; old pine watchtower (1720,560) view point.
- **High Pastures (lv 8-9):** goatherds' summer hut (520,420) note + Health Potion; 2 bear ranges (existing) + guarded chest; ridge view point.
- **Ash Mile (lv 3-4):** far camp (exists, WMP-02) + loot chest; burnt farmstead (1740,1230) inspect note; Kestrel scrap trail (1650,1015) 4 scrap pickups -> gear roll.
- **Downs (lv 2-3):** standing stones (1480,1480) target puzzle -> Heart Piece; drovers' camp (1380,1330) lost drover; windmill ruin (1800,1540) hidden chest; poppy fields (1700,1430) view point.
- **Signal Hill (lv 7-8):** far camp (exists) + loot chest; keeper's lodge (790,1180) note; Signal Head cove (760,1405) hidden chest.
- **Heath coast (lv 8-9):** far camp (exists); heath chapel (420,1330) puzzle chest; smugglers' sea cave (480,1475) cache -> gear roll (fine); crofter farm (560,1300) lost NPC.
- **Reedmire (lv 5-7):** stilt hut (1150,1560) note + Health Potion; heron rookery (990,1600) wildlife glance; peat cutters (1250,1440) small fight; eel weirs (1210,1660) swim chest.
- **Strand (lv 3-4):** beach wreck (1680,1760) chest + sea monster glance; dune camp (1350,1700) lost NPC; lighthouse ruin (1865,1705) view point.
- **Whitecombs / West Fells (lv 5-10):** ice cave (980,250) cache; snow cairn (1700,230) view point; copper adit (200,1060) guarded chest; gate garrison ruin (360,880) small fight.

## 4. Story rows (ordered by player impact per cost; start at the tower/river)
Slots follow `docs/pc-b-queue.md`: kestrel-1 = main.js/hooks, kestrel-3 = game modules, kestrel-4 = data/tools. **Do not edit `world_m1.world.json`.** POIs are generated from data the way farCamps is, so there are no hot-file clashes.

| ID | Slot | Files | ACs (Node) | Deps |
|---|---|---|---|---|
| POI-01 site table + generator | kestrel-3 | new `game/js/life/poiSites.js` (+ data `game/js/life/poiTable.js`) + test | Builds spawn defs for each site that is not `ex: 1` in `world_geo.sites`, using a kind template (chest / inspect / brazier+smoke / camp / beast group / view point / puzzle / NPC). First batch = heartland + Thornwood + Ford-west (>= 12 POIs). Every def is on walkable non-water ground inside bounds + its region, >= 8 m from authored entities, ids `poi.<site>.<n>` unique, output deterministic (two runs identical). Chest tables = new `POI_TABLES` in `chestDefs.js` with band-tiered gear. Missing text keys are listed as `NEEDS WRITER:`. | none |
| POI-02 mount + save | kestrel-1 | `game/js/main.js` (<= 10 lines), new `game/js/life/poiWire.js` + test | POI-01 defs spawn in the live tile and go dormant outside it / > 200 m (farCamps rule). Opened chests, read notes and cleared fights persist across save/load. Fake-adapter test; `?save=0`/capture/bench byte-identical. | POI-01 |
| POI-03 discovery toast + map marks | kestrel-1 | new `game/js/ui/poiDiscover.js` + test, `mapWorld.js` | Within 12 m of a POI: one toast "Found: Hollow Oak" (plain name from data, never a raw id, OB-137). The M map shows found POIs and a per-region "2/5 found". All found in a region -> Heart Piece once. State saved. | POI-02 |
| POI-04 target-puzzle chest | kestrel-3 | `game/js/life/poiPuzzle.js` + test (reuses `practiceTarget.js` flags) | A chest stays locked until 3 marks (practiceTarget) are hit within 20 s. A timeout resets the marks; when opened it stays open. Bridge piers + moss shrine + standing stones. | POI-01 |
| POI-05 small fight events | kestrel-3 | `game/js/life/poiFights.js` + test (reuses goblinCamps/farCamps roles, beast temperament) | On entering r 15 m: 3-4 wary boars go hostile, or a 3-goblin mini camp wakes. On clear: a loot chest appears. Once per save, respawn per the D-072 rule. Deterministic slot order (38.59 WM-12). | POI-02 |
| POI-06 lost NPC encounter | kestrel-3 | `game/js/life/poiLost.js` + test (char.kit, dialogue, burlEscort walk) | A villager at a site asks to be walked to the nearest relay/road (<= 120 m path). On arrival -> Health Potion x2 or Arrows 10. Fails if the NPC dies (respawns next day). Text keys `NEEDS WRITER`. Heartland river farm first (tower side, lv <= 5). | POI-02 |
| POI-07 view points | kestrel-4 | `poiTable.js` rows + `mapFog.js` hook + test | Inspect at a view point -> note text + map fog reveal r 250 m around it. Reveal is idempotent and saved. 1 per region. | POI-02 |
| POI-08 density lint | kestrel-4 | new `tools/poi-density.mjs` + test, `validate-content.mjs` | Prints per region: POIs, stops/km^2, % of 125 m cells > 150 m from a POI. Exit != 0 if heartland/Thornwood/ford-west > 10 % empty or any region has < 3 stops. Fixtures per case. | POI-01 |
| POI-09 batch 2 (east + far regions) | kestrel-4 | `poiTable.js` data only | Glasswater, Northwood, Downs, Ash Mile, Strand, Reedmire per section 3. POI-08 passes for them. | POI-08 |
| POI-10 batch 3 (high bands) | kestrel-4 | `poiTable.js` data only | High Pastures, Signal Hill, Heath, Whitecombs/West Fells. POI-08 passes everywhere. | POI-09 |

Writer pass (text only, `docs/story.md`) runs in parallel once POI-01 lists the `NEEDS WRITER` keys. ENV-01/02 and decor back on (OB-119) do the visual half of OB-141 on kestrel-2. They are not part of this plan.

## 5. Owner questions
1. Is it OK to build POIs from the existing `world_geo` site list as generated content (no hand placement in the world file), using today's models until your own buildings (OB-139) replace the ruins/huts?
2. Discovery counter: show "Thornwood 2/5 found" on the map, with a Heart Piece for finishing a region, or keep exploring with no count?
3. Should fights and camps at POIs come back (daily, like camps), or be cleared once for good?
