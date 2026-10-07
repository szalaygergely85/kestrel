# MESH-FULL-01 gpucompare known-FAIL baselines (D-045)

Merged state of origin/wip/mesh-full-parked on pc-a 792d590, same machine (Intel ANGLE D3D11), grid null. A8 classification: kind-9 raster ties. Later runs may not exceed these; PREC-04 restores PASS.

| row | cmpGeom.geomViolCells | cmpCells.cellsOutside | cmpCells.glyphMatchPct | cmpGeom.faceViol | cmpGeom.nrmViol | cmpLight.dLViol |
|---|---|---|---|---|---|---|
| world_m1: breachDown | 1 | 4 | 99.989 | 0 | 0 | 0 |
| world_m1: parapetSky | 5 | 8 | 99.898 | 1 | 4 | 6 |
| world_m1: signal tower | 6 | 8 | 99.9 | 3 | 3 | 6 |
| world_m1: outsideNear (owner pose A) | 3 | 6 | 99.944 | 1 | 0 | 3 |
| world_m1: outsideFar (owner pose B) | 3 | 21 | 99.841 | 2 | 1 | 0 |
| world_m1: forestEdge (ME-06b background canopy face) | 4 | 10 | 99.971 | 1 | 3 | 3 |
| world_m1: rtsHillSky15 (RE-02a pitched, sky + fog scale) | 6 | 24 | 99.893 | 3 | 3 | 3 |
| world_m1: water pond top-down (US-055a2b, pitched default, pitch -75, sun az 135 el 30) | 9 | 32 | 99.806 | 0 | 9 | 24 |
| world_m1: water pond look top-down (36.1b, drift/glint) | 9 | 32 | 99.806 | 0 | 9 | 24 |
| world_m1: water murky look top-down (36.1b, drift/glint) | 9 | 32 | 99.806 | 0 | 9 | 24 |
| world_m1: water sea (US-055a2b, flooded plain 1 m below the eye, shear pitch -3, sun az 135 el 30) | 8 | 10 | 99.87 | 3 | 3 | 6 |
| world_m1: waterfall front (US-142a1, tick 600) | 5 | 13 | 99.895 | 3 | 2 | 12 |
| world_m1: waterfall back (US-142a1, tick 600) | 3 | 21 | 99.866 | 2 | 0 | 0 |
| world_m1: water flowing radial pool top-down (US-141a, flowRadial 2 + flow, t 10 s, pitched default, pitch -75, sun az 135 el 30) | 9 | 32 | 99.788 | 0 | 9 | 24 |
| world_m1: detailWalkout (ENV-01a2, ground scatter) | 1 | 6 | 99.946 | 1 | 0 | 3 |
