# D-069 stories: black bear (BEAR-01 rewrite) + fireball from Burl

Source: docs/decisions.md D-069 (owner 2026-10-12), D-065, sprint-4 BEAR-01, quest-roadmap.md section 3. PC-B PO, sonnet. Status of all rows: todo.

Code facts (names only): the dev flag is `?fireball=1` (not `?magic=1`): `game/js/quest/features.js` (`FEATURES.fireball`), used in `game/js/main.js` (~l.1427 `createFireballSim(... enabled: FEATURES.fireball)`, ~l.1995 `fireball.step`, ~l.2366 `drawVitals(... FEATURES.fireball)` = MP bar). Modules: `game/js/quest/sim/fireball.js`, `fireballView.js`, `handFireView.js`, `spellHandView.js`, `spellConfig.js`, `vitalsView.js`, `sim/hands.js` (`spell.fireball`), `sim/inventory.js`. Burl quests in quest-roadmap.md: burl.boars (band 1), sq.burl.blue, sq.tm.nub (1), sq.ew.nub (2), sq.ew.lessons (3, kill 4 wolves, reward gear T2), sq.ls.salt (4, "Salt for a Bear", reward potion), sq.sg.burl (8).

## BEAR-D1 Black bear recolour (designer, ~0.5 d)  [PC-B] [slot: designer, no main.js]
Files: `design/models/voxel_bear_black.js` (variant of `voxel_bear.js`, same voxels/clips/rig), `design/palette.js` (append rows only), `design/preview/` page.
- [ ] Black bear = near-black fur (dark ramp, lit side reads blue-grey, never pure black), tan/light-brown muzzle patch, small pale chest blaze optional. Clearly different from Burl's brown at 20 m, 240x90.
- [ ] Same clips as `voxel_bear` (idle, walk, run/charge, rear-up, swipe, hit, death). Any missing clip is listed in the preview page, not invented. Slightly larger than Burl's model is allowed (scale <= 1.15) so Burl stays readable as "the" bear.
- [ ] Preview shows both bears side by side under day and dusk light; node content validation passes (`validate-content`).
- Deps: none. Blocks BEAR-01.

## BEAR-01 Black bear beast (kestrel-1 after CL-01, ~1 d)  [PC-B] [slot: kestrel-1 (main.js owner)]
Files: beast kinds/spawn table in `game/js/quest/` (kind `bear`, next to boar), `game/js/main.js` (registration only, small), asset registry entry for `voxel_bear_black`, a Node test under `game/js/quest/sim/`.
Replaces the sprint-4 text: owner chose the BLACK bear (D-069). Realistic, 4 legs, tier 2, band 6-7. Burl stays brown and friendly; no black bear is ever named or talks.
- [ ] Uses `voxel_bear_black` from BEAR-D1 (fallback while D1 is open: the brown model with a tint is NOT allowed; wait for D1).
- [ ] Behaviour (kept): solitary, wanders slowly; aggro at 12 m, 25 m when hit; straight-line charge with a 0.8 s rear-up telegraph; swipe 2 hearts; HP = 3x boar; does not chase past 30 m from home; shield block stops the swipe at the cost of a 0.4 s stagger; an arrow does not interrupt the charge.
- [ ] Spawns: 2 anchors at the nearest walkable band-6 spot; if none is open, the Outwall north edge with `tier: 2`, recorded as a temporary spot.
- [ ] AC1 Node, seeded: telegraph always >= 0.8 s before damage; block gives 0 damage + stagger; leash works; 0 alloc per step; tier applied once.
- [ ] AC2 kill event + corpse loot go through the boar path (QL-22 hunt can count `bear`).
- [ ] AC3 one browser pass: telegraph reads at 10 m at 240x90; no bear stuck in the palisade; black fur is readable at dusk.
- Deps: BEAR-D1, CL-01. Owner Q1 of sprint 4 is answered (black bear).

## FB-01 Fireball unlock path (kestrel-1, ~1 d)  [PC-B] [slot: kestrel-1 (main.js owner)]  ARCH-NOTE NEEDED (small, opus)
Files: `game/js/quest/features.js`, `game/js/main.js` (fireball sim wiring ~l.1427, step ~l.1995, `drawVitals` ~l.2366), `game/js/quest/sim/fireball.js` (enabled getter), the save module (state flags), `vitalsView.js`, Node test `game/js/quest/sim/fireballUnlock.test.js`.
- [ ] A persisted flag `magic.fireball` (default false). `FEATURES.fireball` stays the dev override: `?fireball=1` forces on; otherwise on only when the flag is set. The flag is read live (a getter), not captured once at boot, so the unlock works mid-session without reload.
- [ ] A function `unlockFireball()` sets the flag, emits one event (`magic.unlocked`), and is the only writer; quest rewards call it through the reward table (reward kind `unlock:fireball`).
- [ ] Before unlock: no fist-charge cast, no fireball hand fire view, no MP bar, no mana potion in quick-bar pickers, no spell slot in the Character/Items tabs. After unlock: all of these appear in the same frame.
- [ ] Save / Continue keeps the flag; an old save without it loads as locked; a new game starts locked. MP value (max, current) is saved after unlock.
- [ ] Node tests: locked = cast does nothing and spends 0 MP; unlock then cast works; save round-trip; 0 alloc per frame in the locked path.
- Deps: none. Needed by FB-02, FB-03. Architect checks (ARCH-NOTE short): getter vs boot-time capture, where the flag lives in the save schema (versioning), 0-alloc HUD branch, that `engine/` is untouched.

## FB-02 Burl's fireball quest (kestrel-3 or free slot, ~0.5-1 d)  [PC-B] [slot: kestrel-3 (quest data; main.js only if a new reward kind needs wiring, then ask k1)]
Files: quest data (template file under `game/js/quest/` / the QL table), `docs/quest-roadmap.md` (one row), `docs/story.md` keys (writer), quest-sim test.
Placement: band 5 (end of this side of the river, D-067), AFTER `sq.ew.lessons` (band 3, wolves) and `sq.ls.salt` (band 4, salt for Burl) so the chain reads "she taught Nub, you brought her salt, now she teaches you". New id `sq.burl.fire`, title working "Burl's Spark" (name is the writer's), giver Burl at her berry slope (she returned there, owner answer 1 of 2026-10-11), prereq `sq.ls.salt`. Template: fetch + show (1 item) then a short demonstration: collect 3 "ember-pods"/sparks from a named site in band 5 (writer picks the thing; it is a berry/plant or a warm stone, NOT called magic, answer 3 of 10-11 only applies to the crystal) and return. Reward: `unlock:fireball` (FB-01) + 1 mana potion.
- [ ] Quest registered in the data-driven pipeline, passes quest-sim (reachable, completable, no dead end) and the giver '!' / '?' flow shows over Burl.
- [ ] Reward calls `unlockFireball()` once; re-accepting or reload never double-gives; the reward popup names the spell.
- [ ] Gated to player level 5 equivalent (band 5 zone; no XP, so gate = prereq quest done); not offered earlier.
- [ ] All dialogue is keys only, with NEEDS WRITER stubs: `burl.fire.offer`, `burl.fire.remind`, `burl.fire.turnin`, `burl.fire.reward` (4 lines max each, warm, "sky-cub"), plus journal title/objective `ql.burl.fire.title`, `ql.burl.fire.obj1`, `ql.burl.fire.obj2`. Stub text is placeholder and flagged `NEEDS WRITER` in `docs/story.md`.
- [ ] The collect site exists in band 5 and is walkable (named in the PO row after the map check; if none, record a temporary spot).
- Deps: FB-01, `sq.ls.salt` built (QL), writer lines.

## FB-03 Fireball tutorial hint + owner look (kestrel-1 or 2, ~0.5 d)  [PC-B] [slot: kestrel-2 (UI/hint text; main.js only for the hint call)]
Files: hint system (`use-hints`), `game/js/quest/vitalsView.js`, `fireballView.js`, `handFireView.js`, hint keys.
- [ ] On unlock: one on-screen hint, shown once per save: how to cast (hold fist = charge, release = throw; use the real binding text, not hard-coded) and that it costs MP. Key `hint.fireball.cast` (NEEDS WRITER, max 2 lines). A second hint on first MP-empty fizzle, `hint.fireball.nomp`.
- [ ] MP bar fades in on unlock (0.6 s), uses the existing style at 240x90 without moving the heart row.
- [ ] Owner look: headless stills of the cast, the flight, the explosion and the lit surroundings (dynamic light) at dusk, saved for the owner walk; the owner is asked to check the feel (charge time, MP cost, damage vs boar/wolf/black bear). Numbers stay in `spellConfig.js`, tunable.
- [ ] No regression: shield, bow and sword work with the spell unlocked; mana potion drinkable from the quick bar only after unlock.
- Deps: FB-01, FB-02 (for the real flow; can be tested early with `?fireball=1`).

## Order
BEAR-D1 -> BEAR-01 (k1 after CL-01). FB-01 (k1) -> FB-02 (k3) -> FB-03 (k2). Writer: Burl lines + 2 hints can run in parallel. Architect: one short opus note for FB-01 only; FB-02/03 are content/UI and skip the architect.

## Owner questions
1. Fireball scope: should it hurt only enemies (yes by default) and can it light dark spots / burn bushes later? Default: enemies only for now.
2. Quest feel: is "Burl shows you" (fetch 3 warm things, no fight) right, or should she want a fight first (e.g. 2 black bears) before she gives the spell? Default: no fight, since black bears are band 6-7, after the spell.
3. Magic in the story: Burl may call it "fire" and never "magic", in line with the crystal rule. Keep that wording rule?
