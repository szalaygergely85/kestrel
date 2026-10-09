# EP-WORLD-VALLEY - the closed valley (manager, 2026-10-09, D-052)

**Goal:** the whole alpha is one closed, readable valley: the player starts in a meadow on the near side, grows through better gear and spells in the level 1-5 zones (hillside, forest), earns the second bridge and fights the level 5-10 zones on the far side (zone/beast levels only, no player level), and never sees an invisible wall or a horizon sprite.

## Layout
- **Borders:** east (Ferrum side) = river, then a rock wall; one side = sea (shore + surf, no swimming out); two sides = mountains (steep, unclimbable above a slope limit, collider-backed). No pass or door to a "part 2".
- **Big river** through the middle (placed water + banks, not swimmable across at the bridges' reach; exact crossing rule follows the bridge rule).
- **Near side, levels 1-5:** start meadow (around the tower), hillside, pine/oak forest with flower-field glades.
- **Far side, levels 5-10:** open fields, rocky foothills up to the mountains.
- **Two bridges** (placed meshes with colliders): bridge A open from the start; bridge B locked / guarded / broken until earned.
- **Ferrum:** no horizon billboard (removed 78b9e91). May return later as a bounded, designed view (e.g. seen across the east river from one vantage), its own story.

## Biomes
| Biome | Side / levels | Ground + cover | Set pieces / meshes | Beasts (fixed level) | Ambient |
|---|---|---|---|---|---|
| Start meadow | near, 1-2 | turf, short grass, clover, pebbles | tower hill, waystone, path stones | boar (weak) | butterflies, pollen |
| Hillside | near, 2-3 | turf + rock patches | rocks, dead trees, ruins | boar, wolves (pair) | wind grass |
| Pine/oak forest | near, 3-5 | moss, ferns, needles, mushrooms | ALPHA-01f leafy trees, logs, stumps | wolves, boar | leaf fall, light shafts |
| Flower glade (in forest) | near, 3-5 | flower fields, tall grass | hand-placed showcase first, generated later | none / rare | petals, fireflies at dusk |
| River banks / sea shore | both | sand, reeds, pebbles | bridges, rocks, driftwood | shore beast (later) | spray, mist |
| Open fields | far, 5-7 | tall grass, wheat-like cover | lone trees, ruins | stronger pack / bull-type | wind waves |
| Rocky foothills | far, 7-10 | scree, rock, sparse grass | big rocks, cliffs, cave mouths (later) | strongest beasts | dust, wind |

## Slices (in order)
| # | Slice | Lane | Size | Contents / gate |
|---|---|---|---|---|
| 1 | River + bridges + borders terrain | PC-A designer (recipe + layout sheet) -> B1 (terrain recipe/colliders, engine side) + C (content placement) | ~2-3 d | Terrain recipe: river channel + banks, rock wall east, sea shore, mountain ring with slope limit; bridges as placed meshes with colliders; no fall-out anywhere (route-walk border legs). Owner look from the tower summit. |
| 2 | ALPHA-01f + QUAT-GROUND-01 | B2 (ALPHA-01f a-d, WebGPU only) -> C (QUAT-GROUND-01 scatter tables) | ~3 d + ~1 d | Masked instanced leafy trees per D-051; ground-cover scatter by ground type; owner LOD1 pick + forest triangle budget on forestWalk first. |
| 3 | Biome map + forest + one flower glade showcase | PC-A designer (forest + glade look sheets, owner-approved BEFORE placement) -> B1 (biome map layer in world data, read by scatter) -> C (editor paint brush, content) | ~3 d | Editor-paintable biome layer drives scatter/trees; one hand-placed glade as the showcase shot. |
| 4 | Far-side fields + foothills | PC-A designer (look sheets) -> C (content, scatter tables, beast spawns) | ~2-3 d | Uses slices 1-3 tooling only; per-biome beasts + ambient particles. |
| 5 | Item tiers + spell tiers + beast level badge (owner-decided, D-052 item 3: no XP, no player level) | PC-A PO (ACs) + designer (item + spell tier art, badge/tier colours) -> C: tier data in `design/items.js` + crafting recipes (~0.5 d), spell upgrade sim (~0.75 d); HUD badge via the gameHooks seam (C, ~0.5 d) | ~2 d | Tiered weapons/armour/shields (found, crafted, bought); spell tiers unlocked by quests/chests/bosses; fixed beast level per zone shown as a health-bar badge or tier colour; no enemy scaling; save fields for tiers. |

Rules: every new mesh pack -> `docs/licences.md` + `THIRD_PARTY_NOTICES.md` entry first; imports keep MESH-SIMP-01 budgets, UVMAP materials and proxy colliders; no owner-art reshaping (preview options first).

## Open questions for the owner
1. **Bridge B rule:** locked (key/quest), guarded (beat a level-5 beast), or broken (repair with crafted parts)? Manager lean: broken + repaired via a quest at level 5 (teaches crafting, no invisible gate).
2. **Far-side depth:** how big is the far side vs the near side (manager lean: about equal area, ~10-15 min walk across the valley)?
3. **How are spells upgraded?** (scrolls in chests / shrines-altars / boss drops / NPC) - owner leaning towards shrines.
4. Can the river be swum or waded anywhere, or only crossed at bridges? **ANSWERED (owner 2026-10-09): no hard wall. The far side is reachable, it is just guarded by stronger beasts; only a quest sends you there once your item level is enough. Gear tier is the gate, not a lock.**

## Owner approvals 2026-10-09
- `design/levels/valley_layout.md` APPROVED (river widening, bridge placement) - slice 1 may start (PBF-K3-01/02, then content by lane C).
- Wade defaults APPROVED as config defaults (speed x0.4, ford x0.7, 0.6 m/s south current; retune after owner tries it) - PBF-K3-03.
- Beast level badge "Lv N" with tier colours APPROVED - PBF-K1-03.
Still open: bridge B rule, spell upgrades, AREAS-01 breach trigger.
