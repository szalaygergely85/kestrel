# Sprint 2 (planned 2026-09-25, D-022)

Owner: Manager (scope), Product Owner (stories/acceptance).

## Goal
**The tower slice feels finished and M1 closes: it sounds right, the lamp and relay work, and it runs and reads right at every grid.**

## Stories (in order)
| # | ID | Story | Owner | Type / gate | Notes |
|---|---|---|---|---|---|
| 1 | BUG-OWN-007 | Carried lamp dark next to walls | Architect (opus, confirm fix idea in 5 lines) -> Programmer | Engine bug: ARCH review (opus) -> main session verifies, no PO (pure engine bug) | Clamp the attached light to the last free point on the eye->offset segment; JS/GPU parity unchanged. Node test: light inside a wall cell never yields an all-occluded vis grid. |
| 2 | US-020a | Minimal sound slice: lever clunk, gear ratchet, grate rattle, boulder thud, footsteps (procedural WebAudio, D-020) | PO (carves it out of US-020, writes ACs) -> Programmer | Game story (`game/js/audio/`, hooks existing engine flags/events: `landed`, `stepDelta`, `world:sectorAnimDone`, `roller:rest`) -> PO -> tester | `N` = mute. If a new engine event is needed, ASK ARCHITECT (opus), no new engine module. |
| 3 | US-022 | Wake the relay with the lamp (optional beat, D-003) | PO (ACs refresh) -> Programmer | Content/game story -> PO -> tester (merged with #2 test pass) | Level data, `mounts.glow`, `lights.beacon` and alt end line already exist. Adds a relay hum to #2 if cheap. |
| 4 | BUG-GPU-003 | 3 gpucompare wall-vs-ceiling FAILs (pre-existing) | Architect (opus diagnosis: which path is right) -> Programmer | Engine bug: ARCH review (opus) -> main session verifies `?gpucompare=1` 27/27 | Must land before #5 so M1 closes with an all-pass oracle. |
| 5 | US-018 | Perf budget (JS 8 ms + GPU 4 ms) + grid setting 160x60..320x120 + F3 overlay | Architect notes -> Programmer | Engine: ARCH review -> PO -> main session perf pass | Last M1 P0. BUG-OWN-006 stays `watch`; overlay shows fps, JS ms, GPU ms per pass. |
| 6 | OWN-REQ-003 | UI at a fixed readable size, independent of the glyph grid | Architect proposal + notes -> Programmer | Engine (ui/presenter): ARCH review -> PO -> tester | **Stretch.** Pairs with #5's grid setting. If late, first story of sprint 3. |

**Parallel decision track (not a story, no code):** OWN-REQ-004 content data-files strategy. Architect (opus) writes a short proposal in `docs/architecture.md` (JSON vs JS, per-level/per-chunk files, stable ids + schema version + migration, placement files, editor read/write, save vs content format, `.vox` import target for OWN-REQ-005) in a slot between #3 and #4 when no programmer is running. Manager decides (D-023) before sprint close. It gates M1.5 editor work and OWN-REQ-005.

## Two-PC split
The owner now runs two main sessions in parallel (one per PC). Split so the two tracks don't touch the same files; both still commit to `master` in the same repo (main session sequences the merge/pull).

| Story | PC | Main files / folders | Order |
|---|---|---|---|
| BUG-OWN-007 | PC-A | `engine/render/lighting.js`, `engine/render/lighting.test.js` | already `testing`; only needs main-session verification, no new dev work |
| BUG-GPU-003 | PC-A | sector caster: `engine/render/*Caster*.js` (CPU) + `engine/render/gpu/glsl/*.frag.js` (wall/ceiling pitch-40 path), `game/js/main.js` gpucompare poses | go first on PC-A (must land before US-018 per sprint goal) |
| US-018 | PC-A | `engine/core/` (perf timers), `game/js/ui/` (F3 overlay), `game/js/main.js` (grid setting), `engine/render/gpu/*` | after BUG-GPU-003 |
| OWN-REQ-003 | PC-A | `engine/ui/` (panel/richText/presenter), `game/js/ui/*` | stretch, after US-018; touches the same `game/js/ui/*` files US-018's overlay adds - PC-A does US-018 first so OWN-REQ-003 doesn't rebase around it |
| OWN-REQ-004 | PC-A | `docs/architecture.md` only (proposal, no code) | fits in the PC-A queue whenever no programmer is running on that track; docs-only so it never conflicts with PC-B |
| US-020a | PC-B | new `game/js/audio/*`, hooks into existing events (`landed`, `stepDelta`, `world:sectorAnimDone`, `roller:rest`) - no engine module unless ASK ARCHITECT says otherwise | first on PC-B |
| US-022 | PC-B | `design/levels/tower.js` (mounts.glow/lights.beacon already exist), `game/js/quest/*`, rides on US-020a's sound hooks | after US-020a (adds the relay hum "if cheap") |
| OWN-REQ-006 | PC-B | `design/levels/tower.js` lights list, `game/js/quest/lantern.js` (`lanternTake` switch-off), `design/models/title.js` copy | can run before or after US-020a/US-022; small, do it whenever US-022 is blocked/waiting |

**Shared-file risk:** `game/js/main.js` is touched by both tracks (PC-A for the grid setting/overlay wiring, PC-B for quest hooks in `US-022`) - low collision risk since the edits land in different functions, but whichever PC finishes a story touching it should pull/rebase before the other starts theirs; PC-A's US-018 is expected to land first (it's earlier in the sprint order) so PC-B rebases onto it once merged. No other shared files between the two tracks (PC-A stays in `engine/render*`+`engine/ui`+`engine/core`, PC-B stays in `design/levels`, `design/models`, `game/js/audio`, `game/js/quest`). Neither track touches `design/palette.js`/`detail-pass.js` this sprint.

**Paperwork (main session, no agent):** BUG-OWN-004 `testing` -> verify `?gpu=0` breach shows hills -> `done`; US-029/US-024 closes.

**Not in this sprint:** object physics (US-051a/b, US-052: owner-required before release, D-018) and US-026 walk-out start **sprint 3** (M2 opener), once M1 is closed and OWN-REQ-004 is decided. OWN-REQ-002 finer terrain goes with US-026. US-041b/OWN-REQ-005 after D-023.

## Exit = owner walk-test
The owner plays one full run at 240x90, then switches to 320x120 via the grid setting and plays the summit again. Pass when:
- the owner hears lever, gear, grate, boulder and footsteps without asking, and `N` mutes;
- the carried lamp lights the wall when standing right against it;
- the relay can be woken with the lamp and the end card shows the relay-woken line; the slice is still finishable without it;
- F3 shows 60 fps and JS <= 8 ms / GPU <= 4 ms at 240x90 on the owner's laptop (plugged in, energy saver off);
- (if #6 landed) hints, prompt, map card and end card are the same readable size at 240x90 and 320x120;
- main session: `?gpucompare=1` all PASS, `node tools/check-deps.mjs` OK.

**M1 close:** with this walk-test passed and all P0 `done`, the remaining M1 exit criterion is a stranger run (finishes without instructions, without the lamp). The owner arranges it; the PO records it here. Fail path: content fixes in-sprint and re-run; engine fixes go first into sprint 3.

## Review (PO, 2026-09-25)
**Verdict: goal met.** The slice sounds right, the lamp and relay work, and it runs and reads right at every grid.
- **Done (backlog rows checked):** BUG-OWN-007 (owner verified), US-020a (PO OK + owner ear-check, incl. fix pass), US-022 (PO OK + owner walk-check), OWN-REQ-006 (PO OK + owner walk-check), BUG-GPU-003 (arch fix, owner real-GPU gpucompare 27/27), BUG-GPU-004 (arch fix, same 27/27 run), US-018 (ARCH OK, owner real-GPU bench binding ACs met at 240x90 + 320x120, PO OK on evidence), OWN-REQ-003 stretch (ARCH OK + owner UI check at 160/240/320).
- **Not done:** nothing planned is open. OWN-REQ-004 is a decision, not a story: D-023 (option B), work = US-027a/b in sprint 3.
- **Bugs found:** BUG-GPU-004 (light parity at the lit hook lamp, fixed in-sprint); BUG-PERF-001 (row 25w, P2): JS spikes under the 8 ms bar (`sim.quest` 4.5 ms PC-B, `sim.physics` 3.1 ms + `r.ui` ~1.2 ms/frame PC-A); ground-floor JS avg 2.27 ms misses the 2 ms target.
- **New owner requests:** OWN-REQ-007 (row 25v) player grids 240x90 / 320x120 / 400x150 / 480x180 ('ultra' if over 4 ms GPU), 160x60 dev-only; needs a manager note amending the US-018 grid AC.
- **Missing to be playable** (as a game, beyond the 5-minute slice):
  1. Leave the tower: US-026 walk-out (near LOD, slope physics); the end card is still the only exit.
  2. Combat core: sword, one enemy type, hearts/damage UI. None of these exist yet, and they are the core of the GDD loop.
  3. A small dungeon room with a puzzle outside the tower (the lever/grate is the only puzzle so far).
  4. Object physics (US-051a/b, US-052), which the owner requires before release.
  5. Settings panel (US-038a/b) incl. OWN-REQ-007 grids, remembered mute (US-060).
  6. Content pipeline D-023 (US-027a/b), which gates the editor and the `.vox` import.
  7. Finer terrain (OWN-REQ-002) and the rest of the sound (US-020b/c/d).
- **Owner walk-test:** done for this sprint's stories (below). Next owner walk-test at the end of sprint 3 (walk-out).

## Owner tests (2026-09-25)
- Owner walk/ear-check: US-022 relay wake, OWN-REQ-006 lit lamp, US-020a sound (incl. fix pass) - all fine -> done.
- **M1 exit: stranger test PASSED** (owner, 2026-09-25: someone new played the tower slice without instructions and finished it).
- Real-GPU: gpucompare 27/27 ALL PASS; bench 240x90 ALL PASS; 320x120 walk PASS, ground-floor view CHECK (render-side far-bake 4.1 ms in one frame) -> fix pending.
- Update (owner final run 320x120, after 5b3ccad): `r.bake` 4.10 -> 1.10 ms, fix confirmed; all binding US-018 ACs met (ground floor JS max 7.60 ms < 8 ms; the 2 ms target is BUG-PERF-001).
- **M1 exit check (PO, 2026-09-25):** every M1 P0 row is `done` with a PO OK / test record. Paperwork closed today: BUG-OWN-004, BUG-OWN-006 (not reproduced), BUG-GPU-004, BUG-GPU-003 (known-issues row), US-018 PO OK; story headings synced for US-006/024/029/030b/030c. US-040/041a/056 use the owner walk-test as the test record (D-019 amendment 1, sprint-1 review). Remaining before M1 is declared closed: merge `pc-a` + `pc-b` into `master`, then on master all Node suites + `node tools/check-deps.mjs` OK + `?gpucompare=1` all PASS (main session), then manager marks M1 done in roadmap.md.
