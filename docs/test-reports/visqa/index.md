# VISQA-01 sweep

`node tools/visqa-sweep.mjs <port>` - live clock, god mode + ground snap, quality=medium, webgpu, 1000x700.

| spot | pose | 9:00 | 10:00 | 11:00 | 13:00 | 21:00 |
|---|---|---|---|---|---|---|
| tower-door | 1488,1040 yaw 0 pitch 6 - tower SW door from the south | - | - | - | - | - |
| meadow-road | 1440,1040 yaw 270 pitch 0 - start meadow, road west | - | - | - | - | - |
| forest-in | 1250,1062 yaw 270 pitch 0 - densest tree cell (41..42,35) | ![forest-in-09.png](forest-in-09.png) | - | - | - | - |
| forest-edge | 1172,1044 yaw 90 pitch 0 - QL-B2 forestEdge zone, looking into the forest | ![forest-edge-09.png](forest-edge-09.png) | ![forest-edge-10.png](forest-edge-10.png) | ![forest-edge-11.png](forest-edge-11.png) | ![forest-edge-13.png](forest-edge-13.png) | - |
| ford | 1010,1072 yaw 90 pitch 0 - fordWest, across the stepping stones | ![ford-09.png](ford-09.png) | ![ford-10.png](ford-10.png) | ![ford-11.png](ford-11.png) | ![ford-13.png](ford-13.png) | - |
| bend | 1262,1042 yaw 0 pitch 0 - Bend relay/waystone | - | - | - | - | - |
| cemetery | 1644,1382 yaw 0 pitch 0 - cemetery1 | ![cemetery-09.png](cemetery-09.png) | - | - | ![cemetery-13.png](cemetery-13.png) | - |
| braid-falls | 1238,632 yaw 0 pitch 12 - braidFalls from below | - | - | - | - | - |
| cliff | 1552,468 yaw 0 pitch 12 - northwood hillside cliff face (~9 m rise at y 454-458), looking up from below (VISQA-09; the old 1250,596 spot stood in the outlet river) | - | - | - | - | - |
| lake-shore | 1215,547 yaw 0 pitch 0 - Glasswater south shore | ![lake-shore-09.png](lake-shore-09.png) | - | - | ![lake-shore-13.png](lake-shore-13.png) | - |
| burl-home | 1404,1019 yaw 0 pitch 4 - Burl's new home (1404,1010) | - | - | - | - | - |
| smoke-fire | 958,1011 yaw 0 pitch 6 - VISQA-15: smokeFire1 brazier at the base of the goblin smoke plume (958,1004) | - | - | - | - | ![smoke-fire-21.png](smoke-fire-21.png) |

## Set 2 (VISQA-10)

`node tools/visqa-sweep.mjs <port> --set 2` - default hour, god mode; interiors at the floor z, close-ups 3.5 m, UI via real key events.

| still | pose / key | note |
|---|---|---|
| ![s2-crypt.png](s2-crypt.png) | 1674,1375.3 z -56.8 (now -56.8) yaw 0 | crypt last room (level 24,29) looking north at torch1a/2b |
| ![s2-ford-cellar.png](s2-ford-cellar.png) | 999.2,1062.2 z -92.5 (now -92.5) yaw 45 | Ford smugglers cellar SW corner looking NE (lantern + 2 torches) |
| ![s2-sea-cave.png](s2-sea-cave.png) | 1618.5,1729.5 z -95.31 (now -95.31) yaw 0 | Strand sea cave chamber from the south mouth |
| ![s2-goblin-tunnel.png](s2-goblin-tunnel.png) | 945,946 z -88.8 (now -88.8) yaw 0 | goblin tunnel room (level 19,30) looking north, torchRoom |
| ![s2-bear-den.png](s2-bear-den.png) | 1584,437 z 11.76 (now 11.76) yaw 0 | northwood bear den chamber from the mouth side (no lights in level) |
| ![s2-burl.png](s2-burl.png) | 1467.6,1030.0 -> 1471.0,1029.1 z 2.4 | Burl (npc bear) |
| ![s2-rook.png](s2-rook.png) | 985.5,1059.8 -> 982.0,1060.0 z -86.4 | Rook |
| ![s2-warden.png](s2-warden.png) | 1666.8,625.8 -> 1669.0,628.5 z -49.7 | region warden (char.kit) |
| ![s2-boar.png](s2-boar.png) | 1460.2,1030.7 -> 1463.7,1030.4 z 2.4 | first boar |
| ![s2-wolf.png](s2-wolf.png) | 849.8,997.1 -> 852.8,998.9 z -74.6 | first wolf |
| ![s2-skeleton.png](s2-skeleton.png) | 1641.0,1376.5 -> 1641.0,1373.0 z -50.0 | first skeleton |
| ![s2-ui-inventory.png](s2-ui-inventory.png) | KeyI | pack (I) |
| ![s2-ui-character.png](s2-ui-character.png) | KeyC | character / equipment (C) |
| ![s2-ui-journal.png](s2-ui-journal.png) | KeyJ | quest journal (J) |
| ![s2-ui-map.png](s2-ui-map.png) | KeyM | map (M) |
| ![s2-ui-pause.png](s2-ui-pause.png) | lock lost | pause menu (pointer lock lost = what Esc does in a real browser) |
| ![s2-ui-settings.png](s2-ui-settings.png) | KeyS+Enter | Settings from the pause menu (S selects, Enter opens) |
