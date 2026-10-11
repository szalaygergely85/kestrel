# Design walk, this side of the river (M4), 2026-10-11

Designer, clone `kestrel-5` (branch design-walk = pc-b @ ab5ea025). Question from the owner: "Is this side of the river designed well? Animals and trees etc?"

**Method and limits.** This run had file tools only (no shell), so I could **not** start a server, take the 12 + 2 screenshots, or copy PNGs into `docs/test-reports/design-walk/`. The verdicts below come from the data (`content/worlds/world_m1.world.json` structures and entities, `design/levels/world_geo.js` regions and G.biomes, `design/models/voxel_wildlife.js` wildlifeFx, `game/js/wild/wildEnv.js`) and from the existing captures in `docs/test-reports/` (paths given per stop). Each stop lists an exact capture pose (`?capture=1&at=x,y,zFeet,yaw,pitch`, yaw 0 = -y/north, 90 = +x/east, the same convention as the MESH-MISSING poses) so the main session can take the missing shots in one `tools/shot-browser.mjs` pass.

Short answer: **the trees and plants are in good shape, but the area is not yet alive or readable.** The ground dressing is dense and varied up close: about 1,400 placed meshes, 5 CommonTree, 5 Pine, Twisted and Dead trees, ferns, clover, flowers and mushrooms. The weak points:
- Almost every placed animal is the same species (all 15 placed beasts are boars).
- Small animals never use the hand-placed roadside trees.
- At dusk nothing outdoors gives off light.
- The west bank (crossroads, straw field, ruin) is almost bare.
- The same cluster stamps repeat along the road.
- Several story props are still kludges or placeholders (posts, Rook's nest, berry bushes).

---

## Stops

### 1. Tower start / breach, looking west down the hill
Pose `1486.5,1025,2.4,256,0` (reference: `docs/test-reports/meadow-mesh2-after-breach.png`, older renderer)
- Strong opening composition: the road falls away west, the far signal tower (farTower billboard, azimuth 255) sits almost on the view axis, and Burl stands 16 m out on the path. Vines on the tower walls (rs411-415) and the crown envelope sell the wreck.
- The meadow (mdw000-289, rs062-123) is rich in grass, flowers, clover and pebbles, but has only about 10 trees, so it reads as open hillside. That is right for a meadow.
- Animals: 5 quest boars (boar1-5) sit 18-55 m from the breach. You will see animals here.

### 2. Burl's berry slope (north meadow)
Pose `1465,1022,2.3,312,-3` (reference: `docs/test-reports/npc-bear-01-burl.png`)
- The 6 quest bushes (poi000-005) sit exactly on the berry sprigs (berry1-6), and the wary boar group N (boarN1-3) grazes among them, which is nice storytelling: boars eat the berries.
- Weak point: the berry bushes and `burlBush` are plain `Bush_Common`, the same as about 100 other bushes. Only the small sprig sprite marks the patch, so from 20 m it is not readable as "the berry patch".
- DeadTree_2 (mdw014) and the crate-and-log pile at (1461,1016) give it a little "camp" detail.

### 3. Waystone, looking back at the tower
Pose `1428,1040,0.8,77,4` (reference: `docs/test-reports/captures/.../22-world-m1-waystonelookback.png`)
- Good landmark pair: the waystone up close, the tower on the crest. Rock path slabs and pebbles (roadS) lead the eye up the hill.
- The two DeadTree_1s (roadS00, roadS18) frame the road well.
- The fence run rprop004-008 (1408-1418, 1051) is a nice "edge of the farmed land" signal.

### 4. Road West, the wagon stop
Pose `1340,1048,-13,275,0` (reference: `docs/test-reports/m4-roadside-cart.png`)
- The broken wagon, crates and support (rs000-006) are a good lived-in moment. Both sides of the road have mixed CommonTree/Pine/Twisted, bushes and flowers.
- An X-shaped beam reads as floating at mid-height in the reference capture, left of centre. It is probably `rs006 Prop_Support` (collide false, 1349,1054.6) or `rs005 Roof_Log`; check it.
- No placed animals between x 1240 and 1400, so this stretch depends fully on random ambient spawns.

### 5. Bend relay
Pose `1280,1044,-26,301,2`
- The relay plinth, the dead relay, the knot post, the ruined Wall_Arch with vine (rprop013-020) and the two brass lamps (rsLamp1/2) make a good small composition, and the most "story" spot on the road.
- The knot post is a Prop_Crate with a Prop_WoodenFence_Single at 0.55 scale on top (poi103/104). It reads as junk on a box, not as a knotted marker post.
- The lamps are "static, no light", so at dusk the Bend is dark apart from the emissive voxels.
- The heart-piece chestBend (1268,1014) on the ridge has no landmark (no outcrop or lone tree) pulling the eye to it.

### 6. West of the Bend (1180-1240)
Pose `1215,1052,-45,272,0`
- Dense on both sides (roadW, roadN), with a lone chimney and brick pile (rprop028-034) and a log pile (rs056-061). Nice "burned homestead" hint.
- **Copy-stamp visible in the data:** roadW000-004 = roadN000-004 = roadL000-004 = roadG000-004 = roadF000-004 (Bush yaw 45, Bush yaw 332 at -4.4 m, grass yaws 42/259/74). The trio CommonTree_4 yaw 340 + Pine_4 yaw 51 + Pine_3 yaw 131 repeats at roadW005-007 and roadN005-007. Identical silhouettes at every section start.

### 7. Forest edges, mid-road (1090-1180)
Pose `1130,1062,-69,270,0` (reference: `docs/test-reports/trees-mesh-edge-mesh.png`)
- The edges are good: pines, CommonTree and TwistedTree_2 (roadF077), bush walls and flower drifts on the verges.
- Rocks are only Rock_Medium_1-3, almost all at scale 1, so the rock shapes look uniform. There is no boulder or outcrop anywhere along the road.
- The second wagon (rprop000-003, 1086,1059) is placed well as a "last stop before the river" beat.

### 8. The ford, east bank, looking west over the stepping stones
Pose `1048,1068,-87,270,-3`
- Clear gameplay read: 7 stepping stones (fordS1-7), dead trees on the bank (rs409, rs410), a boardwalk/jetty floor (rs049-055).
- The banks are bare. The biome rule `reeds` (river ± 14 m) has no mesh behind it: no tall grass or reed line, no fern line along the water. The river reads as a cut in a lawn.
- Shelf-fungus trees (roadG058/059/086, roadF018/064) with the red caps nearby are a good small quest detail.
- `roadF075 Pine_5` (1021.1,1086.9) is inside the `river_21` water rect, 1.8 m above the surface. Probably on the bank, but check it.

### 9. Crossroads with the trade post
Pose `998,1066,-88,285,0` (reference: `docs/test-reports/m4-roadside-crossroads.png`)
- Weakest stop. Flat flower meadow, crates (poi015-018, rs024-026), a broken chimney corner (rs027-036). The ruin sits far off and looks small. No tree within 40 m: the only placed tree on the west bank is roadF075.
- The signpost is again a crate with fence pieces stacked on it (poi010-012), and the trade post itself is crates with no roof, awning or counter, so it is hard to read as a post.
- No light and no smoke, although there is a chimney (rs030) right there.
- Boars F1/F2 graze nearby, which is good: one animal moment.

### 10. Straw-target field
Pose `966,1086,-84.4,117,0`
- Three practiceTargets at 13/22/23 m from the note post are clear. The field around them has no dressing at all: no fence, no hay stack, no worn ground.
- The note post is the same crate-plus-fence kludge (poi101/102).

### 11. Rook's stone ruin
Pose `992,1072,-87.5,309,8` (reference: `docs/test-reports/ob024-rook-ruin.png`)
- The ruin itself (UnevenBrick walls, window, door, chimney, fallen roof slab poi073, outer stair) is the best-built structure on this side, and it sits well against the forested hill with the tower on the skyline.
- Rook's nest is the `pickupGear` sprite (QL-D1 nest sprite pending), so the talking crow sits on a gear. It reads as a bug, not a nest.
- The ruin stands alone in an open lawn. Two or three framing trees and a broken wall line would ground it.

### 12. North footpath to the hidden chest + smoke
Pose `950,1000,-86.3,327,-2` (reference: `docs/test-reports/ob020-smoke-northlook.png`)
- The footpath of RockPath stones (poi019-039) is good wayfinding.
- The 3 farSmoke plumes (smoke1-3, 7-8 m apart) read as three thin evenly spaced grey poles in the reference capture.
- Check: the shipped world `bounds` union ends at about x 960 (last capsule (1090,1070)-(1000,1070), r 40). hiddenChest (930,968), hiddenScrawl, the northLook zone (955,1005), the smoke anchors and boarF1 (958,1078) are outside it. If those bounds are the walk limit (grid=1 is default OFF), the hidden chest may be unreachable or sit behind the edge hint.

### Dusk (2 views to take)
Poses `1263,1050,-31,96,2` (Bend lamps) and `998,1066,-88,285,0` with the dusk time preset (reference: `docs/test-reports/dn02-dusk.png` is indoors only).
- From the data: no outdoor light on this side at dusk.
  - rsLamp1/2 are static with no light.
  - The relays and the waystone are `on: false` until the quest lights them.
  - The trade post, ruin and straw field have no light and no smoke.
  - The only warm light is the player's hand.

---

## Animals: would a player see them?
- **Placed:** 15 boars, all one species.
  - 5 quest boars plus 3 + 2 + 3 wary boars on the tower hill (x 1408-1472).
  - 2 at the ford (boarF1/2, x 958-962).
  - None between x 1240 and 1400 (Road West and the Bend). Burl and Rook are the only other creatures.
- **Ambient (wildlifeFx):** rabbit, deer, fox, squirrel, songbird and crow, with caps 10/6/2/6/14/3. But:
  1. `wildEnv.js` reserves **12 pool slots** for all animals together (`WILD_POOL_RESERVE`). Static props fill the rest of the 48-slot pool, so the caps of 41 are never reached on screen.
  2. Songbird perches and squirrel trunks come only from the **far-scatter trunk grid** (`buildTrunkGrid(world.scatter)`). The roughly 250 hand-placed roadside trees (structures) never get birds or squirrels, and these are the trees the player walks past.
  3. Spawn ring vs draw distance: rabbit 35-60 m with drawM 35, songbird 30-70 m with drawM 30, squirrel 25-50 m with drawM 25. They only become visible when the player walks straight toward them. Rabbits then flee at 12 m.
  4. Only the crow uses `riverbank`. The ford has no deer drinking and no birds on the water.
- Verdict: near the tower, yes. Along Road West, the Bend and the crossroads, a player can easily walk 300 m and see nothing move apart from a crow.

## Trees and plants vs the biome intent
- All three M4 regions (`tower`, `roadWest`, `ford` in `G.regions`) use the same forest recipe (broadleaf, thr 0.55, biome 1 = CommonTree only in the scatter). The hand placement adds pines, twisted and dead trees, so the near view varies, but the far view has no change from the tower hill to the river.
- Unused existing meshes that could add variety: TwistedTree_3, TwistedTree_5, DeadTree_5, Petal_1-5, Prop_MetalFence_Simple, Prop_ExteriorBorder_Straight1, WindowShutters_*, Door_1_*.

---

## GAP LIST (prioritized)

| # | What | Where (x,y) | Why it matters | Concrete fix (existing meshes/data) | Effort |
|---|---|---|---|---|---|
| 1 | No outdoor light or smoke at dusk | Bend lamps (1280,1052) (1246,1053.5); trade post (998,1060); chimneys rs030 (1006.2,1044.9), poi053 (978.7,1060.4); straw field (966,1086) | Dusk is the "alive" moment; right now it is just darker | Add `light` preset `lanternHook` (already in tower.level.json) to rsLamp1/2. Add a floorLantern + lanternHook at the trade post and the note post. Add an emitter preset `smoke` (tower level) on both chimneys. Check the light budget | S |
| 2 | Hand-placed trees get no birds or squirrels | all roadL/W/N/G/F/rs trees, x 1040-1470 | The trees the player walks past are lifeless | `createWildEnv`: add the structures whose mesh matches `CommonTree*/Pine*/TwistedTree*/DeadTree*` to the trunk grid (x, y, trunkR by species) so `perchNear`/`trunkNear` see them. Programmer item, game-side | M |
| 3 | Only one placed species, and empty middle stretches | Road West + Bend x 1240-1400; crossroads x 960-1050 | Owner question "animals?": 300 m with nothing moving | Place 2 wary boar groups (DRESS-01 pattern) at about (1300,1060) and (1225,1025). Add `riverbank` to deer `spawn.habitats` (deer at the ford). Raise rabbit drawM 35→45 and songbird 30→40 (perf check). Raise `WILD_POOL_RESERVE` 12→16 if the pool allows | S/M |
| 4 | Copy-stamped clusters | section starts roadL/W/N/G/F 000-007, e.g. (1213,1067) (1291,1033) (1107,1055) (1109,1080) | Identical bush+grass+tree trios with identical yaws read as copy-paste | Re-run the roadside generator with a seed per prefix and random yaw/scale per piece (jitter ±0.15 scale, any yaw) | S |
| 5 | "Posts" built as crate + fence pieces | knot (1264.2,1031.6) poi103/104; notePost (966,1086) poi101/102; signpost (990,1060.5) poi010-012 | Three story markers read as junk piles | Use an upright `Prop_Support` (beam, scale ~0.6) as the post with one `Prop_WoodenFence_Single` plank as the sign board. Drop the crate under it | S |
| 6 | Rook's nest is a gear sprite | nest (974.1,1056.4, z -83.07) | Story NPC sits on a placeholder | Ring of 4-5 `Roof_Log` at scale 0.15 plus `Grass_Wispy_Short` at 0.3 on the roof deck as the nest. Keep the pickup sprite on top until the mirror sprite exists | S |
| 7 | West bank almost treeless and undressed | crossroads/ruin/straw field x 940-1012, y 1040-1105 | Weakest stop; ruin and trade post float in a lawn | 3 framing clumps: TwistedTree_3/5 + CommonTree at (962,1066), (1001,1102), (948,1046). A Bush_Common hedge along the footpath poi019-039. A fence line (Prop_WoodenFence_*) on the south edge of the straw field (960-992,1104) + 2 crate "hay" stacks. A Roof_Wooden_2x1 awning on Prop_Support over the trade-post crates | M |
| 8 | Bare river banks | both banks x 1008-1016 and 1040-1050, y 1040-1095 | The river reads as a cut in a lawn; the `reeds` biome has no mesh | Grass_Wispy_Tall / Grass_Common_Tall (scale 0.45-0.6) in dense strips on both banks, Fern_1 + Plant_7 on the east bank, 2-3 Rock_Medium half-sunk at the stone line | S/M |
| 9 | Berry patch not readable | poi000-005 (1440-1455, 1000-1013), burlBush (1470.6,1030.9) | Quest target looks like every other bush | Tighten into one patch and carpet it with Flower_4_Group + Clover under the bushes. Optional: Petal_* (unused) scattered as fallen berries/petals | S |
| 10 | chestMeadow position vs intent | chest (1384,1062); fence rs007-013 at y 1029-1031 | Note says "N of the road near fenceMeadow" but the chest is 21 m S of the road with nothing framing it | Move it to about (1386,1024) behind the fence gap rs012, or fix the note and add a framing tree and rock | S |
| 11 | Far smoke reads as 3 poles | smoke1-3 (958,1004) (951,1008) (962,1000) | The "someone lives north" hook looks like pylons | Tune the farSmoke preset (wider base, drift, fade) and use 2 anchors about 20 m apart instead of 3 at 7 m | S |
| 12 | Uniform rocks, no outcrops | all Rock_Medium_* (scale 1); ridge at chestBend (1268,1014) | Flat-looking ground; the heart chest has no landmark | Scale about 20% of rocks 1.6-2.8. Build a 3-rock outcrop (Rock_Medium_1/2/3 at scale 2.5-3) next to chestBend and one on the hill above the wagon | S |
| 13 | Same forest recipe on all three stages | G.regions tower / roadWest / ford | No sense of travel from far away | Ford region: `kind: 'twisted'` near the river or a pine mix on the roadWest ridge (biome 2) with blendM 30. Check the 4k visible-tree budget and the keep mask | M |
| 14 | Possible buried, floating or misplaced props | rs040-044 Roof_Log z 1.38-1.64 next to crates at z 2.3 (1461-1464,1014-1018); X-beam in m4-roadside-cart (rs006/rs005 near 1349,1055); roadF075 Pine in the river_21 rect (1021.1,1086.9) | Clipping/floating breaks the realistic look | One headless capture each, then re-snap z to the ground (logs about +0.8) or move them | S |
| 15 | Bounds may exclude north-bank content | hiddenChest (930,968), northLook (955,1005), smoke anchors, boarF1 (958,1078) | Hidden chest or quest zone may be unreachable behind the edge hint | Check the walk limit with grid off. If enforced, extend the bounds union with a capsule (1000,1070)-(940,990) r 30 | S (check) |

**Engine/PO notes:** gap 2 is game code (`game/js/wild/wildEnv.js`, PC-B). Gap 1 needs the light-count budget confirmed by the architect if more than about 4 extra point lights are added in one view. Everything else is data in `world_m1.world.json` / the roadside generator / `wildlifeFx`.
