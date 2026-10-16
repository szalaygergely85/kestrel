# VISQA-01 sweep

`node tools/visqa-sweep.mjs <port>` - live clock, god mode + ground snap, quality=medium, webgpu, 1000x700.

| spot | pose | 9:00 | 13:00 | 22:00 |
|---|---|---|---|---|
| tower-door | 1488,1040 yaw 0 pitch 6 - tower SW door from the south | ![tower-door-09.png](tower-door-09.png) | ![tower-door-13.png](tower-door-13.png) | ![tower-door-22.png](tower-door-22.png) |
| meadow-road | 1440,1040 yaw 270 pitch 0 - start meadow, road west | ![meadow-road-09.png](meadow-road-09.png) | ![meadow-road-13.png](meadow-road-13.png) | ![meadow-road-22.png](meadow-road-22.png) |
| forest-in | 1250,1062 yaw 270 pitch 0 - densest tree cell (41..42,35) | ![forest-in-09.png](forest-in-09.png) | ![forest-in-13.png](forest-in-13.png) | ![forest-in-22.png](forest-in-22.png) |
| forest-edge | 1172,1044 yaw 90 pitch 0 - QL-B2 forestEdge zone, looking into the forest | ![forest-edge-09.png](forest-edge-09.png) | ![forest-edge-13.png](forest-edge-13.png) | ![forest-edge-22.png](forest-edge-22.png) |
| ford | 1010,1072 yaw 90 pitch 0 - fordWest, across the stepping stones | ![ford-09.png](ford-09.png) | ![ford-13.png](ford-13.png) | ![ford-22.png](ford-22.png) |
| bend | 1262,1042 yaw 0 pitch 0 - Bend relay/waystone | ![bend-09.png](bend-09.png) | ![bend-13.png](bend-13.png) | ![bend-22.png](bend-22.png) |
| cemetery | 1644,1382 yaw 0 pitch 0 - cemetery1 | ![cemetery-09.png](cemetery-09.png) | ![cemetery-13.png](cemetery-13.png) | ![cemetery-22.png](cemetery-22.png) |
| braid-falls | 1238,632 yaw 0 pitch 12 - braidFalls from below | ![braid-falls-09.png](braid-falls-09.png) | ![braid-falls-13.png](braid-falls-13.png) | ![braid-falls-22.png](braid-falls-22.png) |
| cliff | 1552,468 yaw 0 pitch 12 - northwood hillside cliff face (~9 m rise at y 454-458), looking up from below (VISQA-09; the old 1250,596 spot stood in the outlet river) | ![cliff-09.png](cliff-09.png) | ![cliff-13.png](cliff-13.png) | ![cliff-22.png](cliff-22.png) |
| lake-shore | 1215,547 yaw 0 pitch 0 - Glasswater south shore | ![lake-shore-09.png](lake-shore-09.png) | ![lake-shore-13.png](lake-shore-13.png) | ![lake-shore-22.png](lake-shore-22.png) |
| burl-home | 1404,1019 yaw 0 pitch 4 - Burl's new home (1404,1010) | ![burl-home-09.png](burl-home-09.png) | ![burl-home-13.png](burl-home-13.png) | ![burl-home-22.png](burl-home-22.png) |
| smoke-fire | 958,1011 yaw 0 pitch 6 - VISQA-15: smokeFire1 brazier at the base of the goblin smoke plume (958,1004) | ![smoke-fire-09.png](smoke-fire-09.png) | ![smoke-fire-13.png](smoke-fire-13.png) | ![smoke-fire-22.png](smoke-fire-22.png) |

## Set 2 (VISQA-10)

`node tools/visqa-sweep.mjs <port> --set 2` - default hour, god mode; interiors at the floor z, close-ups 3.5 m, UI via real key events.

| still | pose / key | note |
|---|---|---|
| ![s2-crypt.png](s2-crypt.png) | 1674,1375.3 z -56.8 (now -56.8) yaw 0 | crypt last room (level 24,29) looking north at torch1a/2b |
| ![s2-ford-cellar.png](s2-ford-cellar.png) | 999.2,1062.2 z -92.5 (now -92.5) yaw 45 | Ford smugglers cellar SW corner looking NE (lantern + 2 torches) |
| ![s2-sea-cave.png](s2-sea-cave.png) | 1618.5,1729.5 z -95.31 (now -95.31) yaw 0 | Strand sea cave chamber from the south mouth |
| ![s2-goblin-tunnel.png](s2-goblin-tunnel.png) | 945,946 z -88.8 (now -88.8) yaw 0 | goblin tunnel room (level 19,30) looking north, torchRoom |
| ![s2-bear-den.png](s2-bear-den.png) | 1584,437 z 11.76 (now 11.76) yaw 0 | northwood bear den chamber from the mouth side (no lights in level) |
| ![s2-burl.png](s2-burl.png) | cam 1440.0,1040.0 subject 1436.5,1040.0 z 1.3 yaw 76 (home 1471,1029,2,75) | Burl (npc bear) |
| ![s2-rook.png](s2-rook.png) | cam 1440.0,1040.0 subject 1436.5,1040.0 z 1.3 yaw 90 (home 982,1060,-86,270) | Rook |
| ![s2-warden.png](s2-warden.png) | cam 1440.0,1040.0 subject 1436.5,1040.0 z 1.3 yaw 90 (home 1669,629,-50,141) | region warden (char.kit) |
| ![s2-boar.png](s2-boar.png) | cam 1440.0,1040.0 subject 1436.5,1040.0 z 1.3 yaw 90 (home 1463,1029,2,70) | first boar |
| ![s2-wolf.png](s2-wolf.png) | cam 1440.0,1040.0 subject 1436.5,1040.0 z 1.3 yaw 90 (home 853,999,-75,121) | first wolf |
| ![s2-skeleton.png](s2-skeleton.png) | cam 1440.0,1040.0 subject 1436.5,1040.0 z 1.3 yaw 90 (home 1738,202,211,0) | first surface skeleton (crypt ones do not render when pinned to the meadow) |
| ![s2-ui-inventory.png](s2-ui-inventory.png) | KeyI | pack (I) |
| ![s2-ui-character.png](s2-ui-character.png) | KeyC | character / equipment (C) |
| ![s2-ui-journal.png](s2-ui-journal.png) | KeyJ | quest journal (J) |
| ![s2-ui-map.png](s2-ui-map.png) | KeyM | map (M) |
| ![s2-ui-pause.png](s2-ui-pause.png) | lock lost | pause menu (pointer lock lost = what Esc does in a real browser) |
| ![s2-ui-settings.png](s2-ui-settings.png) | KeyS+Enter | Settings from the pause menu (S selects, Enter opens) |
