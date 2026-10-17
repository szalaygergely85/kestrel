# Foliage cap bench rtx 2026-10-16

quality ultra, pose roadSouth, grid 480x180, 10 s orbit per step, d2e78709

```
LOD0 tris  GPU p50  GPU p95  JS p95  D-085
---------  -------  -------  ------  -----
   0.50 M     3.89     4.68   40.00     ok
   1.00 M     4.41     5.01    8.10     ok
   1.50 M     4.02     4.70    9.30     ok
   2.00 M     4.42     5.02    9.30     ok
   3.00 M     4.81     5.67    9.60     ok
```

FOLIAGE_TRI_CAP candidate (largest step inside D-085): all steps fit up to 3.0 M (<= 8 ms GPU p95); raise the top step
