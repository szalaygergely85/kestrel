# Owner to-do, 2026-10-13

The server runs on port 8000 from the repo root (`python -m http.server 8000`; restart it with that if a link does not load).
Tick the boxes as you go and write notes after the arrows; the main session reads this file back.

## 0. How to test (quick tricks)
| What | How |
|---|---|
| Normal game (title, New Game / Continue, autosave) | http://localhost:8000/game/index.html |
| Jump straight to a place (no title, no wake intro) | add `?pose=<name>`, e.g. http://localhost:8000/game/index.html?pose=burl |
| Pose names | crash, stairs, brazier, breach, towerShadow, towerInterior, towerExterior, burl, waystone, meadowDetail, meadowSea, lakeEdge, roadSouth, roadBend, roadLeft, hillside, fordDetail, outwallFord, outwall |
| Exact spot from the F3 line | `?at=x,y,z,yaw,pitch`, e.g. `?at=1496.26,1024.19,0,304,-19`. Note: `?at` never autosaves |
| Debug overlay (position, F3 stats) | add `&debug=1`, then press F3 |
| Time of day | add `&time=20` (hour) |
| Grass carpet on (off by default) | add `&carpet=1` |

When you report a problem: press F3, copy the `world (x, y, z) yaw pitch` line, and write what you see. It becomes an OB row in docs/bugs.md.

## 1. Decisions (only you can answer)
- [ ] **River gate vs swimming (D-070):** (a) free crossing
- [ ] **Gear tier look (EQ-22 / US-129b):** A) realistic material shades (PO default) or B) a colour per tier? ->
- [ ] **US-102 clockwork sentinel:** keep it (a machine), or replace it with a realistic beast? ->
- [ ] **M4-C3** (chart labels + long-walk check): does it count toward M4, or move to M5? ->
- [ ] **Barley + shooting-range quests (QL-22):** who gives them? The writer texts assume new characters. ->
- [ ] **Grass amount:** follow the main quality preset, or its own Settings line? And is grass on by default after your walk? ->
- [ ] **Burl dialogue rewrite:** OK the writer pass (split the waystone speech, replace the 2nd "That's impossible", add the "old promise" hint)? ->
- [ ] **Tutorial hints:** let important hints jump the queue? (The fireball hint can wait ~30 s today.) ->
- [ ] **Minimap (US-131):** a corner minimap, or the chart card only (Zelda-style)? ->
- [ ] **Dive key:** architect proposes Space = swim up, Left Ctrl = dive (C is crafting). OK? ->
- [ ] **Swim numbers:** swim 1.8 m/s, fast swim 2.6 m/s; sea monster warns at 60 m from the shore, kills at 90 m. OK as a start? ->
- [ ] **Wolf raids:** can a raid ever cost something permanent (e.g. a goose lost that changes a quest), or only flavour (architect default)? ->
- [ ] **Dark trees test (OB-089):** compare http://localhost:8000/game/index.html?pose=roadSouth with http://localhost:8000/game/index.html?pose=roadSouth&shadows=off - do the far trees/buildings turn lit with shadows off? ->
- [ ] **Backlog cleanup:** go for the janitor/PO pass on ~280 stale rows (report: docs/janitor/backlog-audit-2026-10-13.md)? ->

## 2. The two walks that close M4
Use the normal game link (no `?pose`), New Game.
- [ ] **QL-20, Ch1-2 walk:** wake in the tower, read the note, take the sword, Burl's boar quest, walk with Burl to the waystone, road west, Bend relay, Rook, the ford stones, the mirror, Ford relay. Do a few errands on the way (blue berries, the brass scrap, shooting targets). Use J (journal: accept / track / abandon), follow the compass, and check that rewards show on Wick. ->
  - Known risk: errands that start at Burl's home may not open (the scripted run could not talk to Burl at home). Please try talking to Burl after he walks home. ->
- [ ] **EQ-14, gear walk:** I (Items) / C (Character): wear a found piece and check it shows on Wick, block a boar with the shield, kill a beast with the bow, drink a potion from the quick bar. ->
- [ ] **Save:** Quit to the title, press Continue: same place, hearts, items, gear, tracked quest. ->
- Checklist with more detail (combat at the ford, notes, pause, prompts, hints, HP regen, fall damage, banner, ford slip): docs/test-reports/po-batch-2026-10-11-pcb.md, section "Owner walk checklist".

## 3. Bug fixes to re-test ("fix in - OWNER TO TEST")
Most of these come up on the walks; the links go straight to the spot.
- [ ] **Journal: two panes, accepted quests only, counts only for items/kills, handed-in quests disappear** (OB-097/099/100). Press J during the walk. ->
- [ ] **[E] only when aimed, whole object works** (OB-084/088): note and gondola in the tower. http://localhost:8000/game/index.html?at=1496.26,1024.19,0,304,-19 ->
- [ ] **Gondola [E] only on the wreck** (OB-094): http://localhost:8000/game/index.html?pose=crash ->good
- [ ] **Note "!" small, near the wall** (OB-095): http://localhost:8000/game/index.html?pose=towerInterior ->good, but a little
- [ ] **Tower faces don't flicker** (OB-053): http://localhost:8000/game/index.html?at=1481.85,1024.30,2.40,104,-24 ->good
- [ ] **Ropes on the drape** (OB-098): http://localhost:8000/game/index.html?pose=stairs ->good
- [ ] **Use markers + compass show** (OB-093): any spot near an interactable, e.g. http://localhost:8000/game/index.html?pose=burl -> good
- [ ] **Horizon doesn't flicker, rocks don't crawl** (OB-081/085): walk around http://localhost:8000/game/index.html?pose=hillside -> good
- [ ] **No dark navy far trees** (OB-089/061): http://localhost:8000/game/index.html?pose=roadSouth -> still bad.. LOD for dark trees and buildings should be closer
- [ ] **Ford water** (OB-090/062/045): http://localhost:8000/game/index.html?pose=fordDetail ->
- [ ] **Forest slope tower -> river less cluttered** (OB-091): walk down from http://localhost:8000/game/index.html?pose=towerExterior ->
- [ ] **City silhouette gone** (OB-046): http://localhost:8000/game/index.html?pose=meadowSea -> done
- [ ] **Continue loads the last save + keeps the tracked quest** (OB-079/087): on the walk (section 2). ->
- [ ] **Grass: blades not squares, big meadow field around the tower, grass visible further out** (OB-101/102/103):  better http://localhost:8000/game/index.html?pose=meadowDetail&carpet=1 -> **wait for the main session to say "repo updated"**: the far-grass fix (OB-103a) was pushed from the desktop and is not in this folder yet ->

## 4. Looks to OK (PO already OK'd them; they need your eye)
- [ ] Items / Character window, quick bar, bow aim, journal tabs (EQ-03/07/09/12, QL-03): on the gear walk. ->
- [ ] Mountains + skyline, lake/marsh, leaves (MAP-02/03/05/09): http://localhost:8000/game/index.html?pose=lakeEdge and ?pose=meadowSea ->
- [ ] Rook's ruin (MAP-23) and the red-cap mushrooms / smoke plumes (MAP-25): on the walk (crossroads, east bank). ->
- [ ] Chart labels (MAP-28): open the chart on the walk. ->
- [ ] Day/night (DN-03): http://localhost:8000/game/index.html?pose=roadBend&time=20 ->
- [ ] Relay SOS pulse + knot (QL-06/07): on the walk (Bend relay). ->
- [ ] Animal models: http://localhost:8000/design/preview/otter.html , http://localhost:8000/design/preview/goat.html , http://localhost:8000/design/preview/heron.html , http://localhost:8000/design/preview/tortoise.html , http://localhost:8000/design/preview/black-bear.html , http://localhost:8000/design/preview/wolf.html ->
- [ ] **Sea monster (new, D-070):** http://localhost:8000/design/preview/seamonster.html - the serpent, its circle / rise / strike clips, views from a swimmer at 10/20/30 m ->
- [ ] Items + props: http://localhost:8000/design/preview/item-icons.html , http://localhost:8000/design/preview/voxel-props.html ->
- [ ] Character generator (hands that can grip OB-092, body shape OB-083, Mixamo export OB-070): http://localhost:8000/tools/chargen/index.html ->
- [ ] Kit character in the game next to Burl (OB-086): http://localhost:8000/game/index.html?pose=burl ->
- [ ] Editor (groups, delete assets, autosave OB-028/029/030): http://localhost:8000/tools/editor/index.html ->

## 5. Good to know
- **WebGPU is finished:** WG-4, WG-5 (WebGL2 dropped) and the editor on WebGPU are all done. Browsers without WebGPU get a "WebGPU required" screen.
- **Swimming is in (D-070):** swim + dive, stamina + drowning, and a sea monster kills you if you swim too far from the Long Strand. Waiting on your river-gate answer before the PO and architect start.
- **Running now:** an architect batch review of ~100 rows still marked "arch-review" (report: docs/test-reports/batch-review-2026-10-13-pcb.md when done).
- **Docs lag the code:** the janitor found ~280 rows whose status is out of date. The milestone picture: M4 ~90 % (waits on your walks), M5 ~25-30 %, M6 not started.
- **Far grass OB-103a is merged** (desktop session, night 3); this laptop folder gets it when the main session updates (after the architect batch).
- **4 agents working today:** kestrel-1 Burl home talk (errands at Burl's home), kestrel-2 lights 16 -> 24 (lamps going dark), kestrel-3 Continue save mismatch, kestrel-4 walk-gate script fix.
