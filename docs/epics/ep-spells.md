# EP-SPELLS - Spell tree (PC-B PO, 2026-10-15; owner to OK)

Source: owner 2026-10-15 "Not fireball, a random choosen one, you can add a spelltree" (D-114 amended) and the **owner correction the same day: Spell Scrolls are NOT random - the player CHOOSES which learned spell to upgrade, one spell per scroll.** (The D-114 amendment line in docs/decisions.md still says "randomly chosen"; the main session should correct it to "player-chosen".)
Reads: D-069 (Burl gives the fireball, gate = gearLevel, 38.53), D-078 (no XP; spells tiers are a progression path), D-084 (level = spells + items), D-114, ep-items-stats.md "PLAYER-LEVEL-01 proposal" (spell bonus = min(2, 0.25 x sum of tiers)), GDD section 3 (Aether = magic of light; "every spell is a light verb"; Spark stuns; Gust, Ward named as later spells; beasts fear waystone light; upgrades are found or earned, never bought).

## 1. Rules
- **No XP, no random upgrades.** Every spell is learned from a fixed, placed source and every upgrade is a player choice.
- **7 spells, 3 branches, max level 3 each** (tier 0 = not learned, 1..3). Tier sum max 21.
- **Learn = Spell Book** (one per spell, plain name "<Spell> Spell Book", e.g. "Gust Spell Book"), or a character's quest reward, or a Waystone wake. Reading it teaches the spell at level 1 at once (item-get card "New spell: Gust"). Burl's Fireball stays the first spell (D-069, unchanged).
- **Upgrade = Spell Scroll** (plain name "Spell Scroll", item id `scroll.spell`, stacks, max 9). Found only in earned places (guarded chests, dungeon ends, bosses, quest hand-ins). The scroll goes into the bag; the player spends it on the spell page by choosing ONE learned spell below level 3 -> that spell +1 level. Confirm line: "Raise Fireball to level 2?  [E] Yes  [Q] No". If no learned spell can rise (none learned, or all at 3), the scroll stays in the bag and the page says "No spell can learn from this yet."
- **The tree is a guide, not a lock.** Each branch has a root (listed first). Content places the root before the others, but a book read out of order still teaches its spell (no lost items, no dead ends).
- **INT** keeps its D-081 role: +3 % spell damage per INT point above 5 (today `fireDmgPct`, renamed to apply to all damage spells), +2 max mana and +1 % mana regen per point.
- **Mana:** today max 20, +1 per 2 s, 3 s pause after a cast. See owner question Q3.
- Effects use only what exists: fireball projectile + burst (`sim/fireball.js`), point lights (lighting.js), particles.js, beast stagger (`staggerSec`, knockback), shield/vitals damage hooks, the player jump impulse. No new art beyond glyph + colour; no new environment meshes.

## 2. The tree

Colours: Fire = existing ember orange/red; Light = aether teal (GDD 6, reserved for magic); Wind = pale grey-green (white `~`).

### Fire (damage)
| Spell | Lv1 | Lv2 | Lv3 |
|---|---|---|---|
| **Fireball** (root, today's sim) - tap: fast ball; hold 0.6 s: charged ball. Cooldown 0.5 s. | tap 5 mp dmg 3 r2.0; charged 10 mp dmg 5 r3.0 (= today) | tap dmg 4; charged dmg 7, r3.5 | tap dmg 5; charged 9 mp, dmg 9, r4.0 |
| **Fire Ring** - a burst centred on Wick (re-uses the fireball burst at the player, player takes no damage or knock), ring of `*` particles, 0.3 s orange flash light r6. | 8 mp, r3.0, dmg 4, knock 8 m/s, cd 4 s | 8 mp, r3.5, dmg 6, cd 3.5 s | 7 mp, r4.0, dmg 8, knock 10, cd 3 s |

### Light (control + safety)
| Spell | Lv1 | Lv2 | Lv3 |
|---|---|---|---|
| **Spark** (root; GDD's "Spark stuns") - straight teal bolt `+`, speed 30 m/s, range 20 m, first beast hit is staggered (existing stagger state). | 4 mp, dmg 1, stun 0.8 s, cd 1.5 s | 4 mp, dmg 2, stun 1.2 s, cd 1.2 s | 3 mp, dmg 3, stun 1.6 s, cd 1.0 s |
| **Light Orb** - a teal point light hovers 2.2 m above Wick and follows him (one alive; recast refreshes). Beasts treat it like woken Waystone light (no aggro start inside it). Made for the crypt, caves and night. | 6 mp, 30 s, light r8, beasts level <= 3 keep out | 6 mp, 45 s, r10, beasts <= 5 keep out | 5 mp, 60 s, r12, beasts <= 7 keep out; beasts inside when cast flee 2 s |
| **Ward** - a teal ring of `o` glyphs around the screen edge + soft teal light on Wick; absorbs incoming damage until used up or timed out (vitals damage hook, before armour). | 8 mp, absorbs 10 hp, 8 s, cd 12 s | 8 mp, 18 hp, 8 s, cd 10 s | 7 mp, 26 hp, 10 s, cd 8 s |

### Wind (movement + physics)
| Spell | Lv1 | Lv2 | Lv3 |
|---|---|---|---|
| **Gust** (root) - a 60 degree cone of white `~` particles; beasts in it get knockback + stagger; loose physics props (crates, barrels) in it get an impulse. | 5 mp, 6 m, knock 10 m/s, dmg 0, stagger 0.4 s, cd 2 s | 5 mp, 7 m, knock 13, dmg 1, stagger 0.6 s, cd 1.8 s | 4 mp, 8 m, knock 16, dmg 2, stagger 0.8 s, cd 1.5 s |
| **Updraft** - an upward push from the ground (works only when standing or within 0.3 s of leaving a ledge), then slow fall; reaches ledges a jump cannot (tool gating, GDD 3: "new spells and gear open new parts of the map"). Not a dodge (D-113). | 6 mp, +4 m height, fall gravity x0.4 for 1.5 s, cd 5 s | 5 mp, +5 m, 1.8 s, cd 4 s | 4 mp, +6 m, 2.2 s, cd 3 s |

Root rule summary: Fire root Fireball -> Fire Ring; Light root Spark -> Light Orb, Ward; Wind root Gust -> Updraft.

## 3. How it shows
- **Spell page:** a "Spells" tab in the character view (`inventoryScreen.js`). Three columns titled Fire / Light / Wind; one card per spell: glyph in branch colour, plain name, level pips `[##-]`, mana + cooldown. Not learned: dim card "Not learned". The selected card shows "Now" and "Next level" lines (numbers from the tier table). Footer: "Spell Scrolls: N" and, when N > 0 and the card can rise, "[E] Use Spell Scroll". No "Esc to close" text.
- **Quickbar:** spells are hand items like `spell.fireball` today: drag a learned spell to [L]/[R] (cast on the mouse button; Fireball keeps hold-to-charge) or to keys 1-4 (key = tap cast). Unlearned spells cannot be placed (generalises FB_LOCKED_IDS).
- **Cards/toasts:** learn -> item-get card "New spell: Spark" + one plain line of what it does; upgrade -> "Fireball is now level 2".
- **Level (PLAYER-LEVEL-01):** `spellBook.tiers()` returns the map spellId -> tier that `playerLevel(spells, equipped)` already takes. Learning or upgrading recomputes the HUD "Lv N" (flash on rise). Note: with the proposed cap (+2 at tier sum 8) a player who learns all 7 spells and reads 1 scroll is already capped; the owner OKs that number in PLAYER-LEVEL-01.

## 4. Placement in today's content (first pass)
| Source | Gives | Why there |
|---|---|---|
| Burl, level 5 beat (D-069) | Fireball | unchanged, first spell |
| Crypt chest (UNDER-02 AC4, D-114) | 1 Spell Scroll + 40-60 coins + Health Potion | D-114 as corrected; if no spell is learned yet the scroll waits in the bag |
| Bear den stash (UNDER-04) | +1 Spell Scroll (added to the existing stash) | earned (behind the bear) |
| Sea cave locked chest (UNDER-05) | Light Orb Spell Book | a dark cave; key on the strand = earned |
| Goblin tunnel (UNDER-06), a stash at the midpoint guarded by the 2 patrol goblins (existing chest prop) | Fire Ring Spell Book | fire vs goblin torches |
| Waking the 3rd Waystone on the near side | Spark | canon: light jumps from the stone to his hand; a wake reward, not a quest giver (D-082) |
| Rook's chain end (mq.bend, ford ruin) - writer confirms the giver | Ward | a character quest reward |
| Waking the first far-side (foothills) Waystone | Gust Spell Book | wind on the open fields |
| A far-side character quest (writer picks the giver) | Updraft Spell Book + 1 Spell Scroll | late, after Gust |
| Future bosses / dungeon ends | 1 Spell Scroll each | the main upgrade source |

Alpha supply: 3 Spell Scrolls now (crypt, bear den, far-side quest) + 1 per future boss/dungeon, about 8 by the end of the alpha vs 14 possible upgrades, so choosing matters.

## 5. Owner questions
- **Q1 (tree):** 7 spells in Fire / Light / Wind - Fireball, Fire Ring | Spark, Light Orb, Ward | Gust, Updraft - OK? (Alternative: drop Updraft, keep 6.)
- **Q2 (scrolls):** a Spell Scroll goes into the bag and is spent any time on the spell page on a spell you choose (PO default), or must you choose right when you open the chest? Supply about 8 scrolls in the alpha (you cannot max everything) OK?
- **Q3 (mana):** max mana is 20 today (a charged fireball costs 10). PO default: raise base max to 30 and regen to +1 per 1.5 s so two or three spells can be mixed; INT gear still adds +2 per point. Or keep 20 and let gear carry it?

## 6. Stories
Rows in docs/pc-b-queue.md section "K. EP-SPELLS". Order: SPELL-01 data -> SPELL-02 scroll hook + crypt -> SPELL-03 spell page -> SPELL-04 cast dispatcher + Fireball tiers -> SPELL-05..08 spells -> SPELL-09 placement -> SPELL-10 level wire.
