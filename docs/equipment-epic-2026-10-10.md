# Epic EQUIP - equipment, character window, shield + bow, gear loot (2026-10-10)
(PC-B PO opus, owner request 2026-10-10; PC-A to ratify.) Source: D-065 (shield/block + bow/arrows instead of magic) and owner
asks "we need to be able to dress", "next to the item window a character window too", and "beasts/chests/containers drop GEAR
with a low chance instead of crafting materials". Story rows: `docs/pc-b-queue.md` section "Equipment + character window (EQUIP, 2026-10-10)".

## Owner questions (each has a default; we build the default unless the owner says otherwise)
1. **Fireball + MP bar.** Default: both hidden. Fireball sim/view stay in code, registered only with `?magic=1`. The MP bar and
   `orb.mp` pickups are hidden/not spawned unless `?magic=1`. Nothing is deleted.
2. **Mouse / keys.** Default: LMB = main hand (sword swing; with the bow out: hold = draw, release = shoot). RMB hold = block
   (shield raised). With the bow out, RMB is free (no zoom in v1). `Q` swaps the weapon set: sword + shield <-> bow (2-handed).
   The programmer checks `game/js/quest/input/bindings.js`; if `Q` is taken, pick a free key and note it. Block is also rebindable.
3. **Menu shape.** Default: one menu, two tabs side by side in the same 160x60 frame: **Items | Character**. `I` opens Items,
   `C` opens Character, `Tab` switches tabs. It pauses the sim like the pack today (a real menu may pause; owner rule). No printed "Esc" hint.
4. **Defence.** Default: each piece has a defence value by tier (worn 1 / sturdy 2 / fine 3; body and shield x2). Damage taken
   = hit x (1 - min(0.6, 0.03 x total defence)), rounded, min 1. A full fine set = 0.6 cap. Shield block is separate (item 3 below).
5. **Gear drop rate + arrows.** Default: boar 4 % per kill (one gear roll), barrel/crate/pot 3 %, chest 8 % (quest chests always
   give their fixed reward). Duplicates allowed, no "sure drop after N misses" in v1. Arrows finite: quiver 30, the bow comes with
   10, a world hit sticks 30 s and can be picked up (70 % survive), bundles of 3-5 drop at 20 % from beasts/containers.
6. **Potions + quick bar.** Default: drinkable potions are pack items (`potion.hp` "Red Draught" heals 2 hearts, stackMax 5;
   `potion.mp` defined but not dropped while magic is off). The HP hearts stay as today. Quick bar = 4 slots, bottom-centre,
   one row (section 2b). Drinking takes 0.6 s (sip anim), cannot block meanwhile. Is the existing herb flask `orb.hp` touch-pickup kept too? Default: yes.

## 1. Equipment slots + item data
Slots (11): `head`, `body`, `cloak`, `hands`, `belt`, `legs`, `feet`, `main` (sword), `off` (shield), `ranged` (bow), `quiver` (arrows).
- Player component `equipment` = `{head, body, cloak, hands, belt, legs, feet, main, off, ranged, quiver}` with item ids or null;
  `quiver` = `{id, n}`. The pack (`inventory.slots`, 24) holds everything not worn. Equip = move pack -> slot (the old piece goes back
  to the pack; a full pack refuses with a toast). The existing `inventory.left/right` hands become derived: `right = main` (or `ranged`
  with the bow set out), `left = off`. Save/load migrates old saves: `left: 'sword'` -> `main`, `shield` -> `off`, `spell.fireball` -> pack.
- Item def additions (`design/items.js` + content items, validated by `validateItemDefs`):
  `equip: {slot, tier: 'worn'|'sturdy'|'fine', def: n, shell?: '<charkit shell id>', paint?: {...}, held?: '<voxel model key>'}`.
  Gear kind = `'gear'`; `stackMax 1`. Arrows: `kind 'ammo'`, `stackMax 30`, `equip.slot 'quiver'`.
- Existing defs reused: `sword` (main), `shield` "Brass Buckler" (off), `bow` "Hunter's Bow" (ranged). New: `arrow`, and 7 wearable
  bases x 3 tiers = 21 gear ids, e.g. `gear.head.hood.worn`, `gear.body.jerkin.sturdy`, `gear.feet.boots.fine`. Tier = same shape, different
  paint + name prefix (Worn / Sturdy / Fine) + def value. Clothing shapes come from charkit `shells` (top/legs/feet/outer/hat exist; new
  shells needed: gloves (hands), belt, cloak; `outer` = cloak or body overlay - designer decides).
- Starting look: the chargen choice (base, skin, hair) stays; its default shells are the "underclothes" shown when a slot is empty.

## 2. Character window (Character tab)
- Layout (designer `uiStyle.character`, in 160x60 UI cells): centre = character view (~40x44 cells); slots in two columns around it
  (left: head, cloak, body, hands, belt; right: legs, feet, main, off, ranged, quiver), each a 7x5 cell icon box like the pack slots;
  the pack grid (same as Items tab) at the far right so dressing needs no tab switch. Stats line under the view:
  `Hearts 5/6   Defence 9 (-27%)   Arrows 18/30`. No XP, no level (D-020).
- View: the player's chargen character (`char.player`, 38.32) wearing the equipped shells + held sword/shield/bow at the mounts, lit
  with a fixed 3-point UI light, idle clip playing. Rotate: A/D or arrow keys, or drag with the mouse; it slowly faces the camera when idle.
  Realistic voxel style; the ASCII glyph shading of the game (same look as in the world).
- Tooltip: hovering/selecting a slot or pack item shows name, tier colour (worn grey, sturdy green, fine gold), slot, defence, description.
  **Compare:** for a gear item in the pack, the tooltip shows the worn piece's defence and the delta (`Defence 2 -> 3 (+1)`, green/red).
- Equip/unequip: drag a pack item onto a slot (or onto the character) / drag a slot item to the pack; keys: `E`/Enter on a pack item =
  equip to its slot, `E` on a slot = unequip. Wrong slot drop = refuse flash (existing F_REFUSE state). Changing gear updates the view
  within one frame of the next draw and the stats line at once.

## 2b. Quick bar (owner addition 2026-10-10)
- **HUD:** 4 slots bottom-centre, one row, each 7x4 UI cells: key digit (gold) top-left, the item's 5x3 icon, count bottom-right
  (`x3`) for stacks, nothing for gear. The active hand item gets a bright frame; an empty slot is a dim `.` frame. A slot whose item
  is gone (count 0 / item dropped) shows the icon dimmed with `0` and clears when the stack is gone for good. Always visible in play,
  hidden in menus/cinematics/title. Readable on bright grass (plate bg like toasts).
- **Assign:** in the Items tab and the Character tab: drag an item onto a quick-bar slot drawn at the bottom of the menu, or select an
  item and press 1-4. One id per slot; assigning an id that sits in another slot moves it. Assignment stores the item id, not the stack.
- **Press 1-4 in play, by kind:** `weapon`/sword -> `main` (swaps the weapon set to melee); bow -> bow set out; shield -> `off`
  (toggles shield in/out of the off hand); `tool` (torch) -> into the hand per the current hand rules; `food`/`potion` -> use one
  (heal, toast "Not hurt" when full, as the pack today); gear (clothing) cannot be assigned (refuse flash).
- **Input rule:** while a dialogue choice list is open, digits 1-4 go to the dialogue; otherwise to the quick bar. Never both.
- **Save:** `quickbar: [id|null x4]` in the save; old saves start with `[sword, shield, bow, null]` filtered by what the player owns.

## 3. Visible gear in play
- **Shield (first person).** When `off` holds a shield: the shield sits on the left forearm, lower-left of the view (hand model + shield
  mesh). Hold RMB: raise in 0.12 s (front centre-left, covers ~25 % of view), lower in 0.15 s on release. While raised: walk speed x0.6,
  no sword swing. A hit whose source lies within +-60 deg of the look direction is blocked: 0 damage, small knockback 0.3 m, spark +
  "clank" sound, attacker staggers 0.4 s. Hits from the side/back hurt as usual. Stamina-free v1.
- **Bow (first person).** `Q` swaps to the bow set (0.3 s lower/raise). Hold LMB: draw 0 -> full in 0.8 s (string + arrow visible,
  slight FOV-in 4 deg at full). Release: arrow speed 20 m/s (tap) .. 45 m/s (full), gravity 9.8, damage 1 .. 3 x sword hit at full draw.
  No arrow in the quiver = dry draw blocked + toast "No arrows". Arrows stick in terrain/structures (30 s), pick up with `E` or by
  walking over them (+1 arrow, toast). Hits beasts with the normal hit reaction.
- **Clothing.** Shown on the character in the Character tab now; in third person / other views later (same composed model).
- **HUD.** Arrow count next to the hearts when the bow set is out (`>> 18`). MP bar hidden (OQ1).

## 4. Gear loot (owner direction 2026-10-10, owner-visible change)
- Beasts, chests and containers (barrel/crate/pot) **no longer drop crafting materials** (`boar.hide`, `boar.tusk`, `brass.scrap`):
  the drop rows are removed from the tables; defs, recipes and `craftView` stay in code, parked. Food drops (boar meat) stay.
- Loot table data (`content/items/loot.json`): per source type `{rolls: [{chance, pick: {slots: [...], tiers: {worn, sturdy, fine}}}], fixed: [...]}`.
  Default per OQ5: boar 4 % one gear roll, container 3 %, chest 8 %; tier odds worn 70 / sturdy 25 / fine 5 %; slot picked uniform from
  `head body cloak hands belt legs feet off`. Arrow bundle roll 20 % (3-5). Seeded rng (`world.rng`), deterministic in tests.
- A drop shows as a world pickup (the item's 3x3 glyph sprite, gentle bob) at the corpse/container; picking it up gives the
  item-get card (`game/js/ui/itemGetCard.js`) with name + tier colour + "Defence n", then the item is in the pack. Duplicates OK.
- The loot sim today assumes 3 fixed entries per corpse (`ITEMS_PER_CORPSE`); it becomes a list of 0..4 rolled entries.

## 5. Quest reward hooks (for the writer's docs/questline-2026-10-10.md, kestrel-1)
The writer names quests and items; the data can express:
- `reward: {items: [{id, n}], gear: [{id}] | [{slot, tier}]}` on a quest step or quest completion (fixed piece, or a rolled piece of a
  given slot/tier). Shown with the item-get card, then the toast.
- `giveOnTalk: {id}` (the giver hands over an item at the start: e.g. the bow + 10 arrows from a hunter).
- `requireEquipped: {slot | id}` objective ("wear the warden's cloak to pass the gate") and `requireItem: {id, n}` (fetch/deliver).
- Suggested placement: shield = early main-quest reward (first relay), bow + arrows = first side errand giver, fine pieces = later
  relays. The writer picks the names (tier name prefixes stay Worn / Sturdy / Fine).

## 6. Architect notes needed (before dev)
- **EQ-A1 character preview in a UI panel**: render one voxel/rigged model into a rect of the 160x60 UI layer (or a second
  viewport) with its own camera + fixed lights while the sim is paused; JS + GPU paths; re-compose `char.player` with gear shells at
  equip time (load-time-only `registry.replace` + re-`bind` per 38.32 item 2 - is that acceptable in a menu, or a separate preview key?).
- **EQ-A2 arrow projectile + block**: arrow sim (swept ray vs colliders + beast hit volumes, stick, pool size, 0 alloc), where the
  damage/block hook sits (frontal cone test in the hit path), and whether it lives in `engine/physics` (stand-alone rule) or game sim.

## 7. Owner-visible changes (walk-test list)
Character tab + dressing; quick bar 1-4 + potions; shield block; bow + arrows; gear drops instead of materials; MP bar / fireball gone (OQ1); defence lowers damage.

## 8. Out of scope v1
Stamina, durability, gear sets/bonuses, dyeing, shop/trading, third-person gear view, magic gauntlet, crafting gear.
