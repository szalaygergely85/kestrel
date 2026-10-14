# EP-ITEMS-STATS - classic RPG item stats (D-081, OB-151, OB-150, OB-152, OB-064)

Status: **owner answered section 8 on 2026-10-14 (D-091)**; ITEM-08 tonics dropped, attribute requirements + damage-number setting to add (PO). (D-081) PO, 2026-10-14 (+ owner input same day: item types,
rarity colours, rarity = number of bonus lines, concrete affix list, card mock-up).
Replaces the fixed tier table (itemsWeapons.js `STATS` dmgMul/drawMul/blockStamMul, equip.def 1-5, band.js
`gearItemTier`, lootConfig `LOOT_TIERS`). Keeps: no XP / no player level (D-020, D-078 3), zone levels (near side 1-5,
far side 5-10, band.js), voxel items (D-078 1), plain names, gear goes straight into the pack (OB-064).

## 1. Stat model
Today: player 30 HP, beast hit 5, boar 4 HP, sword 1 / heavy x3, fireball 3/5, DEF 3 %/pt cap 60 % - too small to show
rolls, and a boar dies in 4 taps (OB-150). **All numbers rescale x~10** ("Damage 12-18").

| Attribute | Base | Per point | Cap |
|---|---|---|---|
| **STR** | 5 | +2 % sword/axe/spear damage; -1 % stamina per shield block | block -40 % |
| **DEX** | 5 | +2 % bow damage; +1 % draw speed; +0.2 % crit chance (all attacks) | draw +50 % |
| **INT** | 5 | +3 % fireball damage; +2 max mana; +1 % mana regen | - |

- **Damage** = uniform roll in [min, max] of the weapon x (1 + attribute %) x (1 + "+% damage" affixes). Heavy swing
  keeps x3, bow keeps its draw factor. Fireball has its own min-max (tap 25-35, charged 45-60) scaled by INT.
- **Crit**: base 5 % chance, x1.5 damage; affixes add both. Chance cap 50 %. Crit = yellow flash + existing hit cue.
- **Armour** (all worn pieces + shield): reduction = A / (A + 40 + 20 x L), L = attacker level, **cap 60 %**.
  Matching gear ~25-30 %, over-geared ~45 %.
- **Health / mana**: base 100 HP, 100 mana; flat gear affixes add more. No carry weight (slot pack).
- **Growth without XP**: gear (main path) + proposal "Tonics" (Q1): ~10 permanent +1 STR/DEX/INT rewards from main
  quest steps, camp chiefs, bosses. Spell tiers stay as in D-078 3.
- Rule 15: all rolls use the seeded loot stream, no Math.random in sim, 0 alloc per combat step.

## 2. Item types, rarity, affixes
**Types** (design/itemBases.js, data only; plain names per item-level step iL 1-3 / 4-6 / 7-10, NEEDS WRITER, <= 14 chars):

| Type | Slot | Base stats (iL = item level 1-10) | Feel |
|---|---|---|---|
| Sword | main | dmg (4+2 iL)-(7+3 iL) (iL1 6-10, iL10 24-37) | today's swing |
| Axe | main | dmg x1.25, swing 15 % slower, +10 % crit damage (built in) | heavy hitter |
| Spear | main | dmg x0.9, reach +0.6 m, 10 % faster | keeps distance |
| Bow | ranged | dmg x0.9 of sword, draw speed 100 % | today's bow |
| Shield | off | armour 2 x (2+iL), block stamina -10 % | |
| Armour | head/body/cloak/hands/belt/legs/feet | armour (2+iL) x weight (body 3, head/legs 2, rest 1) | |

Axe and spear need new held voxel models + swing clips (designer, ITEM-D1); everything else reuses today's models.
**Item level (iL)** = zone band at the source (band.js `bandAt`); chest reward = band + 1 (max 10).

**Rarity** = name colour + card frame + number of bonus lines (palette keys only, no new hex):

| Rarity | Colour | Bonus lines | Base stats |
|---|---|---|---|
| Common | white | 0 | x1.00 |
| Magic | blue | 1 | x1.05 |
| Rare | yellow | 2 | x1.10 |
| Epic | purple | 3 | x1.15 |
| Unique | orange | fixed lines + 1 unique effect | hand-made (River Boots etc.) |

**Affix pool** (one roll each, no duplicates on an item; value = uniform roll in the range at the item's iL):

| # | Bonus line | Range iL1 | Range iL10 | On |
|---|---|---|---|---|
| A1 | +% damage | 5-10 % | 25-40 % | weapons |
| A2 | +flat damage | +1-3 | +8-14 | weapons |
| A3 | +% crit chance | 1-2 % | 4-6 % | weapons, hands, head |
| A4 | +% crit damage | 10-15 % | 30-50 % | weapons, hands |
| A5 | +% attack speed | 3-5 % | 10-15 % | weapons, hands |
| A6 | +armour | +2-4 | +20-35 | armour, shield |
| A7 | +% armour | 5-10 % | 20-30 % | armour, shield |
| A8 | +STR | +1-2 | +6-9 | all |
| A9 | +DEX | +1-2 | +6-9 | all |
| A10 | +INT | +1-2 | +6-9 | all |
| A11 | +max health | +5-10 | +40-60 | armour, shield, belt |
| A12 | +max mana | +5-10 | +30-50 | armour, cloak |
| A13 | life on hit | +1 | +4-6 | weapons |
| A14 | +% move speed | 3-5 % | 8-10 % | feet only, cap 15 % total |
| A15 | +% block (less stamina per block) | 5-8 % | 15-20 % | shield |

Ranges in between are linear in iL (statsConfig.js table). Unique effects are hand-written (e.g. River Boots: no
slow in water); uniques never roll.

**Item card mock-up** (pack hover / item-get card; frame + name in rarity colour, bonus lines in blue, compare green/red/grey):
```
+--------------------------------+
| Iron Axe              [Rare]   |   <- name + frame yellow
| Main hand  -  Level 5          |
| Damage 17-27   (avg 22)        |   <- white, base stats
| Crit damage +10 %              |   <- white, axe built-in
| +18 % damage                   |   <- blue bonus line 1
| +4 STR                         |   <- blue bonus line 2
|--------------------------------|
| vs worn Sword (Magic, Lv 4)    |
| Avg damage +7                  |   <- green
| Crit chance -2 %               |   <- red (worn has it, this lacks it)
| STR +4                         |   <- green
| Swing speed -15 %              |   <- red
+--------------------------------+
```

## 3. Loot rolls
| Source | Gear drop | Notes |
|---|---|---|
| boar | 5 % | meat stays fixed |
| wolf | 8 % | |
| goblin melee / thrower | 15 % | trinket, arrows stay |
| goblin torch-bearer / camp chief | 100 % | rarity +1 step |
| black bear | 30 % | rarity +1 step |
| chest (camp clear, quest, Waystone region quest, boss) | 100 %, 1-2 items | min Rare, iL band+1 |

Rarity weights C/M/R/E: **near side (band 1-4)** 70/24/5/1; **far side (band 5-10)** 50/32/14/4; Unique only from
quests/bosses. Type pick: weapons 30 % (sword/axe/spear/bow/shield even), armour 70 % (even per slot).
**Chests are earned (OB-152):** no free-standing loot chests; existing loose ones become camp/quest/boss chests or go
(list in ITEM-06). Loot goes straight into the pack (OB-064); pack full = stays on corpse/chest + "Pack full" line.

## 4. UI
- Item card as mocked above for every gear item; compare against the worn item of that slot, **every slot**, one line
  per stat (green + / red - / grey same); empty slot = all green. Weapon compare includes average damage per hit.
- Character panel (under Wick, C/I screen): HP, Mana, STR, DEX, INT, Armour (-x %), main-hand dmg min-max, bow dmg
  min-max, Crit x % / x %, attack + move speed. Replaces "DEF n / DMG x1.5". No "Esc to close" text.
- Floating hit numbers: proposal only (Q5).

## 5. Save / migration
- Rolled items need **instances**: slot = `{id: base id, n: 1, it: {iL, r, a: [[affix, value], ...]}}`; stackables and
  uniques stay plain. Shape + save version bump = **ARCH-NOTE NEEDED** (inventory.js, equipment.js, save; game/ only).
- Old ids `gear.<slot>.<base>.<tier>` migrate once: worn -> iL1 Common, sturdy -> iL2 Magic, fine -> iL4 Magic,
  tempered -> iL6 Rare, warden -> iL8 Rare; bonus lines rolled from seed = hash(save id, slot index) (same save ->
  same items). Base sword/bow/shield -> iL1 Common. Old defs stay registered read-only for one release.

## 6. Balance targets (OB-150 "too easy")
Matching gear (iL = zone level, Magic, base attributes), sword light swings ~0.6 s apart:

| Enemy | hits to kill | time to kill | its hits to kill the player |
|---|---|---|---|
| boar | 4 | ~2.5 s | 9 |
| wolf (pack of 3) | 4 each | ~8 s pack | 7 each |
| goblin melee | 5 | ~3 s | 7 |
| goblin thrower | 3 | ~2 s | 10 (spear, blockable) |
| black bear | 10 | ~6 s | 4 |

- Enemy HP(L) = hitsToKill x avgSwordHit(L) x 1.15; enemy hit(L) = 130 / hitsToDie x (1 + 0.12 (L-1)).
- One zone under-geared ~ +30 % hits taken / -25 % damage dealt; 3+ levels under must be deadly (bear L8 vs iL5: < 3 hits).
- Potions (OB-113) and Waystone heal stay.

## 7. Stories (each <= 1 programmer-day; game/ + design/ only, engine-free)
| ID | Slot | Files | Node ACs | Deps |
|---|---|---|---|---|
| ITEM-01 stat model | kestrel-3 | new `sim/stats.js`, `sim/statsConfig.js` (+affix table) + test | totals from an equipment object; 10k seeded rolls mean within 2 %; crit rate within 1 %; DR exact at 5 points, never > 60 %; move speed cap 15 %; 0 alloc per `rollHit` | owner OK |
| ITEM-02 item instances + save | kestrel-1 | `sim/inventory.js`, `sim/equipment.js`, save hook | ARCH-NOTE first; instance save round trip; stackables unchanged; golden migration list for every old id; stale save never throws | ITEM-01 |
| ITEM-03 generator | kestrel-4 | new `design/itemBases.js`, `sim/itemGen.js` + test | 10k rolls per iL: base values + bonus values in range, bonus count == rarity, no duplicate, affix only on allowed slots; same seed -> same item; uniques unchanged; names <= 14 chars | ITEM-01 |
| ITEM-04 combat wiring | kestrel-3 | `sim/sword.js`, `sim/arrows.js`, `sim/fireball.js`, vitals, retire `weaponStats.js` | rolled damage + crit + life on hit + attack speed; armour DR by attacker level; axe/spear reach + speed; existing suites pass with new numbers; 0 alloc per step | 01, 02 |
| ITEM-05 enemy rescale + balance sim | kestrel-4 | `beastConfig.js`, `vitalsConfig.js`, `band.js` mult, wolf/goblin/bear config, new `sim/balance.test.js` | duel sim at L1/3/5/8/10 per enemy: hits-to-kill / hits-to-die within +-20 % of section 6; under-geared case holds | 01, 04 |
| ITEM-06 loot rolls + chests | kestrel-4 | `lootConfig.js`, `loot.js`, merge `weaponLoot.js`, chest placements | 100k seeded kills: drop rate within 0.5 pp, rarity weights within 1 pp per side; chest min Rare; into pack (OB-064), pack full stays on corpse; converted/removed chest list | 03 |
| ITEM-07 item card + compare | kestrel-1 | `inventoryScreen.js`, `game/js/ui/itemGetCard.js` + tests | golden text for Common/Magic/Rare/Unique fixtures matching the mock-up; per-stat green/red/grey for every slot incl. empty; rarity colours from palette keys; no "Esc" text | 02, 03 |
| ITEM-08 character panel + tonics | kestrel-1 | `inventoryScreen.js` stats block, tonic defs | panel equals `stats.js` totals for 3 fixtures; tonic +1 attribute, saved, max 10 (if Q1 yes) | 07 |
| ITEM-D1 axe + spear + icons | designer | `design/models` axe/spear held voxels + swing clips, icons per type x 3 iL looks, rarity frames, preview html | owner preview check | owner OK |

Order: 01 -> (02, 03) -> 04 -> (05, 06, 07) -> 08; D1 alongside (axe/spear drop only after D1 lands).

## 8. Owner questions
1. Growth without XP: gear only, or also ~10 permanent +1 STR/DEX/INT Tonics from quests/chiefs/bosses? **Owner: gear only (no Tonics).**
2. OK to rescale all numbers x~10 (player 100 HP, level-1 sword "6-10", boar ~35 HP)? **Owner: OK.**
3. Rarity names/colours Common white / Magic blue / Rare yellow / Epic purple / Unique orange - OK? **Owner: OK.**
4. Should gear need attributes (e.g. Steel Bow needs DEX 12), or do attributes only boost? **Owner: yes, gear needs attributes.**
5. Floating damage numbers over enemies (crits in yellow) - want them? **Owner: yes, with a Settings switch to turn them off.**

## 9. PLAYER-LEVEL-01 - derived player level (D-084, owner OK needed)
PO, 2026-10-14. No XP (D-078). The level is computed, never earned, and shown in the character view / HUD and used by one gate (D-069 fireball).

**Story.** As a player, I want to see one level number that grows when I find better gear and learn stronger spells, so that I know how ready I am for the next zone (and for the beast level on the enemy health bar, D-093).

**Formula (proposal, all numbers in `game/js/quest/playerLevelConfig.js`):**
- `G` = gear score = mean item level (iL 1-10) of the **5 highest equipped items**; fewer than 5 equipped = missing ones count 0. Only EQUIPPED items count (D-096: an item you cannot equip adds nothing).
- `S` = sum of unlocked spell tiers (Fireball tier 1-3, further spells later); `T` = 10 x min(S, 6) / 6.
- `Level = clamp(round(1 + 0.8 x G + 0.2 x T), 1, 10)`.
- Pure function `playerLevel(spells, equipped)`; same input = same output; 0 alloc; no attributes involved.

**Worked examples**
| Case | Equipped | Spells | G | T | Level |
|---|---|---|---|---|---|
| 1. Start | wooden sword iL1 + shield iL1 | none | 0.4 | 0 | 1 + 0.32 -> **1** |
| 2. End of near side (zone 1-5), the Burl fireball beat | sword, bow, shield, body, head all iL5 | Fireball tier 1 (S=1) | 5.0 | 1.67 | 1 + 4.0 + 0.33 = 5.33 -> **5** |
| 3. Far side | five pieces iL8 | Fireball tier 3 (S=3) | 8.0 | 5.0 | 1 + 6.4 + 1.0 = 8.4 -> **8** |
| 3b. Gear-rich, spell-poor | five pieces iL9 | none | 9.0 | 0 | 1 + 7.2 = 8.2 -> **8** |
| 3c. Spell-rich, gear-poor | five pieces iL1 | S=6 | 1.0 | 10 | 1 + 0.8 + 2 = 3.8 -> **4** |
Max (five iL10 + S 6) = 11 -> clamped **10**.

**Interaction with D-096 (hard attribute requirements)**
- Level never grants attributes and never gates equipping. Equipping is decided only by STR/DEX/INT (base 5 + gear bonus lines, D-091).
- A high-iL item you cannot equip yet counts 0 until you can; so the level cannot be inflated by carrying gear. Taking off a piece lowers the level at once.
- Gates read the level once, at the grant beat: the D-069 Burl fireball beat checks `Level >= 5` when you talk to Burl; once the spell is granted, the flag is saved and never re-locked if you later swap gear.
- Attribute requirements of near-side gear must be reachable from the zone below (D-091 4) - the formula assumes a normal path reaches iL5 kit by the end of the near side.

**Acceptance criteria (for the programmer row):**
- [ ] `playerLevel` returns the 5 table results above for those fixtures and 10 for the max fixture; never < 1 or > 10.
- [ ] Unequipped / unequippable items (D-096) do not count; fixture with an unmet requirement gives the lower level.
- [ ] Changing any config weight changes the result (data-driven, no magic numbers in code).
- [ ] Character view and HUD show "Level N"; updates on equip/unequip and spell unlock; no XP bar anywhere.
- [ ] The Burl fireball beat reads it (Level 5) and stays granted after un-equipping; saved flag test.
- [ ] 0 alloc per call (10k calls, heap flat).

**Owner questions**
1. Formula weights 0.8 gear / 0.2 spells and the "top 5 items" rule: OK, or should every slot count?
2. Max level 10 (matches zone bands 1-5 / 5-10): OK?
3. Fireball gate stays "Level 5 at the beat, then granted for good": OK?
