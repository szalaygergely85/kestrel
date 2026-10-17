# M5 sprint 2 - "EP-EQUIP 2" (draft)

(PC-B PO sonnet, 2026-10-11; manager to ratify.) Rows + ACs in `docs/pc-b-queue.md` `## M5 sprint 2 (draft)`. Builds on EQ-01 (gear data), US-129a (band -> gear tier), M5 sprint 1 (Outwall, wolves).

**Goal:** gear worth crossing the river for - sturdy/fine weapons, tier 4-5 armour, and nothing lost when the pack is full.

Rules applied: no new art (existing meshes/voxels recoloured with existing materials); all names `NEEDS WRITER:` placeholders, owner approves; magic off (D-065).

| id | topic | files (no sharing) | ends |
|---|---|---|---|
| EQ-20 | Sword/bow/shield sturdy + fine | new design/itemsWeapons.js, content/loot/weapons.json | po-review |
| EQ-21 | Armour tiers 4-5 (`tempered`, `warden`) + band mapping | design/items.js, band.js, loot.js | po-review |
| EQ-22 | Tier look on Wick + icons | BLOCKED on owner | blocked |
| EQ-23 | Leftover drop when inventory is full | pickups.js (+ one main.js line to kestrel-1) | po-review |

Order: EQ-21 first (owns items.js/loot.js; EQ-20 then adds its single registration line), EQ-23 independent.

## Owner questions
1. Tier look (EQ-22): A realistic material shades (PO default, small tier pip on icons) or B per-tier colours?
2. Approve the placeholder tier names (`tempered`, `warden`) and weapon names via the writer.
