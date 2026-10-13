# OB-152 enemy / chest density per region (tools/density-report.mjs)

Chests = `chest*` entities of world_m1 (= chestDefs keys). Beasts = authored + WM-12 regional herds; goblins = authored camps + far camps (seed 12). km2 = walk-bounds area by 8 m sampling (first-match region rect).

| region | chests | boars | wolves | bears | goblins | km2 | chests/km2 | enemies/km2 |
|---|---|---|---|---|---|---|---|---|
| tower | 1 | 13 | 0 | 0 | 0 | 0.0 | 22.3 | 290.2 |
| roadWest | 1 | 3 | 0 | 0 | 0 | 0.0 | 26.6 | 79.7 |
| ford | 3 | 2 | 0 | 0 | 0 | 0.0 | 115.7 | 77.2 |
| whitecombs | 0 | 0 | 0 | 2 | 0 | 0.5 | 0.0 | 4.3 |
| westFells | 0 | 0 | 0 | 0 | 0 | 0.4 | 0.0 | 0.0 |
| northwood | 0 | 4 | 0 | 0 | 0 | 0.2 | 0.0 | 16.8 |
| glasswater | 1 | 3 | 0 | 0 | 0 | 0.3 | 3.9 | 11.6 |
| alpine | 0 | 0 | 0 | 2 | 0 | 0.2 | 0.0 | 8.7 |
| thornwood | 0 | 4 | 0 | 0 | 0 | 0.1 | 0.0 | 29.6 |
| outwall | 2 | 1 | 0 | 2 | 5 | 0.0 | 61.6 | 246.5 |
| ashMile | 0 | 2 | 0 | 0 | 4 | 0.1 | 0.0 | 68.2 |
| downs | 0 | 6 | 0 | 0 | 0 | 0.2 | 0.0 | 25.2 |
| signalHill | 0 | 3 | 0 | 0 | 5 | 0.1 | 0.0 | 86.8 |
| westHeath | 0 | 3 | 0 | 0 | 4 | 0.1 | 0.0 | 81.4 |
| reedmire | 0 | 4 | 0 | 0 | 0 | 0.2 | 0.0 | 23.0 |
| strand | 0 | 0 | 0 | 0 | 0 | 0.0 | 0.0 | 0.0 |
| heartland | 0 | 0 | 0 | 1 | 4 | 0.4 | 0.0 | 13.2 |
| TOTAL | 8 | 48 | 0 | 7 | 22 | 2.9 | 2.7 | 26.2 |

## Chests in the open (no beast home, goblin camp, relay or lever within 25 m): 3 of 8

- chestBoots (975.7, 1056.4) in ford
- chestRook (972.6, 1056.4) in ford
- chestBed (1240, 505) in glasswater
