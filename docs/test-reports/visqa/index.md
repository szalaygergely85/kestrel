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
| cliff | 1250,596 yaw 180 pitch -18 - falls lip looking down | ![cliff-09.png](cliff-09.png) | ![cliff-13.png](cliff-13.png) | ![cliff-22.png](cliff-22.png) |
| lake-shore | 1215,547 yaw 0 pitch 0 - Glasswater south shore | ![lake-shore-09.png](lake-shore-09.png) | ![lake-shore-13.png](lake-shore-13.png) | ![lake-shore-22.png](lake-shore-22.png) |
| burl-home | 1404,1019 yaw 0 pitch 4 - Burl's new home (1404,1010) | ![burl-home-09.png](burl-home-09.png) | ![burl-home-13.png](burl-home-13.png) | ![burl-home-22.png](burl-home-22.png) |

## Defects seen (VISQA-01, 2026-10-16; rows in docs/pc-b-queue.md "VISQA 2026-10-16")
- burl-home 09/13: "[####] Lv 1 Boar" bar pinned to the right screen edge with no boar in view - enemyBarView clamped off-screen anchors. FIXED (enemyBarView.js skips anchors outside the grid; re-run 13 clean).
- burl-home/meadow-road/bend 09+13: far mountains one flat cream/peach cut-out up to ~15 deg above the horizon (far fog = horizon colour only, OB-209 follow-up) -> VISQA-02.
- burl-home 13 (re-run): far tree line at right pale grey-tan flat blocks (far-tree LOD/fog) -> VISQA-03.
- lake-shore 09/13 (+ braid-falls/cliff sky rims): Glasswater bowl fully mint-hazed at 150 m -> VISQA-04.
- braid-falls 22: plunge foam clumps light grey/unlit at night -> VISQA-05.
- all spots 22: quick-bar plates disappear into the navy night scene -> VISQA-06.
- forest-edge 09, cemetery 09: rows of bright white dashes on mid-distance grass -> VISQA-07 (maybe OB-208 line glyphs).
- ford 09/13: pale pink-white stripe bands on the SE hill + lone dark door slab (farmGateLeaf) on the slope -> VISQA-08.
- forest-in 09: pale ghost tree centre-back + white horizontal fog streaks at the left horizon (same family as VISQA-02/03).
- No floating/sunk props, terrain holes or z-fighting seen at these 11 poses; tower-door/cemetery/bend/ford props sit on the ground.
