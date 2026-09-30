# RTS engine work -> use in the Zelda-like RPG (2026-09-30)

Input for the manager + PO sprint re-plan after D-032 amendment 1 (RTS NO-GO, back to the RPG). The owner agreed to hand this over ("ok"). These are suggestions, not decisions. All the engine parts listed are done and reviewed unless marked otherwise.

| Built for the RTS | RPG use | Suggested slot |
|---|---|---|
| NavGrid + A* + flow field + steering (RE-05/08/09/10) | Enemy AI that chases, flanks and goes around rocks without bunching up; covers the planned US-084 "pathfinding" | **M3 combat** (US-079 first enemy AI) |
| Selection overlay (RE-07: rings, bars, markers) | **Z-targeting** lock-on ring under the target, enemy health bars, interaction markers ("press E") | **M3 combat** (new story: Z-target) |
| Team colour remap (RE-06, `team.*` materials) | Enemy colour tiers (green/blue/red variants of one model), dyed gear | M3/M4 content |
| Instanced voxel models (RE-06/06b/06c; RE-15 cull/LOD queued) | Many repeated overworld props: rocks, bushes, grass tufts, fences, enemy packs | M3+ world dressing |
| Visibility grid / fog of war (RE-11, save wiring RE-11b) | Map exploration: seen areas revealed on the map card, dungeon maps filled room by room | **M4 adventure loop** |
| Minimap (RE-13) | Overworld minimap or a better map card | M4 |
| Pitched camera = the mesh camera (RE-02a/b, D-029 amendment 2) | Proper first-person look up/down (clamp 70); options: third-person follow cam, overview/cutscene shots | now (RE-02b arch-review) + later options |
| Deterministic commands / replay / state hash (RE-14/14b) | Bug repro ("send me the replay"), a base for save/load checks | tooling, M4 save |
| ME-22 large voxel models (queued, PC-B Q6 item 14) | The owner's big trees and buildings in `design/vox/environment` | M2 tail / M3 |
| BUG-RTS-001 terrain look-hash fix | Terrain reads better when looking down steeply in first person | done |

Also kept: `game/rts-test.html` as a top-down engine sample (the engine shows 3D first person and a 2.5D top-down view).
