# Owner test list, 2026-10-13 evening

Everything below is in the folder served on port 8000 (local `pc-b`, not pushed yet). **Press Ctrl+F5 once** so the browser loads the new files.
Write your notes after each `->`. If something is wrong: press F3, copy the `world (x, y, z) yaw pitch` line, and write what you see.

Tricks: `?pose=<name>` jumps to a place, `?at=x,y,z,yaw,pitch` to an exact spot (no autosave), `&debug=1` then F3 for the overlay, `&time=23` sets the hour.

## 1. Loading and stutter (OB-109, top priority)
- [ ] **Loading bar does all the work:** http://localhost:8000/game/index.html - watch the card: "Compiling shaders", "Loading props", then **"Shaping the land"**. The mountains must be there on the very first frame (no flat green band). Then New Game. ->
- [ ] **No stutter while walking:** walk from the tower south and west (to the ford, then down the south track). Before: up to 817 ms freezes when a new area loaded; now the worst frame in our test was 33 ms. ->
- [ ] **Continue / Load:** Esc -> Back to main menu -> Continue. You should see "Shaping the land" briefly, never the flat band. ->
- Measured today (headless): loading bar +3.7 s longer, worst frame while walking 817 ms -> 33 ms, 0 frames over 50 ms.

## 2. Far trees, buildings, haze (OB-089)
- [ ] http://localhost:8000/game/index.html?pose=roadSouth - no dark navy silhouettes. Trees draw to 140 m (beyond that the green forest colour of the hills stands in), buildings stop at 180 m, landmarks (tower, relays, waystone, Sealed Gate) stay. Far things fade into the light-blue haze, not navy. ->
- [ ] Same with debug: http://localhost:8000/game/index.html?pose=roadSouth&debug=1 ->

## 3. Water
- [ ] **Ford (OB-107):** http://localhost:8000/game/index.html?at=1045.96,1066.69,-87.13,246,-11 - one river surface, a shallow crossing over the bar (you wade), no dry sand band, no straight seams. ->
- [ ] **Swim (D-070):** walk into the deep Braid near http://localhost:8000/game/index.html?at=1018.6,984,-88,90,0 - you float and swim (no jump), sword/shield/bow are put away and come back on land. Swimming on the surface never hurts you. ->
- [ ] **Dive:** hold **Left Ctrl** to dive, **Space** to swim up. Under water: the water tint/fog, light patterns on the bed, the surface above you. The breath ring shows while diving; stay down too long and you lose hearts. ->
- [ ] **Death card:** drown once on purpose - the death card shows a drowning line. ->

## 4. The Long Strand + sea monster (D-073, D-070)
- [ ] **Walk south:** from the ford follow the south track down to the beach (the new corridor; about 640 m). Or jump: http://localhost:8000/game/index.html?at=1478,1100,0,180,0 then walk south. ->
- [ ] **Warning sign:** on the beach near (1384, 1742): `[E] Read the sign` - "SWIM TO THE STAKES. NOT ONE STROKE PAST." Net stakes stand in the water. ->
- [ ] **Sea monster:** swim out past the stakes: a dark back + fin circles you; keep going and it rises and strikes (death "eaten"). Swim back inside the stakes and it leaves. ->

## 5. Living world (D-071)
- [ ] **Outwall by day:** http://localhost:8000/game/index.html?pose=outwall&time=10 - Hesk and Dorrin walk their routines (board, forge, home), stop to chat with each other (you hear short lines within 8 m), turn to face you when you come close. ->
- [ ] **Outwall at night:** http://localhost:8000/game/index.html?pose=outwall&time=23 - they are gone (asleep at home). ->
- [ ] **Talk:** talk to Hesk / Dorrin - their chat breaks off; [E] Talk follows them while they walk. ->
- [ ] **Wild:** in the forest, watch for foxes chasing rabbits, wolves/bears hunting deer (and eating), rabbits and deer running from them. ->

## 6. Goblins (D-072)
- [ ] **North camp by day:** http://localhost:8000/game/index.html?at=915,905,0,90,0 (walk a bit toward the camp at 925,905): melee goblins circle and attack two at a time, spear-throwers stay back and throw - raise the shield (it clanks, blocks from the front), sidestep to dodge. Kill half and the rest flee. ->
- [ ] **Loot:** goblin drops - at band 7+ you may see tempered/warden weapons (Quenched Edge, Horn Bow, Iron Kite / Watch Blade, Watch Bow, Watch Shield). ->
- [ ] **Raids at night:** accept "Defend the Farm" on the Outwall notice board, then wait for night (22-04): wolves or goblins with up to 3 torches raid the goose pen; kill the pack -> quest done. (Raids roll per night, so it may take a night or two.) ->

## 7. Small fixes
- [ ] **Chest [E] (OB-106):** go to any chest within ~1.4 m and aim at it: "[E] Open chest". ->
- [ ] **No item-get card (OB-105):** loot a chest / a heart piece: only a short "Looted: ..." line, no big card. ->
- [ ] **Note "!" (OB-095):** http://localhost:8000/game/index.html?pose=towerInterior - the "!" sits almost on the wall. ->
- [ ] **Steep cliffs (OB-104b):** steep terrain faces draw as rock with the texture along the wall, not smeared down. ->
- [ ] **Burl's errands (BURL-HOME-01):** after Burl walks home, talking to him starts his home talk, then his errands. ->

## 8. Performance numbers (D-075 step 1, measured on this laptop, 480x180, total GPU ms)
| Spot | rays 1 | rays 2 | rays 4 (ultra) |
|---|---|---|---|
| roadSouth | 8.4 | 9.2 | 11.7 |
| meadowDetail | 5.4 | 5.8 | 12.2 |
| fordDetail | 6.4 | 7.6 | 16.2 |
| outwall | 3.3 | 3.5 | 9.8 |

Rays 2 costs almost the same as rays 1; rays 4 roughly doubles it. On this laptop the **high** preset (fewer rays) is the one to play on; ultra stays for RTX (D-075).
- [ ] Try Settings -> quality **high** vs **ultra**: does high look good enough? ->

## 9. Still open decisions (from this morning's list)
- [ ] **Gear tier look (EQ-22):** A) realistic shades or B) a colour per tier? ->
- [ ] **US-102 clockwork sentinel:** keep or replace? ->
- [ ] **M4-C3** (chart labels + long-walk check): M4 or M5? ->
- [ ] **Barley + shooting-range quest givers (QL-22)?** ->
- [ ] **Grass amount:** own Settings line or follows the quality preset (plan: per preset)? Grass ON by default after your walk? ->
- [ ] **Burl dialogue rewrite** OK? ->
- [ ] **Tutorial hints** may jump the queue? ->
- [ ] **Minimap** or chart only? ->
- [ ] **Wolf/goblin raids:** flavour only, or can a raid cost something permanent? ->
- [ ] **Backlog cleanup** pass (docs/janitor/backlog-audit-2026-10-13.md)? ->
- [ ] **Human characters:** what bothers you (proportions, face, blockiness, clothes) or a reference picture? ->
