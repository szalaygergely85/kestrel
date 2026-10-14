# Owner walk-test 2026-10-14 (PC-B) - one checklist

Sources: backlog handoff blocks "LATE" and "LATER", lane entries 2026-10-14 (pc-b1 / pc-b2), D-103, story.md (Bram + wardens). Nothing here is PO OK; it is a list of what needs your eyes. Note findings as OB-NNN in docs/bugs.md.

## A. Start-up
- [ ] Use a NEW GAME for the first pass (content now wins on load, so old saves may show old quest state).
- [ ] Then Continue once from that save: quest state, pack, position all restored (QFIX-S6/S6b, SWIM-SAVE-01).
- [ ] Know the URL flags, add one at a time to compare against the default look:
  - `?legik=0` animal leg solve off | `?animblend=0` walk/run blend off | `?lookat=0` head look-at off | `?footik=0` foot IK off
  - `?post=0` post presets off | `?atmos=0` biome atmosphere off | `?gi=0` bounce light off | `?look=0` ground look off
  - `?dev=1` shows beast state labels over animals (idle / chase / wade / stuck).
- [ ] Default look is smooth: no flicker on the ground, no pop when turning (look-flicker test passed headless).

## B. Route in play order
Start: tower.
- [ ] Tower: interior has no sprites, only voxels. Good = clean walls, no floating items. Note any '?' sitting inside a wall.
- [ ] Burl (on a hill): his '!' moves to a '?' once he hands over the road step. Good = Burl stands on the ground, not floating.
- [ ] Walk, then run: the blend is smooth, no snap in stride. Compare `?animblend=0`.
- [ ] Boar windup (OB-150): swing at a boar 2 m away, also downhill. Good = readable windup, hit lands, no whiff at point blank.
- [ ] Ground look (now live, D-079): grass/ground has depth, no shimmer while walking. Note anything too noisy.
- [ ] Road west: lamps, atmosphere (`?atmos=0` to compare), mist is off outdoors. Good = clear air, calm clouds.
- [ ] Bend waystone: the '?' sits above the stone, not inside it (OB-164). Gold marks = main quest, blue = side.
- [ ] Post-keeper Bram: hello line "I'm Bram. I keep the post." Good = name shows, he gives the errands, hand-in lines read right.
- [ ] Ford waystone (OB-165): hint is about the glass from Rook's nest, not "Cold stone. Your hands are not enough."
- [ ] Ford: beasts now wade shallow water (under 0.6 m) and may cross; with `?dev=1` see the wade label. Good = they use stones or road first, deeper water still blocks them.
- [ ] Ford stones are the only crossing for you; check you can cross without getting stuck or swimming.
- [ ] Rook ruin: beasts can walk the ruin floors (stairs, upper floor), and chests are no longer on roofs (OB-152). Good = no beast stuck at stairs.
- [ ] Rook perch: you can reach it, hand-in works; his lines are the new writer text, not placeholders.
- [ ] Farm ambush (sq.he.farm): the goblins appear from the logic trigger once, not on every pass. Note the area and timing (this is open owner question 1).
- [ ] Outwall / Hesk: Hesk's new lines, no placeholders; gate and ford photos at docs/test-reports/m5s1/ for comparison.
- [ ] Region warden (pick one, e.g. Lin at Glasswater): hello line "Lin. I keep this waystone. The water keeps me." plays, errand opens and returns.
- [ ] Wolves (northwood, signalHill) look like wolves, not boars (BEAST-02), and a bear/fox/deer if you meet one walks on four legs with bending knees.
- [ ] Swim: save while swimming, reload, you are not stuck (SWIM-SAVE-01).

## C. Previews to open (serve the repo, open under /design/preview/)
- [ ] `voxel_bear.html` - knee seams: no gaps at the joint while walking.
- [ ] `black-bear.html` - knee seams.
- [ ] `wolf.html` - knee seams, gait (run clip tuned slower; legs cycle faster at chase speed).
- [ ] `wildlife.html` (fox, deer, rabbit walk) - knee seams, gait.
- [ ] `goat.html` - knee seams.
- [ ] `heron.html` - leg joint, no tearing.
- [ ] `goblin.html` - knee seams (walk, run, torch).
- [ ] `bear-cub.html` - cub walk (planted feet).
- [ ] `animal-look-options.html` - still the look you picked (D-101).
- [ ] `post.html` - the post presets; pick the one you like and say which.
- [ ] `material-response.html` - make its 7 picks (matte hard, matte soft, shiny, wet, metal, metal blade, glowing) + say if rain/wet weather is wanted soon.

## D. Editor checks (one small task each)
- [ ] Quests tab: open a quest, rename one step line, save, reload; it persists.
- [ ] Foliage tool: paint a few trees/grass with the brush, undo once. Note the triangle cap message if you hit it.
- [ ] Creatures tab: change a boar's HP or speed while the game is open; the game changes live (BroadcastChannel patch).
- [ ] Creatures tab: paint a spawn area and see it appear after reload.
- [ ] Logic tab: open the farm ambush block (When -> If -> Do); with no blocks the game must behave as before.

## E. Open owner decisions (one line each; your answer or "OK as is")
- [ ] Names: post-keeper Bram + 10 wardens (Lin, Brenna, Ewan, Tull, Edda, Ivo, Nell, Orla, Kit, Sten) - OK?
- [ ] GI-Q1: commit the baked bounce-light files (about 5 MB, ~1 MB per zone) to git, or keep them gitignored and bake locally?
- [ ] Mist outdoors stays OFF - OK?
- [ ] Ford wading ON for beasts and NPCs (D-103 item 4) - OK?
- [ ] Ford stones as the only crossing for the player (D-103) - OK?
- [ ] Region name: Heath vs Shearcliffs - which is the final name?
- [ ] Rain / wet look: keep as is, or tune after you see it?
- [ ] Waypoint marks removed on main steps with no hand-in (compass only) - OK, or bring marks back?
- [ ] Post-keeper takes all 12 bend/ford errands, and the Bend waystone is about 270 m away - OK, or add a second NPC?
- [ ] Foliage triangle cap 1.5 M is a guess - raise, lower, or keep?
- [ ] First logic ambush: farm ambush (D-103 default) - confirm quest, area, and gate model.
- [ ] Nav floors: "both bridges" question - one bridge or both usable by beasts?
- [ ] ANIM-IK-01 stays player-only (animals use the runtime leg solve, D-101 C) - OK?
- [ ] Armour naming Watch vs Relay (story.md option A is Watch) - OK?

## F. New since this list was written (2026-10-15, pc-b 0b5df6d5)
- [ ] **Boot:** the game starts without errors. pc-b 45706a14 and earlier threw every frame at boot (foot IK); if the owner tree on 8000 was on that, hard-reload now.
- [ ] **Black bear bite:** at close range (< 1.6 m) the black bear sometimes lunge-bites instead of the swipe: jaws snap ~0.2 s in, 2 hearts, then it backs off (recover). At most one bite every 3 s. Burl (friendly) never bites.
- [ ] **Bear clips:** both bears run, flinch when hit (small additive jolt) and play hurt; black bear has a recover huff after a charge.
- [ ] **NPC look-at:** a character-kit NPC turns its head to you while you talk to it (limits 60 deg left/right, 25 deg up/down) and turns back after; nobody else's head moves. Flag: `?lookat=0` to compare.
- [ ] **Deer / fox / goat:** head, ears, tail and bob move in step with the legs (no drifting out of sync while walking/running).
- [ ] **Item names:** the top two gear tiers are now "Elite ..." and "Warden ..." (was "T4 ..." / "T5 ..."). OK, or other names? (max 14 letters with the item word)
- [ ] **Ford chests:** the two ford boars stand a few metres closer to Rook's chest (974, 1058) so the chest is guarded. Fight feels fair? Boars not stuck on rocks?
- [ ] **Lake-bed chest** still opens only by diving; nothing else changed there.
- [ ] **Crocodile preview** (`/design/preview/crocodile.html`): shape (2.9 m, 4 sprawled legs, 3-part tail), olive hide colours, clips idle/walk/run/swim/attack/grab/hurt/die/sink. OK? Should it float with eyes + nostrils above the water (designer: 0.30 m deep instead of 0.4)?
- [ ] **Crocodiles in the world:** NOT in this build yet (spawns at ford/river are being made). When they are: 0.7 s warning, lunge up to 4 m, grab 1.5 s (max 12 % HP), mash move/jump keys to break free early; while grabbed you can still look and attack but not walk.
- [ ] **Editor (`/tools/editor/`):** (1) Foliage tab budget line follows the cap in content/editor/foliage.json (`triCap`, default 1.5 M) - change it and reload to see. (2) Edit a quest's text with a game tab open from the editor's play-test: re-talk to the NPC shows the new text without reload, and it is NOT saved.
