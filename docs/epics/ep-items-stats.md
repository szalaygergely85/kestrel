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

## PLAYER-LEVEL-01 proposal (PC-B PO, owner to OK the numbers) - SUPERSEDED BY v2 (D-116, section below)
Kept for history only; do not build. The weighted-average formula is replaced by the power score below.
Source: D-084 (level is derived, no XP, attributes from gear only), D-069 (fireball at level 5), ITEM-09 (req(iL) = 5 + floor(0.9 x (iL-1))), HPBAR-03 (Easy -1 / Hard +1).

**Story.** As a player, I want to see one "Level" number that rises as I find better gear and learn stronger spells, so that I know how ready I am for a zone without grinding XP.

**Pure function** `playerLevel(spells, equipped)` in `game/js/quest/playerLevel.js` (+ `playerLevel.test.js`), no globals, no alloc after load, no Math.random.
- Slot weights (9 slots, order as `equipment.js`): weapon 3, chest 2, shield 1.5, head 1, hands 1, legs 1, feet 1, ring 0.5, amulet 0.5 (sum 11.5). An empty slot counts as iL 1 (bare = level 1). Missing/unknown slot ids are ignored, never throw.
- `gear = sum(weight x iL) / 11.5` (range 1..10).
- `spellBonus = min(2, 0.25 x sum of tiers)`; `spells` = map spellId -> tier (0 = not learned, 1..3 learned/upgraded). Unknown ids count 0.
- `playerLevel = clamp(floor(gear + spellBonus + 0.5), 1, 10)`.
- Also export `gearLevel(equipped) = clamp(floor(gear + 0.5), 1, 10)` (spells excluded) for the fireball gate.
- Why: gear is the main path (weapon and chest matter most); spells add up to +2 so a mage who skips armour still climbs a little, but spells alone never carry you.

**Worked examples** (rounded half up):
1. Fresh start: sword iL1, rest empty, no spells -> gear 1.00 -> **Level 1**.
2. After the first chest (iL3 chest, iL1 sword, shield iL1): (3 + 6 + 1.5 + 1+1+1+1 + .5+.5)/11.5 = 1.35 -> **Level 1** (levels move slowly early; the gear card still shows the upgrade).
3. Mid Ch2 kit: sword 4, chest 4, shield 3, head/hands/legs/feet 3, no jewellery, fireball T1: gear 3.26 + 0.25 = 3.51 -> **Level 4**.
4. Full Magic iL5 kit (all 9 slots iL5), fireball T1 + two more spell tiers (sum 3): 5.00 + 0.75 = 5.75 -> **Level 6** (gearLevel 5, so the gate is met).
5. Endgame: all 9 slots iL9, spell tiers sum 8 (bonus capped 2): 9 + 2 = 11 -> clamp **Level 10**.

**Zones.** Bands unchanged (tower side 1-5, far side 5-10; no enemy scaling, D-078). Level is never a lock: the river stays open (D-095). The map/character view shows a plain hint for the zone you stand in: zone level >= playerLevel + 2 -> "Dangerous here" (red); within +-1 -> "Fair"; <= level - 2 -> "Easy".

**Enemy bar (HPBAR-03).** Shown level = clamp(beastLevel + diffShift, 1, 10), shift Easy -1 / Normal 0 / Hard +1 (matches the stat shift of that setting, so the number is honest). Name tint vs playerLevel: shown level <= level-3 grey, -2..-1 green, 0 white, +1..+2 yellow, >= +3 red.

**Item requirements (ITEM-09).** Gear is gated by attributes only (hard rule, D-091 / owner), NOT by player level; req(iL) = 5 + floor(0.9 x (iL-1)) (iL1 5, iL5 8, iL10 13). Player level is a readout of the gear, so a level gate on gear would be circular.

**D-069 fireball gate.** The fireball unlock checks `gearLevel(equipped) >= 5` (or the Burl story beat, 38.53, whichever the quest data names). It uses gearLevel, not playerLevel, because learning the fireball itself adds a spell bonus (no loop).

**Where it shows.** (a) Character view: big "Level N" in the header, small line "Gear X.X + Spells +Y.Y" so the player sees what raises it; (b) HUD: a small "Lv N" next to the hearts/mana, updates on equip/unequip/spell learn, with a brief flash when it goes up ("Level up! 4"). No XP bar anywhere.

**Acceptance criteria (Node-testable)**
- [ ] `playerLevel` is pure: same input -> same output, input objects not mutated, 0 allocations in a 10k-call loop after warm-up.
- [ ] The 5 worked examples above give 1 / 1 / 4 / 6 / 10 (fixtures in the test).
- [ ] Result is always an integer 1..10 for 10k random seeded kits (iL 0..12, tiers 0..5); empty equipment + no spells = 1; empty/undefined args never throw.
- [ ] Monotonic: raising any slot iL by 1 or any spell tier by 1 never lowers the level; spells alone (all gear empty, any tiers) reach at most level 2.
- [ ] Spell bonus capped: tier sum 8 and 80 give the same result.
- [ ] `gearLevel` ignores spells; a kit of all iL5 gives gearLevel 5; the D-069 gate test: sword+chest iL5 only (others empty) gives gearLevel 3 (gate closed), full iL5 kit opens it.
- [ ] Character view and HUD text come from the same function (golden strings "Level 4", "Gear 3.3 + Spells +0.3" for example 3); HUD value changes after equip, unequip and spell learn; no "XP" text anywhere.
- [ ] Enemy bar shown-level helper: Easy/Hard shift clamps at 1 and 10; tint bands match the table above.
- [ ] Zone hint function returns Dangerous / Fair / Easy per the thresholds above for levels 1..10 against bands 1..10.
- [ ] Save: level is NOT saved (always recomputed); old saves load unchanged.

Owner to OK: slot weights, spell bonus 0.25 per tier (cap 2), rounding, and "gate uses gear level only".

## PLAYER-LEVEL-01 v2: power score (D-116)
PC-B PO (opus), 2026-10-15. Replaces the proposal above. Sources: D-116 (Diablo-style power, bands "1000-2500 = level 2"),
D-084 (no XP; level derived from items + spells; attributes from gear only), D-078 3 (fixed zone levels, no enemy scaling),
D-115 + docs/epics/ep-spells.md (4 spells x levels 1-3), D-069 (fireball gate), D-091 / ITEM-09 (gear gated by attributes).

**Story.** As a player, I want every item and spell to show a Power number that adds up to my total Power and my Level,
so that I see at a glance how much stronger a find makes me and how ready I am for a zone, without XP.

### 1. Item power
```
itemPower = round10( 20 x iL^2  x  slotWeight  x  ( rarityFactor + 0.1 x sum over bonus lines of (1 + q) ) )
```
- **Base by item level** `20 x iL^2` (per weight point): iL1 20, iL2 80, iL3 180, iL4 320, iL5 500, iL6 720, iL7 980,
  iL8 1280, iL9 1620, iL10 2000. Quadratic on purpose: it is what makes the owner's "1000-2500 = level 2" band fit a full
  iL2 kit, and gives the Diablo feel of big jumps between item levels.
- **Slot weight** (the 11 `EQUIP_SLOTS`, sum 18): main 3, body 3, off 2, ranged 2, head 2, legs 2, hands 1, feet 1,
  cloak 1, belt 1, **quiver 0** (arrows are ammo, no power). Empty slot = 0.
- **Rarity factor** (same steps as the base-stat factor, section 2): Common 1.00, Magic 1.05, Rare 1.10, Epic 1.15,
  Unique 1.25.
- **Stat-line contribution**: each bonus line adds `0.1 x (1 + q)`, q = roll quality 0..1 =
  (value - rangeMin) / (rangeMax - rangeMin) at the item's iL (affix table A1..A15). So a line is worth +10 % (lowest roll)
  to +20 % (top roll) of the item's base power; average +15 %. Uniques: every fixed line counts q = 1 (+0.2) and the
  unique effect counts as one more line at q = 1 (+0.2).
- **round10** = nearest multiple of 10 (`Math.round(x / 10) x 10`), per item, so every number on screen is round.
- **Plain gear without an instance** (old ids before ITEM-02 migration, base sword/bow/shield) uses the section 5 map:
  worn = iL1 Common, sturdy = iL2 Magic, fine = iL4 Magic, tempered (Elite) = iL6 Rare, warden = iL8 Rare; bonus lines
  not yet rolled count q = 0.5.

Reference items: iL1 Common (worn) sword **60**; iL1 Common shield / bow **40**; iL2 Rare body **340**; iL4 Magic sword
**1,150**; iL5 Magic body **1,800**; iL5 Rare sword **2,100**; iL10 Epic body **9,600**; iL10 Unique weapon
(3 fixed lines + effect) **12,300**. (Deviation from the main-session hint "iL10 legendary ~1,500": a linear scale cannot
reach the owner's level-2 band with a full iL2 kit, and a 1,500 weapon would be ~3 % of an endgame kit; the quadratic
base keeps the weapon at ~20 % of any kit.)

### 2. Spell power
Per learned spell, by its level (total for that spell, not added per step): **level 1 = 250, level 2 = 600,
level 3 = 1,000**; level 0 = 0. Four spells at level 3 = **4,000** max. Levels above 3 clamp to 3; unknown ids count 0.
Spells alone reach at most level 3 (they help early, ~10-15 % of a kit, and never carry an under-geared player).

### 3. Total power and level bands
`totalPower = sum of itemPower over worn slots + spellPower`; `level = band(totalPower)`:

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Power | 0-999 | 1,000-2,499 | 2,500-4,999 | 5,000-7,999 | 8,000-11,999 | 12,000-16,999 | 17,000-21,999 | 22,000-27,999 | 28,000-34,999 | 35,000+ |

**Balance check** (no spells, every line q = 0.5): a full kit of iL N weighs 18 points, so a Common kit = 360 x N^2 and
a Magic kit = 432 x N^2. Every band start sits between "Magic kit of iL N-1" and "Common kit of iL N", so a full matching
Common or Magic kit lands **exactly on level N** for N = 1..10 (tightest edges: Magic iL9 34,992 < 35,000 <= Common
iL10 36,000; Magic iL5 10,800 < 12,000 <= Common iL6 12,960). A full Rare kit (504 x N^2) is level N or N+1; spells add
up to +4,000, which is worth about +1 level early and a fraction late.

**Example kits** (q = 0.5 on rolled lines):

| # | Kit | Items | Spells | Total | Level |
|---|---|---|---|---|---|
| 1 | Fresh start: worn sword 60 + bow 40 + shield 40, no spells | 140 | 0 | **140** | **1** |
| 2 | First chest: kit 1 + iL2 Rare body 340 + iL1 Magic head 50 + iL1 Common feet 20; Fireball L1 | 550 | 250 | **800** | **1** (early levels move slowly; the card still shows "Power +340") |
| 3 | Mid chapter 2: sword iL4 Magic 1,150, body iL4 Magic 1,150, shield iL3 Magic 430, bow iL3 Common 360, head + legs iL3 Magic 430 each, hands iL3 Common 180, feet iL3 Magic 220, cloak iL2 Magic 100, no belt; Fireball L2 + Freeze L1 | 4,450 | 850 | **5,300** | **4** |
| 4a | Full iL5 Magic kit (10 slots: 1,800 / 1,200 / 600 per weight 3 / 2 / 1); Fireball, Freeze, Telekinesis L1 | 10,800 | 750 | **11,550** | **5** |
| 4b | Kit 4a with sword + body swapped for iL5 Rare (2,100 each) - "a few rares" | 11,400 | 750 | **12,150** | **6** |
| 5 | Endgame: iL10 Unique weapon 12,300, Epic body 9,600, Rare off / ranged / head / legs 5,600 each, Rare hands / feet / cloak / belt 2,800 each; all 4 spells L3 | 55,500 | 4,000 | **59,500** | **10** |

### 4. Where it shows
- **Item card** (ITEM-07 mock-up): one line under the slot line, `Power 1,800` (white, thousands comma). Compare block
  adds `Power +350` (green) / `Power -120` (red) / `Power same` (grey) vs the worn item of that slot (empty slot = all green).
- **Character view** header: `Power 5,300 - Level 4`, under it a small grey line `Items 4,450 + Spells 850` and
  `Next level at 8,000` (level 10: `Max level`). Spell page cards show `Power 600` for the spell's current level.
- **HUD**: small `Lv 4` next to hearts/mana; updates on equip, unequip, spell learn, Spell Scroll; on a rise it flashes
  `Level up! 5` for 2 s. No XP bar and no "XP" text anywhere. Level and power are never saved (always recomputed).

### 5. What reads it
- **Enemy health bars (HPBAR-03)**: unchanged rule from v1 - shown level = clamp(beastLevel + diffShift, 1, 10)
  (Easy -1 / Normal 0 / Hard +1); name tint vs player level: <= -3 grey, -2..-1 green, 0 white, +1..+2 yellow, >= +3 red.
- **Zone hint** (map + character view, zone you stand in): zone level >= level + 2 "Dangerous here" (red); within +-1
  "Fair"; <= level - 2 "Easy". Never a lock (D-095 river stays open), zones never scale (D-078).
- **ITEM-09 requirements**: gear stays gated by attributes only (req(iL) = 5 + floor(0.9 x (iL - 1))), never by power or
  level - power is a readout of the gear, a power gate on gear would be circular.
- **D-069 fireball gate**: uses **item power only** (spells excluded, so learning a spell cannot open its own gate):
  `itemLevel(equipped) = band(sum of itemPower) >= 5`, i.e. item power >= 8,000, or the Burl story beat (38.53),
  whichever the quest data names. Kit 3 (4,450) is closed; kit 4a (10,800) is open; a full iL4 Magic kit (6,900)
  plus all spells at L3 stays closed.

### 6. Code shape (game/js/quest, engine-free)
`game/js/quest/sim/power.js` (+ `power.test.js`), pure, no globals, no Math.random, 0 alloc per call after load:
`itemPower(itemOrId, defs)`, `spellPower(tiers)`, `levelFromPower(p)`, `itemPowerTotal(equipped, defs)`,
`playerPower(spells, equipped, defs)`, `playerLevel(spells, equipped, defs)` (= levelFromPower(playerPower)),
`itemLevel(equipped, defs)` (gate), `formatPower(n)` ("5,300"). Tables (base, weights, rarity factors, spell powers,
band starts) live in `statsConfig.js` next to the affix table. SPELL-R8 calls `playerLevel(spellBook.tiers(), equipped, defs)`.

### 7. Acceptance criteria (Node-testable)
- [ ] AC1 `itemPower` goldens: iL1 Common sword 60; iL1 Common shield 40; iL2 Rare body (2 lines q 0.5) 340; iL5 Magic
  body 1,800; iL10 Unique weapon (3 fixed lines + effect) 12,300; quiver item 0; null/empty slot 0; every result is a
  multiple of 10; old ids worn / sturdy / fine / tempered / warden map to iL1 C / iL2 M / iL4 M / iL6 R / iL8 R.
- [ ] AC2 `levelFromPower` band edges: 0 -> 1, 999 -> 1, 1,000 -> 2, 2,499 -> 2, 2,500 -> 3, 4,999 -> 3, 5,000 -> 4,
  7,999 -> 4, 8,000 -> 5, 11,999 -> 5, 12,000 -> 6, 16,999 -> 6, 17,000 -> 7, 21,999 -> 7, 22,000 -> 8, 27,999 -> 8,
  28,000 -> 9, 34,999 -> 9, 35,000 -> 10, 10,000,000 -> 10; negative, NaN, undefined -> 1.
- [ ] AC3 The 6 example kits of section 3 (fixtures in the test) give exactly the Items / Spells / Total / Level columns:
  140/1, 800/1, 5,300/4, 11,550/5, 12,150/6, 59,500/10.
- [ ] AC4 Balance sweep: for N = 1..10 a full Common kit and a full Magic kit of iL N (q 0.5, no spells) give level N;
  a full Rare kit gives N or N+1, never more; an Epic kit never more than N+2 (cap 10).
- [ ] AC5 `spellPower`: one spell L1 / L2 / L3 = 250 / 600 / 1,000; four spells L3 = 4,000; levels 4..9 clamp to the
  L3 value; unknown ids and level 0 count 0; spells only (all slots empty) give at most level 3.
- [ ] AC6 Pure and safe: 10k seeded random kits (iL 0..12, any rarity, q 0..1, spell levels 0..5) always give an integer
  level 1..10; inputs are not mutated; 0 allocations in a 10k-call loop after warm-up; empty / undefined args never throw;
  monotonic - raising any iL, rarity step, line q or spell level never lowers power or level.
- [ ] AC7 Gate: `itemLevel` ignores spells; full iL5 Magic kit -> 5 (gate open); kit 3 -> closed; full iL4 Magic kit +
  all 4 spells L3 -> `playerLevel` 5 but `itemLevel` 4 (gate closed).
- [ ] AC8 Text goldens from the same functions: item card `Power 1,800`, compare `Power +350` / `Power -120` /
  `Power same`; character view `Power 5,300 - Level 4`, `Items 4,450 + Spells 850`, `Next level at 8,000`, level 10
  `Max level`; HUD `Lv 4` and `Level up! 5`; enemy-tint and zone-hint helpers match section 5 for levels 1..10 vs 1..10;
  no string contains "XP"; save files hold no level or power field.

Owner to OK: the base `20 x iL^2`, slot weights (main/body 3, off/ranged/head/legs 2, rest 1, quiver 0), spell power
250 / 600 / 1,000, and the band table. Note: SPELL-R8 AC3 ("4 spells = +1.0, cap at tier sum 8") is v1 wording and must
read "4 spells L1 = +1,000 power; L3 values clamp" once v2 is OK'd.
