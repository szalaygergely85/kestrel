# content-lint findings, 2026-10-14

Command: `node tools/content-lint.mjs` (tools/content-lint.mjs, CONTENT-LINT-01). Content NOT fixed here; this is the baseline. Scatter trees (R1) are only checked with `--scatter` (slow); this run covers placed props and placed trees.

| rule | what | findings |
|---|---|---|
| R1 | floating placed props/trees | 0 |
| R2 | components.sprite | 55 |
| R3 | raw ids in player text | 33 |
| R4 | "relay" in player text | 0 |
| R5 | giver unreachable | 0 |
| R6 | smoke without source | 0 |
| R7 | chimney outside building | 0 |
| R8 | open-field chest (warn) | 1 |
| R9 | early objective across river (warn) | 63 |
| R10 | object giver/turn-in (warn) | 48 |
| R11 | Laetiporus / Prop_Support | 0 |

Total 200 (errors: 88, warnings: 112).

Notes: R3 are all journal "Given by" ids (relayBend, relayFord, owBoard, pierStone, relay_<region>) with no display name in errands.js LABELS; R1/R4/R5/R6/R7/R11 are clean today (earlier fixes hold). R2 = tower.* level entities + berry/other pickups still on sprites. R9 counts every quest target west of the river for quests with band < 5 and no level-5 gate (flag regexp LV5 in content-lint.mjs: none exists yet in content, so regional ow.* quests count as early).

## R2 components.sprite (55)

```
R2 tower.pallet (1497,1027.5): has components.sprite (canvasHeap): use a voxel model
R2 tower.brazier (1498.5,1024.5): has components.sprite (burner): use a voxel model
R2 tower.burnerFire (1498.5,1024.5): has components.sprite (burnerFire): use a voxel model
R2 tower.lantern (1499.9,1024.5): has components.sprite (lantern): use a voxel model
R2 tower.lampFlame (1499.7,1024.5): has components.sprite (lampFlame): use a voxel model
R2 tower.beaconBowl (1489,1025): has components.sprite (relay): use a voxel model
R2 tower.rubble1 (1499.5,1026.5): has components.sprite (rubble#0): use a voxel model
R2 tower.rubble2 (1494.5,1026.5): has components.sprite (rubble#1): use a voxel model
R2 tower.rubble3 (1492.5,1024.5): has components.sprite (rubble#2): use a voxel model
R2 tower.rubble4 (1496.5,1020.5): has components.sprite (rubble#1): use a voxel model
R2 tower.rubble5 (1495.8,1028.2): has components.sprite (rubble#0): use a voxel model
R2 tower.gondola (1495.4,1026.7): has components.sprite (gondola): use a voxel model
R2 tower.rigging (1495.3,1027.5): has components.sprite (rigging): use a voxel model
R2 tower.strut (1494.4,1026.2): has components.sprite (strut): use a voxel model
R2 tower.ropeTether (1494,1025.5): has components.sprite (ropeTether): use a voxel model
R2 tower.envelopeHeap (1483,1024.5): has components.sprite (envelopeHeap): use a voxel model
R2 tower.swordRubble (1487.5,1026.5): has components.sprite (rubble#2): use a voxel model
R2 tower.keeperLamp (1498.9,1027.3): has components.sprite (lantern): use a voxel model
R2 tower.keeperLampFlame (1498.7,1027.3): has components.sprite (lampFlame): use a voxel model
R2 tower.stairLamp (1494.1,1021.4): has components.sprite (lantern): use a voxel model
R2 tower.stairLampFlame (1494.3,1021.4): has components.sprite (lampFlame): use a voxel model
R2 tower.swordLamp (1492.5,1024.9): has components.sprite (lantern): use a voxel model
R2 tower.swordLampFlame (1492.5,1024.7): has components.sprite (lampFlame): use a voxel model
R2 berry1 (1440,1000): has components.sprite (berrySprig): use a voxel model
R2 berry2 (1444,1004.5): has components.sprite (berrySprig): use a voxel model
R2 berry3 (1449,1001): has components.sprite (berrySprig): use a voxel model
R2 berry4 (1452.5,1008): has components.sprite (berrySprig): use a voxel model
R2 berry5 (1446,1011): has components.sprite (berrySprig): use a voxel model
R2 berry6 (1455,1013): has components.sprite (berrySprig): use a voxel model
R2 nest (974.1,1056.4): has components.sprite (pickupGear): use a voxel model
R2 cap1 (1177.9,1083.5): has components.sprite (pickupRedCap): use a voxel model
R2 cap2 (1164.7,1045.5): has components.sprite (pickupRedCap): use a voxel model
R2 cap3 (1148.9,1052.5): has components.sprite (pickupRedCap): use a voxel model
R2 cap4 (1148,1078.7): has components.sprite (pickupRedCap): use a voxel model
R2 cap5 (1120.6,1082.5): has components.sprite (pickupRedCap): use a voxel model
R2 tradeLamp (1001,1060.3): has components.sprite (floorLantern): use a voxel model
R2 packet (1260.6,1034.8): has components.sprite (pickupGear): use a voxel model
R2 brass1 (1490,1010): has components.sprite (pickupGear): use a voxel model
R2 brass2 (1465,1047): has components.sprite (pickupGear): use a voxel model
R2 brass3 (1405,1040): has components.sprite (pickupGear): use a voxel model
R2 brass4 (1300,1048): has components.sprite (pickupGear): use a voxel model
R2 sgLamp1 (235,835): has components.sprite (floorLantern): use a voxel model
R2 sgLamp2 (235,845): has components.sprite (floorLantern): use a voxel model
R2 sgLamp3 (245,835): has components.sprite (floorLantern): use a voxel model
R2 sgLamp4 (245,845): has components.sprite (floorLantern): use a voxel model
R2 sgLamp5 (235,810): has components.sprite (floorLantern): use a voxel model
R2 sgLamp6 (235,870): has components.sprite (floorLantern): use a voxel model
R2 rsLamp1 (1280,1052): has components.sprite (floorLantern): use a voxel model
R2 rsLamp2 (1246,1053.5): has components.sprite (floorLantern): use a voxel model
R2 signArm (985,1062): has components.sprite (pickupGear): use a voxel model
R2 emberpod1 (1043,1044): has components.sprite (pickupGear): use a voxel model
R2 emberpod2 (1046,1048): has components.sprite (pickupGear): use a voxel model
R2 emberpod3 (1043,1039): has components.sprite (pickupGear): use a voxel model
R2 relayBrass (975,901.5): has components.sprite (pickupGear): use a voxel model
R2 barleySheaf1 (979,903.5): has components.sprite (pickupGear): use a voxel model
```

## R3 raw ids in player text (33)

```
R3 sq.rb.shield (-,-): journal "Given by" shows the raw id "relayBend" (no display name)
R3 sq.rb.regards (-,-): journal "Given by" shows the raw id "relayBend" (no display name)
R3 sq.rb.road (-,-): journal "Given by" shows the raw id "relayBend" (no display name)
R3 sq.fc.ford (-,-): journal "Given by" shows the raw id "relayFord" (no display name)
R3 sq.fc.smoke (-,-): journal "Given by" shows the raw id "relayFord" (no display name)
R3 sq.fc.cross (-,-): journal "Given by" shows the raw id "relayFord" (no display name)
R3 sq.fc.again (-,-): journal "Given by" shows the raw id "relayFord" (no display name)
R3 sq.rb.lamps (-,-): journal "Given by" shows the raw id "relayBend" (no display name)
R3 sq.rb.rocks (-,-): journal "Given by" shows the raw id "relayBend" (no display name)
R3 sq.rb.parcel (-,-): journal "Given by" shows the raw id "relayBend" (no display name)
R3 sq.fc.jetty (-,-): journal "Given by" shows the raw id "relayFord" (no display name)
R3 sq.fc.cog (-,-): journal "Given by" shows the raw id "relayFord" (no display name)
R3 mq.ow.board (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.hw.piers (-,-): journal "Given by" shows the raw id "pierStone" (no display name)
R3 sq.ow.wolves (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.boars (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.parcel (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.ford (-,-): journal "Given by" shows the raw id "pierStone" (no display name)
R3 sq.ow.barley (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.range (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.raid (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.bears (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.ow.trail (-,-): journal "Given by" shows the raw id "owBoard" (no display name)
R3 sq.reg.glasswater (-,-): journal "Given by" shows the raw id "relay_glasswater" (no display name)
R3 sq.reg.northwood (-,-): journal "Given by" shows the raw id "relay_northwood" (no display name)
R3 sq.reg.highPastures (-,-): journal "Given by" shows the raw id "relay_highPastures" (no display name)
R3 sq.reg.ashMile (-,-): journal "Given by" shows the raw id "relay_ashMile" (no display name)
R3 sq.reg.downs (-,-): journal "Given by" shows the raw id "relay_downs" (no display name)
R3 sq.reg.signalHill (-,-): journal "Given by" shows the raw id "relay_signalHill" (no display name)
R3 sq.reg.heath (-,-): journal "Given by" shows the raw id "relay_heath" (no display name)
R3 sq.reg.reedmire (-,-): journal "Given by" shows the raw id "relay_reedmire" (no display name)
R3 sq.reg.strand (-,-): journal "Given by" shows the raw id "relay_strand" (no display name)
R3 sq.reg.whitecombs (-,-): journal "Given by" shows the raw id "relay_whitecombs" (no display name)
```

## R8 open-field chest (warn) (1)

```
R8 chestBed (1240,505): no enemy/camp/puzzle/giver within 25 m (open-field chest)
```

## R9 early objective across river (warn) (63)

```
R9 sq.burl.scout (1010,1072): early quest target "fordWest" is west of the river (x < 1029.4)
R9 sq.burl.parcel (998.2,1060.2): early quest target "post" is west of the river (x < 1026.6)
R9 sq.post.spare (998.2,1060.2): early quest target "post" is west of the river (x < 1026.6)
R9 sq.post.spare (966,1086): early quest target "notePost" is west of the river (x < 1032.8)
R9 sq.rb.shield (992,1079): early quest target "relayFord" is west of the river (x < 1031.1)
R9 sq.rb.shield (1010,1072): early quest target "fordWest" is west of the river (x < 1029.4)
R9 sq.fc.ford (992,1079): early quest target "relayFord" is west of the river (x < 1031.1)
R9 sq.fc.ford (1010,1072): early quest target "fordWest" is west of the river (x < 1029.4)
R9 sq.rb.parcel (992,1079): early quest target "relayFord" is west of the river (x < 1031.1)
R9 sq.he.wallow (982,1060): early quest target "rook" is west of the river (x < 1026.6)
R9 sq.fc.caps (982,1060): early quest target "rook" is west of the river (x < 1026.6)
R9 sq.fc.well (982,1060): early quest target "rook" is west of the river (x < 1026.6)
R9 sq.fc.well (994,1051.5): early quest target "well" is west of the river (x < 1024.8)
R9 sq.fc.jetty (992,1079): early quest target "relayFord" is west of the river (x < 1031.1)
R9 sq.fc.ask (982,1060): early quest target "rook" is west of the river (x < 1026.6)
R9 sq.honey (982,1060): early quest target "rook" is west of the river (x < 1026.6)
R9 sq.rook.shiny (982,1060): early quest target "rook" is west of the river (x < 1026.6)
R9 sq.packet (998.2,1060.2): early quest target "post" is west of the river (x < 1026.6)
R9 mq.ow.path (942,925.3): early quest target "owPath" is west of the river (x < 1030.5)
R9 mq.ow.fence (849.6,996): early quest target "wolf1" is west of the river (x < 1018.3)
R9 mq.ow.fence (845.9,984.9): early quest target "wolf2" is west of the river (x < 1018.5)
R9 mq.ow.fence (856.6,980.6): early quest target "wolf3" is west of the river (x < 1018.7)
R9 mq.ow.fence (871.6,976.2): early quest target "wolf4" is west of the river (x < 1019.1)
R9 mq.ow.fence (857.6,1003.8): early quest target "wolf5" is west of the river (x < 1018.5)
R9 mq.ow.names (938,930): early quest target "hesk" is west of the river (x < 1028.8)
R9 sq.hw.piers (978,1050): early quest target "pierStone" is west of the river (x < 1024.5)
R9 sq.fc.sign (998.2,1060.2): early quest target "post" is west of the river (x < 1026.6)
R9 sq.ow.wolves (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.wolves (849.6,996): early quest target "wolf1" is west of the river (x < 1018.3)
R9 sq.ow.wolves (845.9,984.9): early quest target "wolf2" is west of the river (x < 1018.5)
R9 sq.ow.wolves (856.6,980.6): early quest target "wolf3" is west of the river (x < 1018.7)
R9 sq.ow.wolves (871.6,976.2): early quest target "wolf4" is west of the river (x < 1019.1)
R9 sq.ow.wolves (857.6,1003.8): early quest target "wolf5" is west of the river (x < 1018.5)
R9 sq.ow.boars (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.boars (958,1078): early quest target "boarF1" is west of the river (x < 1030.8)
R9 sq.ow.boars (962,1081): early quest target "boarF2" is west of the river (x < 1031.5)
R9 sq.ow.parcel (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.parcel (912,935): early quest target "owForge" is west of the river (x < 1027.2)
R9 sq.ow.ford (978,1050): early quest target "pierStone" is west of the river (x < 1024.5)
R9 sq.ow.ford (1010,1072): early quest target "fordWest" is west of the river (x < 1029.4)
R9 sq.ow.barley (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.range (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.raid (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.night (938,930): early quest target "hesk" is west of the river (x < 1028.8)
R9 sq.ow.night (849.6,996): early quest target "wolf1" is west of the river (x < 1018.3)
R9 sq.ow.night (845.9,984.9): early quest target "wolf2" is west of the river (x < 1018.5)
R9 sq.ow.night (856.6,980.6): early quest target "wolf3" is west of the river (x < 1018.7)
R9 sq.ow.night (871.6,976.2): early quest target "wolf4" is west of the river (x < 1019.1)
R9 sq.ow.night (857.6,1003.8): early quest target "wolf5" is west of the river (x < 1018.5)
R9 sq.ow.bears (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.bears (880,915): early quest target "blackBear1" is west of the river (x < 1034.5)
R9 sq.ow.bears (940,905): early quest target "blackBear2" is west of the river (x < 1039)
R9 sq.ow.bears (935,1010): early quest target "blackBear3" is west of the river (x < 1018.9)
R9 sq.ow.letters (938,930): early quest target "hesk" is west of the river (x < 1028.8)
R9 sq.ow.letters (909,938): early quest target "dorrin" is west of the river (x < 1026.3)
R9 sq.ow.trail (921,945): early quest target "owBoard" is west of the river (x < 1024.4)
R9 sq.ow.trail (942,925.3): early quest target "owPath" is west of the river (x < 1030.5)
R9 sq.ow.trail (990,1062): early quest target "crossroads" is west of the river (x < 1027)
R9 sq.reg.glasswater (1183,662): early quest target "relay_glasswater" is west of the river (x < 1222.9)
R9 sq.reg.highPastures (661,634): early quest target "relay_highPastures" is west of the river (x < 1235.8)
R9 sq.reg.signalHill (689,1291): early quest target "relay_signalHill" is west of the river (x < 1046.4)
R9 sq.reg.heath (490,1345): early quest target "relay_heath" is west of the river (x < 1032.6)
R9 sq.reg.whitecombs (202,239): early quest target "relay_whitecombs" is west of the river (x < 1179.4)
```

## R10 object giver/turn-in (warn) (48)

```
R10 sq.burl.parcel (998.2,1060.2): turn-in "post" is an object, not a character
R10 sq.post.spare (998.2,1060.2): giver "post" is an object, not a character
R10 sq.post.spare (966,1086): turn-in "notePost" is an object, not a character
R10 sq.straw (966,1086): giver "notePost" is an object, not a character
R10 sq.rb.shield (1262,1033): giver "relayBend" is an object, not a character
R10 sq.rb.shield (992,1079): turn-in "relayFord" is an object, not a character
R10 sq.rb.regards (1262,1033): giver "relayBend" is an object, not a character
R10 sq.rb.road (1262,1033): giver "relayBend" is an object, not a character
R10 sq.fc.ford (992,1079): giver "relayFord" is an object, not a character
R10 sq.fc.smoke (992,1079): giver "relayFord" is an object, not a character
R10 sq.fc.cross (992,1079): giver "relayFord" is an object, not a character
R10 sq.fc.again (992,1079): giver "relayFord" is an object, not a character
R10 sq.rb.lamps (1262,1033): giver "relayBend" is an object, not a character
R10 sq.rb.rocks (1262,1033): giver "relayBend" is an object, not a character
R10 sq.rb.parcel (1262,1033): giver "relayBend" is an object, not a character
R10 sq.rb.parcel (992,1079): turn-in "relayFord" is an object, not a character
R10 sq.fc.stores (998.2,1060.2): giver "post" is an object, not a character
R10 sq.fc.shrine (966,1086): giver "notePost" is an object, not a character
R10 sq.fc.jetty (992,1079): giver "relayFord" is an object, not a character
R10 sq.fc.cog (992,1079): giver "relayFord" is an object, not a character
R10 sq.fc.cog (1262,1033): turn-in "relayBend" is an object, not a character
R10 sq.wreck.plate (1496,1024): giver "gondola" is an object, not a character
R10 sq.packet (1260.6,1034.8): giver "packet" is an object, not a character
R10 sq.packet (998.2,1060.2): turn-in "post" is an object, not a character
R10 mq.ow.board (921,945): giver "owBoard" is an object, not a character
R10 sq.hw.piers (978,1050): giver "pierStone" is an object, not a character
R10 sq.fc.sign (998.2,1060.2): giver "post" is an object, not a character
R10 sq.ow.wolves (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.boars (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.parcel (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.parcel (912,935): turn-in "owForge" is an object, not a character
R10 sq.ow.ford (978,1050): giver "pierStone" is an object, not a character
R10 sq.ow.barley (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.range (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.raid (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.bears (921,945): giver "owBoard" is an object, not a character
R10 sq.ow.trail (921,945): giver "owBoard" is an object, not a character
R10 sq.reg.glasswater (1183,662): giver "relay_glasswater" is an object, not a character
R10 sq.reg.northwood (1671,626): giver "relay_northwood" is an object, not a character
R10 sq.reg.highPastures (661,634): giver "relay_highPastures" is an object, not a character
R10 sq.reg.ashMile (1798,1047): giver "relay_ashMile" is an object, not a character
R10 sq.reg.downs (1580,1430): giver "relay_downs" is an object, not a character
R10 sq.reg.signalHill (689,1291): giver "relay_signalHill" is an object, not a character
R10 sq.reg.heath (490,1345): giver "relay_heath" is an object, not a character
R10 sq.reg.reedmire (1116,1401): giver "relay_reedmire" is an object, not a character
R10 sq.reg.strand (1606,1675): giver "relay_strand" is an object, not a character
R10 sq.reg.strand (1580,1430): turn-in "relay_downs" is an object, not a character
R10 sq.reg.whitecombs (202,239): giver "relay_whitecombs" is an object, not a character
```
