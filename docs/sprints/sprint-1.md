# Sprint 1 (planned 2026-09-24, D-020)

Owner: Manager (scope), Product Owner (stories/acceptance).

## Goal
**A first-time player can finish the tower and knows it's the end.** They see the vista from the breach, recognise and use the props (lever findable, props solid and fixed in the world), and the end card reads as "end of chapter one", not a respawn.

## Stories (in order)
| # | ID | Story | Owner | Type / gate | Notes |
|---|---|---|---|---|---|
| 1 | US-016 | Finish: GPU terrain march (pass A2) + horizon billboards | Programmer (architect in progress) | Engine: ARCH review -> PO -> tester | Closes BUG-OWN-004 (1). Gap 1. |
| 2 | US-040 | GPU voxel pass A3 + gpucompare (lever + burner poses) | Programmer | Engine: tech notes 15.2, ARCH review | D-019 gate: gpucompare + <= 0.5 ms p95 after one fix round, else fallback (b) (see below). |
| 3 | US-041a | Voxel props: rotated normals, `voxel` binding, lever pull, mounts | Programmer | Engine: tech notes 15.3, ARCH review | Designer supplies the lever voxel with parts. |
| 4 | US-056 | M1 voxel prop swap + owner walk-check | Designer (models) + Programmer (registry wiring) + PO | Content: PO review, owner walk-check | PO writes the ACs. Closes OWN-REQ-001 + ART-OWN-001; the walk-check decides on BUG-OWN-003 slim. |
| 5 | BUG-OWN-005 | End card text + one-time summit hint | Designer (`uiStyle.endText`, `tower.js` hint) + writer polish | Content: PO review -> tester | ACs in the backlog row 25j. No walk-on in M1 (D-020). It doesn't depend on 1-4, so it can run in parallel. The tester's vista AC waits for US-016. |
| 6 | US-018 | Perf budget + F3 overlay (**stretch**) | Programmer | Engine | Only if 1-4 are done. Otherwise it's the first story of sprint 2. |

Parallel, not a sprint story: ART-OWN-001 voxel prop art (designer) runs alongside US-040/041a.

**Fallback:** if US-040 hits the D-019 gate, stories 3-4 become the billboard fill/outline + fixed-yaw work (BUG-OWN-003 full + ART-OWN-001 billboards). The goal stays the same.

## Exit = owner walk-test
The owner plays one real run with mouse + keyboard on the default grid (240x90): wake -> lamp -> boulder -> lever -> grate -> summit -> hint -> end card -> `R` -> second run. Pass when:
- the vista fills the breach view when the ending fires;
- the owner can find the lever and recognise the props without help;
- the owner reads the ending as "end of chapter one";
- `R` restarts cleanly;
- no stutter the owner notices;
- the owner finds the lamp and knows the goal is the top *before* the map card opens;
- the owner notices the grate opened after the lever pull, without help.

"Recognises the props" = the owner names lever, burner, lamp, boulder, relay unprompted. Fail path: content-only fixes (hints, text, art) are done in this sprint and the run is repeated; engine fixes go first into sprint 2 and the sprint closes as "goal not met".

During the same run the owner also says whether 240x90 is readable (gap 7; if not, a US-038 grid slice goes into sprint 2). The tester confirms there's no gap in the parapet/breach to fall out of (gap 10; file a bug if there is one).

## Review (Fable, 2026-09-24)
**Verdict: good with changes.** The five stories are the right ones for the goal and the order follows the pass-slot dependency (A2 before A3) and the D-019 risk. Changes:

1. **Start US-040 when US-016 enters ARCH review, not when it is `done`.** Three sequential engine stories with reviews is the whole sprint; the gate result must not arrive on the last day. Second programmer track allowed (CLAUDE.md), shader/pass files coordinated by the architect.
2. **Gate checkpoint made explicit.** The D-019 gate is decided at US-040's second ARCH review at the latest. If US-040 has not reached its *first* ARCH review by the time US-016 is `done`, the manager re-checks the sprint (fallback (b) is itself ~1 engine story: 7.7 `fill` + a fixed-yaw billboard flag, and the interim billboard art from ART-OWN-001 already exists, so the fallback is realistic only if triggered by mid-sprint).
3. **US-041a de-scope option, not a split:** if late, the lever pull ships as two static ModelDefs (up/down swap, no rigid-part animation) and the rigid-part work moves to sprint 2. Rotated normals, `voxel` binding, mounts (light anchor + E-prompt) stay: without them the props are not lit or interactable.
4. **BUG-OWN-005 gains one AC (PO wording):** a one-time hint on the lever pull that points at the grate (e.g. `Something rattles above.`), because the grate opens 1.5 s later and may be out of view (gap 4; sound is sprint 2). Cheapest in-sprint cause-and-effect fix, same file as the summit hint. The tester's parapet/breach gap check (gap 10) is attached to this story's test pass.
5. **Exit walk-test tightened.** Add two pass lines: the owner finds the lamp and knows the goal is the top *before* the map card opens (gap 6); the owner notices the grate opened after the pull without help (gap 4). "Recognise the props" = the owner names lever, burner, lamp, boulder, relay unprompted. **If the walk-test fails:** the PO files BUG-OWN rows; content-only fixes (hints, text, art) are done in this sprint and the run is repeated; engine fixes go first into sprint 2 and the sprint closes as "goal not met". The US-056 walk-check and the exit walk-test may be merged into one owner session if US-056 is the last story to land.

Nothing is missing that would make the goal unreachable; sound (sprint 2) is the biggest remaining feel gap, correctly out.

## Sprint 2 candidates
Minimal sound slice (P1 per D-020: lever, gear, grate, boulder, footsteps; PO carves it out of US-020), US-022 relay wake (P1), BUG-OWN-003 slim (only if the US-056 walk-check needs it), US-018 (if not done), US-038 grid slice (if the owner finds 240x90 unreadable), paperwork closes for US-029/US-024.

## Later (not in M1)
- **Owner story + progression idea** (`docs/owner-ideas/2026-09-24-story-and-progression.md`): crash intro animation, vanished loved one + SOS hook, no XP (gear levels, magic from beacons/wells/quests with a small skill tree, bow), trading, crafting, animals/monsters/plants, biomes. Writer + PO fold it into the GDD (story section 3 + a new progression section). The manager adds it to roadmap M2+ (D-020). The crash intro isn't added to M1.
- Walk-out through the breach onto real terrain replaces the end trigger in M2 (US-026, D-020).

## Owner exit walk-test (2026-09-25)
After US-056 (commit 995cc57), port 8000, default grid 240x90: owner played the tower and reported **"tested and all working"** (props recognisable and fixed in the world, lamp/boulder/lever/grate/summit/end card/restart all OK). Earlier the same day: lamp pickup + carried light OK, but the carried light goes dark next to walls (BUG-OWN-007, filed); unlit lamp on the hook is by design (glint restored in ART-OWN-002). Real-GPU: 60 fps at the summit at 240x90 and 320x120 (BUG-OWN-006 -> watch).

## Review (PO, 2026-09-25)
**Goal met** (owner exit walk-test passed).
- **Done:** US-016, US-040, US-041a, US-056 (PO OK, owner walk-test replaces tester), BUG-OWN-005 (done). Closed with US-056: OWN-REQ-001, ART-OWN-001, ART-OWN-002; BUG-OWN-003 slim closed as not needed (nothing see-through).
- **Not done:** US-018 (stretch, not started -> first sprint-2 candidate).
- **Bugs found today:** BUG-GPU-003 (3 gpucompare wall-vs-ceiling fails, pre-existing), BUG-OWN-007 (carried lamp dark next to walls, P1 todo), BUG-OWN-006 (30 fps not reproduced -> watch).
- **New owner requests:** OWN-REQ-004 content data files strategy (25q), OWN-REQ-005 `.vox` importer (25r).

### Missing to be playable
1. Sound (lever, gear, grate, boulder, footsteps) - biggest feel gap.
2. No combat or enemy yet (sword + one enemy type is the next vertical-slice step).
3. No hearts/items UI or damage/death loop.
4. Ends at the breach: no walk-out onto real terrain (US-026, M2; terrain too coarse, OWN-REQ-002).
5. Perf overlay/budget (US-018) and UI size tied to the grid (OWN-REQ-003); BUG-OWN-007 lamp near walls.
