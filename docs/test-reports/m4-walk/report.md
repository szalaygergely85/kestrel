# M4 owner-walk readiness (2026-10-12)

**RED** - 0/7 steps pass. Stills at 240x90 (docs/test-reports/m4-walk/).

## Steps

| Step | Result | Time | Note |
|---|---|---|---|
| run-tests | RED | 908 s | exit 1: PASS tools/validate-content.mjs 2512ms / WARN tools/typecheck.mjs 7532ms / 647 suite(s): 642 PASS, 4 FAIL, 0 TI~ |
| check-deps | skipped |  |  |
| validate-content | skipped |  |  |
| quest-sim | skipped |  |  |
| route-walk | skipped |  |  |
| verify-m4-exit | skipped |  |  |
| verify-ch12-run | skipped |  |  |

## Walk stills (m4-review section 4)

| Stop | What to look at | Still |
|---|---|---|

## OB rows in "fixed - verify"

| Row | Bug | Still |
|---|---|---|
| OB-044 | (gate found) Route-walk R1 'Rook ruin climb' gets stuck at waypoint 11 on the mesh path since the stone-ruin rebuild (OB-024) - the player may not re~ | owner check only |
| OB-039 | (agent found) Sealed Gate wooden leaves sg039/sg040 never draw (a test crate there did not draw either) - doorway looks open / Suspect mesh draw caps~ | owner check only |
| OB-038 | Design walk: west bank (crossroads, straw field, ruin) almost bare; trade post does not read / framing tree clumps (TwistedTree_3/5), hedge, fence, a~ | owner check only |
| OB-037 | Design walk: river banks bare / tall-grass/reed strips, ferns + rocks at the stepping stones (S/M); report docs/test-reports/design-walk-2026-10-11.md | owner check only |
| OB-036 | Design walk: Rook's nest shows the gear pickup sprite / ring of small Roof_Log + grass meshes on the roof (S); report docs/test-reports/design-walk-2~ | owner check only |
| OB-035 | Design walk: knot post / note post / signpost are a crate with fence pieces on top / upright Prop_Support + one plank sign (S); report docs/test-repo~ | owner check only |
| OB-034 | Design walk: copy-stamped roadside clusters (same 5-piece cluster, same tree trio, same rotations) / re-roll yaw/scale per section in gen-roadside (S~ | owner check only |
| OB-033 | Design walk: only boars placed, none at Road West/Bend; rabbits/songbirds only at the edge of draw distance; 12 shared pool slots / wary boar groups ~ | owner check only |
| OB-032 | Design walk: birds/squirrels never use the ~250 placed roadside trees / add placed tree meshes to the wildEnv trunk grid (M); report docs/test-report~ | owner check only |
| OB-031 | Design walk: dusk has no outdoor light or smoke (Bend lamps unlit, relays/waystone dark, chimneys no smoke) / existing lanternHook light + smoke emit~ | owner check only |
| OB-030 | (from OB-027) closing the editor lost all unsaved changes / Add autosave of the open doc to browser storage every few seconds + a "restore unsaved ch~ | owner check only |
| OB-029 | Editor: be able to DELETE assets that are not needed / Asset browser in tools/editor: delete an asset (mesh/model) that nothing references; warn + li~ | owner check only |
| OB-028 | Editor: scene tree needs groups, and groups foldable / tools/editor scene tree panel. | owner check only |
| OB-026 | "What is that on the ground?" - a lighter striped rectangle on the dark stone floor (tower area) / Needs the debug position to identify (candidates: ~ | owner check only |
| OB-024 | "What is this?" - wooden arch frame with a roof, crow on top, near the crossroads / Rook's nest ruin (MAP-23, ~975,1058): Medieval-kit arches + half ~ | owner check only |
| OB-023 | Mushroom (big shelf fungus) lies in the middle of the road; should grow on a trunk / Red caps cap1..5 (MAP-25, Laetiporus scaled 2.2) placed on the e~ | owner check only |
| OB-022 | Dialogue: every short sentence needs its own E press - boring. Make lines shorter and GROUP consecutive lines of the same speaker into one box / Dial~ | owner check only |
| OB-021 | At 560x210 the text (settings menu) becomes blurry / UI layer at the top grid size: non-integer cell scaling / canvas resampling. | owner check only |
| OB-020 | Smoke north of the ford looks very bad (huge flat grey pillars) / The smokeColumn billboards (6x28 m sprites) removed at once; anchors kept. Proper s~ | owner check only |
| OB-018 | A wooden post + table-like structure floats in the air in the forest ("any purpose?") / Identified from the owner's debug pose (1264.25,1041.35,-30.9~ | owner check only |
| OB-016 | Walking west toward the river, 2 steps past a "beacon in the forest" (lamp-post structure among pines, river behind), teleported back to the tower. D~ | owner check only |
| OB-012 | Quick bar: sword in slot 1 / right hand; wants [L][R] mouse slots + 1-4 key slots, drag and drop / QB-6 redesign; browser check verify-quickbar PASS. | owner check only |
| OB-011 | Potion box next to the HP bar: REMOVE it; potions show their count in Items and are dragged into the quick bar, whose slot shows the count / Supersed~ | owner check only |
| OB-010 | T-posed woman next to Burl ("asked 6 times") / Synty `localHero` statue in git-ignored content/local/placements.json removed (backup in scratchpad) | owner check only |
| OB-009 | Stones at the tower foot still different from the tower / tower.level.json rock cells -> stone_moss / moss_top (TOWER-STONE-01) | owner check only |
| OB-008 | Lake "in the air" (flat water sheet above the river) / Glasswater bowl only under the water rect + shore shelf (LAKE-FIX) | owner check only |
| OB-007 | Editor looks different from the game / Editor now installs the geography (world_geo) like the game | owner check only |
| OB-006 | Resolution too big; max one step above ultra / Grid list capped at 560x210 (GRID-CAP) | owner check only |
| OB-005 | Game drops out: "uniform ring overflow" / "previous pass not ended" / Ring 4160 slots + failed frame dropped instead of fatal (FIX-RING); passes alwa~ | owner check only |
| OB-003 | J should list quest titles, open them, main vs side / QL-J + merged with QL-03 (Offered/Active/Done, T track, X abandon) | owner check only |

## Notes

- stills not taken: a step failed
