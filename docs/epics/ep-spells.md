# EP-SPELLS - Fireball, Freeze, Telekinesis, Teleport (PC-B PO opus, 2026-10-15; owner to OK)

**Replaces** the 2026-10-15 draft (Spark / Light Orb / Ward / Fire Ring / Gust / Updraft), which ignored D-021. Owner D-115: "we already said what spells can be".
Reads: D-021 (the four spells; beacons, wells, quests; small skill tree; Teleport needs an architect note), D-115, D-114 + corrections (Spell Scroll: the player CHOOSES the learned spell, one per scroll, cancel keeps it), D-078 / D-084 (no XP; player level is derived from spell tiers + item levels), D-081 / D-091 (INT from gear only), D-117 (no stamina), D-113 (no dodge roll), D-018 (physics carry/throw - **not built**: there is no `engine/physics/rigid.js`; loose physics props today = `roller` bodies, e.g. `tower.boulder`), D-069 (Burl gives the Fireball), D-080 (beacons = Waystones), docs/owner-ideas/2026-09-24-story-and-progression.md.

## 1. Rules
- **Exactly four spells:** Fireball, Freeze, Telekinesis, Teleport. Each has level 0 (not learned) and levels 1..3. Tier sum max 12.
- **Learn** at a Waystone (beacon), at a well, or by finishing a character's quest (D-021, D-082). Burl's Fireball stays the first (D-069, `sq.burl.fire`, unchanged). No Spell Books, no shop, no XP.
- **Upgrade = Spell Scroll** (plain name, item `scroll.spell`, stack 9; D-114 as corrected): spent on the spell page on ONE learned spell below level 3 that the player chooses. Confirm: "Raise Freeze to level 2?  [E] Yes  [Q] No". Q cancels and keeps the scroll. No random choice anywhere.
- **The tree** = each spell's three levels, shown as four cards in learn order (section 3). No cross-locks between spells: a scroll can go to any learned spell (owner Q1 offers an optional lock).
- **Mana** stays as today (D-0xx sets nothing else): max 20, +1 per 2 s, 3 s regen pause after a cast (`vitalsConfig.js`); INT gear adds +2 max mana per point (D-081); hard sword swing still costs 4. No stamina (D-112).
- **INT** damage bonus (`fireDmgMul`) applies to every damage spell (Fireball, Freeze, Telekinesis throw impact).
- Visuals reuse what exists: fireball view, `spellLightView.js` (recoloured), `gustView.js` (recoloured), particles, point lights, glyph + colour only. No new art, no new meshes, no new palette keys (designer picks existing keys).
- Every sim: no Math.random (seeded), 0 alloc per step, deterministic hash twice equal.

## 2. The four spells (numbers per level)

### Fireball (attack; first spell) - unchanged from today's `spellDefs.js`
| Lv | tap: mana / dmg / radius | charged (hold 0.6 s): mana / dmg / radius | cd |
|---|---|---|---|
| 1 | 5 / 3 / 2.0 m | 10 / 5 / 3.0 m (= today) | 0.5 s |
| 2 | 5 / 4 / 2.0 m | 10 / 7 / 3.5 m | 0.5 s |
| 3 | 5 / 5 / 2.0 m | 9 / 9 / 4.0 m | 0.5 s |

### Freeze (control) - reuse the Spark sim
A pale ice bolt (`+` / `*`, existing pale blue/white keys, e.g. skyHorizon / aetherCore) flies straight; the first beast hit takes damage and is frozen: `combat:hit` with `stunSec` = freeze time (the beastSim stun path Spark already uses), knock 0. A frozen beast does not move or attack; a white-blue frost glyph puff sits on it for the duration. Walls stop the bolt.
| Lv | mana | cd | speed / range | dmg | freeze | extra |
|---|---|---|---|---|---|---|
| 1 | 5 | 2.0 s | 24 m/s / 18 m | 1 | 1.5 s | - |
| 2 | 5 | 1.8 s | 24 m/s / 20 m | 2 | 2.5 s | - |
| 3 | 4 | 1.5 s | 24 m/s / 22 m | 3 | 3.5 s | also freezes up to 2 more beasts within 2.5 m of the hit (same time) |
- Bosses and beasts above zone level 7 freeze for half the time (no perma-lock).
- A crocodile that has the player in a grab (D-088 pin) lets go when frozen: this is the croc escape that replaces the dodge roll (D-113).
- Re-freezing a frozen beast refreshes the timer, never stacks above the level's time.

### Telekinesis (physics) - reuse the Gust push/impulse code
Glyph `~` in aether teal (magic of light). Aim with the camera; acts on the nearest valid target in a 30 deg cone (LOS required, nothing behind a wall).
| Lv | mana | cd | range | what it does |
|---|---|---|---|---|
| 1 | 4 | 1.5 s | 8 m | **Push** (tap): beast knock 12 m/s + stagger 0.5 s, dmg 0; roller props impulse 8 m/s. **Pull** (hold >= 0.4 s, release): the same toward the player, stops 1.5 m short. |
| 2 | 4 | 1.2 s | 12 m | Push/Pull knock 16 m/s, stagger 0.8 s; a pushed beast that hits a wall within 0.5 s takes 3 dmg. |
| 3 | 6 + 1/s held | 3.0 s | 12 m | **Lift and throw:** hold grabs one small/medium beast (not bear, croc, boss) or a roller prop, floats it 2.5 m in front at eye height for up to 3 s; release (or 3 s) throws it along the aim at 14 m/s; impact dmg 6 to the thrown beast and to a beast it hits. |
- Push/Pull use Gust's `applyImpulse` path for rollers (`hooks.forEachProp`), and the beast knock via `combat:hit`.
- Level 3 hold needs an ARCH-NOTE (kinematic hold of a beast / roller body for up to 3 s, release velocity, no tunnelling into walls). When D-018 US-052 carry/throw lands, its loose props join the target list with no new spell code.

### Teleport (movement; the "one big spell") - ARCH-NOTE NEEDED
A short blink along the camera aim to a collision-safe spot. Glyph `*` burst in moon / aetherCore at both ends, 0.12 s white fade on the camera. Not a dodge (D-113): no invulnerability frames, it is a cooldown spell.
| Lv | mana | cd | max distance | extra |
|---|---|---|---|---|
| 1 | 8 | 6 s | 8 m | flat or down only (target ground up to 0.6 m higher) |
| 2 | 7 | 5 s | 12 m | target up to 1.5 m higher |
| 3 | 6 | 4 s | 16 m | target up to 3 m higher (ledges); beasts within 6 m of the start lose track for 2 s |
- **Safe target** (architect note decides the method): eye-ray to the aim point capped at the level distance; never through a wall/ceiling/closed door/grate; the player capsule must fit at the target; back off along the ray in 0.5 m steps until it fits; ground must be within 1.5 m below; never into deep water (swim depth), never out of the world bounds or into a locked area. No valid spot -> refused, no mana spent, toast "No room to blink." Camera: eye snaps with the capsule, no lerp through geometry.

## 3. How it shows
- **Spell page** (character view "Spells" tab, today's `spellPageView.js`): four cards in one row in learn order Fireball -> Freeze -> Telekinesis -> Teleport, joined by `-` lines (the tree). Card: glyph in its colour, plain name, level pips `[#--]`..`[###]`, "mp N  cd N s". Not learned: dim card, "Not learned" + one hint line ("Ask Burl." / "Look into the dry well." / "Wake three waystones." / "Help Rook at the ford."). Selected card: "Now" + "Next level" lines from spellDefs; level 3 = "Max level". Footer "Spell Scrolls: N"; "[E] Use Spell Scroll" when N > 0 and the card can rise. No "Esc" text.
- **Quickbar:** `spell.<id>` hand items as today (L/R mouse or keys 1-4); tier-0 spells cannot be placed.
- **Cards/toasts:** learn -> item-get card "New spell: Freeze" + one plain line; scroll -> "Freeze is now level 2".
- **Player level (D-084):** `spellBook.tiers()` feeds `playerLevel(spells, equipped)`. With 4 spells the PLAYER-LEVEL-01 cap (+2 at tier sum 8) is reached with all four learned and 4 upgrades; the owner OKs that number in PLAYER-LEVEL-01.

## 4. Where spells come from (existing content only)
| Source (existing) | Gives | Notes |
|---|---|---|
| Burl, `sq.burl.fire` hand-in (D-069) | **Fireball** | unchanged, first spell |
| The dry well north of the post (`rsInspectWell`, area `well`, x 994 y 1051.5); Rook's `sq.fc.well` sends you there | **Freeze** | the WELL: inspecting it the first time ("cold light rises from the dry well") teaches Freeze once, quest or not; the quest still hands in to Rook (D-082) |
| Waking the **3rd near-side Waystone** (`wakeGrants` thirdNear rule, spellBooks.js) | **Telekinesis** | the BEACON |
| Rook, `mq.ford.mirror` hand-in at the ford ruin | **Teleport** | the QUEST (mirror -> blink) |
| Crypt chest (UNDER-02 AC4, D-114) | 1 Spell Scroll + 40-60 coins + Health Potion | scroll waits in the bag if nothing is learned |
| Bear den stash (UNDER-04) | +1 Spell Scroll | earned (behind the bear) |
| Waking the **6th and 9th** Waystone (any side) | +1 Spell Scroll each | beacons keep giving magic (D-021) |
| Future bosses / dungeon ends | +1 Spell Scroll each | main later source |
Alpha supply: 4 scrolls (crypt, bear den, 6th + 9th waystone) vs 8 possible upgrades, so the choice matters.

## 5. Owner questions (max 3)
- **Q1 (tree lock):** default = no cross-locks (any learned spell can take a scroll). Or: a spell's level 3 needs another spell at level 2?
- **Q2 (sources):** Freeze at the dry well, Telekinesis at the 3rd Waystone, Teleport from Rook's `mq.ford.mirror` - OK, or should Teleport (the big spell) come later, e.g. the first far-side Waystone?
- **Q3 (Telekinesis level 3):** lift-and-throw beasts and the boulder now (needs an architect note), or wait for the D-018 carry/throw props and stop at Push/Pull for the alpha?

## 6. Stories
Rows SPELL-R1..R8 in docs/pc-b-queue.md section "K. EP-SPELLS (D-021)". Code base: kestrel-4 branch `spellsall` (not merged to pc-b). Order: R1 retire -> R2 Freeze / R3 Telekinesis 1-2 / R5 page in parallel -> R4 Teleport (after the arch note) -> R6 placement -> R7 Telekinesis 3 -> R8 level wire.
