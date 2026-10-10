# PO batch review - PC-B owner-visible work, 2026-10-10 evening

(PC-B PO opus, owner request; PC-A to ratify.) Read-only review of `review-po` (= pc-b tip 7ba03936) in kestrel-1.
Sources: D-064 incl. the appended owner rules (docs/decisions.md 1102-1110), docs/test-reports/po-ch1-flow-2026-10-10.md,
lane logs docs/lanes/pc-b1.md 572-631 and pc-b2.md 498-505, and the code/data named below. No browser run and no shell in this
session (no test run). Checks are against code and data. Engine parts still need ARCH OK on PC-A where noted.

## REJECTs

### PO REJECT - DIALOGUE-LOCK-01 (never-lock)
The never-lock part is right: main.js:1014 `vLocked` no longer has dialogue/note/chapter card; `closeIfFar` 6.5 m (dialogueCtl.js:113);
the confirm edge is consumed (dialogueCtl.js:142). **But the choice keys collide with walking:** dialogueCtl.js:12
`UP_KEYS = ['KeyW','ArrowUp'], DOWN_KEYS = ['KeyS','ArrowDown']`. Movement is now live during a dialogue, so picking a choice
with W/S also walks the player (only the press edge is consumed, the held key still moves). The owner hits this at Burl's first
two choice nodes (`bear.meet.7`, `bear.q.offer.5`). Holding S walks out of the 6.5 m radius and closes the box mid-choice.
**Fix:** drop KeyW/KeyS from the choice keys and use ArrowUp/ArrowDown, the mouse wheel and Digit1..Digit4 (E confirms). Or, only
while a choice node is shown, take W/S away from movement for that frame. Show the keys in the box (`Up/Down or 1-2 choose, E
confirm`, no Esc hint). Add a dialogueCtl test: a choice node with W held moves the selection and the player position stays the same.

### PO REJECT - DN-03 (day = 2 real hours)
The clock is right: worldClock.js:4 `dayLenS: 7200`, step 1/480 h, saved in `clock.hour`, start 8 h, frozen in capture/bench/
`?pose`/`?at`. **But the clock runs by default (main.js:631-634), and the WebGPU path has no time-of-day reader:** DN-02 is not
done. There is no `liveLook`/`floorLum` in engine/render/gpu/**, and `passShade._bakeSky` is untouched (pc-b2.md:494). On the
owner's WebGPU default, about 50-60 real minutes into play the sun and ambient go to dusk/night under a daytime sky, with no
night luminance floor on the GPU. That is a visibly broken day/night.
**Fix (pick one):** (a) gate the running clock on the GPU path until DN-02 has ARCH OK: frozen at 8 h by default, opt in with
`?daylen=`; or (b) land DN-02 (+ DN-04b dusk/night gpucompare rows) before this goes to master or an owner walk.

## PO OK (24)
Conditions in brackets. "arch" means the engine part needs ARCH OK on PC-A before testing.
- **QUEST-CHAIN-GATE-01:** tower.blade.quest.json (giver noteKeepLight, turnIn bear), boars `requires done`, giverMarks
  ('!' available at the giver, '?' ready at turnIn), accepted quests never fall back.
- **QUEST-CHAIN-Q-01:** live area polling. The note '!' is set 0.55 m inside the wall (main.js:461 MARK_DY).
- **PO-CH1-01/04/07/08/09.** 01: sword accepts the blade (main.js:1818), `bear.blade.wait` has the writer text, and `bear.early` is
  reached only with no blade quest. 04: m1 q01-q03 `silent` (questRelay.js:42), toasts name the quest (main.js:1357). 07:
  `burlReopen` latch (1356/1753, within 6 m). 08: relay needs the meadow stone (relayWake.js:91), the card needs both woken flags
  (1352), Burl's goodbye opens by itself (burlEscort.js:53). 09: bladeFromMain adds towerDoor, plus the Burl-within-10 m net (1819).
- **MARK-GIVER-ONLY-01:** `OBJECTIVE_MARKS = false` (main.js:482). The compass covers area/flag steps (991-1006).
- **MARK-FOLLOW-01:** marks are re-resolved every tick (questMarks.js:57, no allocation).
- **QUEST-MARK-SLIM-01:** [palette/detail-pass/questMarks suites + preview LOD0 < 1500 tris were not run by the designer.
  Confirm run-tests is green.]
- **DOOR-TOGGLE-01 + DOOR-CLOSE-01:** starts closed, E Open/Close, refuses to close on the player, state saved and re-applied on
  load. [arch: World.rebuildPropColliders variant fallback + interaction.js:133 70 deg cone under 0.9 m]
- **BURL-WALK-ANIM-01:** clips go through EntityHandle.play (npcWalk.js:86) + test.
- **BEAR-DETAIL-01:** [LOD0 budget raised 2000 -> 2600 and `node tools/voxel-bear.test.mjs` was NOT RUN by the designer. It must
  pass, else fall back to FUR 0.6.]
- **FEN-OFF-01:** no Fen in world/content text, migration drops `fen`, journal line replaced (notes.js:63).
- **WAYSTONE-NOBOWL:** chipped top, mark-only states, light offset -1.75. [content/vox/waystone.vox is stale; check it is not
  loaded at runtime]
- **NOTE-FIRST-QUEST (keepLight):** note text sends the player up to the blade (notes.js:74-83); reading it accepts.
- **STEP-HEIGHT-01:** 'm' half-step 4.2 at the gap landing; tower.test adapted (356). [Owner walk must confirm this was HIS spot.
  step-probe still lists ~36 other 0.45-1.2 m pairs]
- **ROCK-SNAP-01:** resnap to the lowest footprint ground + sink.
- **ROCKS/STONES-VOXEL-OFF-01:** voxel rock/stone lists removed (overworld_far.js:120-122). Mesh rocks stay (fits D-064).
- **PLANT-SIZE-RANDOM-01:** +-20 % plants / +-25 % bushes, hashed per placement, bushes 0.85 x 1.6 m = 1.36 m.
  (Clover sits at the 0.25 floor, so it only ever grows. Acceptable.)
- **GS-01 (grass ring, d/e/f):** terrainFloor on `, ; l`, collider floors kept (GS-01f). [arch: GS-01a/b/c]
- **WALL-BRICK-01/02:** stone ashlar 0.4 x 0.25, 4 tones, mortar; rock facets with cracks. [owner look at lower walls + passage Q]
- **SKY-GLOW-SOFT-01** [arch] and **GLOW-TUNE-01** [arch]: halo thinner, dither instead of bands.
- **QUALITY-BOOT-01 / QUALITY-STALE-01:** pending boot grid applied at the top of update(), stale overrides dropped once.
  [owner browser check: Ultra saved -> reload]
- **NEWGAME-PAUSED-01:** relock after New/Continue/Load.
- **TITLE-LOAD-SUBMENU-01:** main card New/Continue/Load/Settings; slots + Delete in the Load card; no Esc hint (titleMenu.js:50).
- **DESKTOP-ZIP-01:** portable zip + README-PLAYER (README misses C = craft; add it).

## Still open from the PO-CH1 punch list (not part of this verdict; owner will notice)
- PO-CH1-10: the m1 `beasts` HUD text is still "Find the old bear on the hillside" while the player stands next to him. m1 has no
  `title`, so the J log shows `m1 (main)`.
- PO-CH1-12: the compass `giver` uses `w.get(id)` without MARK_ENT (main.js:994), so there is no compass at the start for the note.
- PO-CH1-13: the toast still says "A crystal glints where the boar fell." (main.js:1324), but the crystal is auto-added.
- PO-CH1-14: no `bear.wait` bark when the player runs ahead (barks.json has only call/walk1/walk2).
- PO-CH1-15: talking to Burl after the stone talk replays all 11 nodes (entry `bear.stone.1` has no told-variant).
- PO-CH1-17: dead Fen wiring (main.js:990 `fen.met`, 1336-1344).
- Owner questions:
  - The intro wake still locks input (`wakeOut.inputLocked`). Does "never lock ... wake effects" include the opening wake-up?
  - The chest item-get card locks input (main.js:1642). There is no chest in Chapter 1 yet.

## Owner walk checklist (Chapter 1, New game, WebGPU)
1. Title: main card shows New game / Continue / Load / Settings. Open Load: slots + Delete there only, Back returns. New game
   starts unpaused (no PAUSED card).
2. With Ultra saved, reload: the picture fills the window height and Ultra is not smaller than High.
3. Wake-up: a slim gold '!' sits over the nailed page on the wall (not inside the wall). Read it (E). The toast says
   "Quest accepted: A Blade in the Ashes", and you can walk and look while the page is open.
4. Climb. At the gap landing, the step-up you could not take before now works. Note any other step that still blocks you.
5. Summit: take the sword. No "Quest complete" toast here. Look at the tower walls: brick courses with mortar, near and from far.
6. Go down to the south-west door: it is closed. E opens it, E closes it, also when standing right at it. It never closes on you.
7. Outside: no '!' in the doorway. The grass reaches the tower foot with no seam or step. Hint "Someone hums on the hillside."
   A '?' hangs over Burl.
8. Talk to Burl. Walk away mid-talk: the box closes. Talk again. At "I'm going west." / "I'll clear the path." choose with the
   keys (watch whether you move: see the REJECT above). Toasts "Quest complete: A Blade in the Ashes" and then "Quest accepted:
   Boars in the Woods".
9. Burl's back/rump has more fur detail. Meadow: no voxel stones, mesh rocks sit on the ground (none float), bushes about chest
   high, plants of mixed sizes.
10. Kill the 5 boars (optionally before accepting, to see Burl reopen). A '?' appears over Burl. Hand in: a single "Quest complete:
    Boars in the Woods".
11. Follow Burl: he plays a walk animation (not a frozen pose), no mark over him, and you stay free to move.
12. At the waystone: no bowl on top. Burl says "Hold that crystal up to the carved mark." E wakes it (the mark lights). Burl's
    goodbye opens by itself.
13. Try the Bend Relay before the meadow stone (new save): "Cold stone." Then wake it in order. The chapter card shows at the
    relay, and the journal has no Fen line.
14. Glow: the '!' / crystal / crown glow is thin (one ring), and the sun halo has no bands.
15. Play about 60 min, or use `?daylen=10`: watch dusk. With the WebGPU sky stuck on day = the DN-03 REJECT.
16. Desktop zip: unzip, run "ASCII Quest.exe", and walk the first 3 steps.
