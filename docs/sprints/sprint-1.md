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
- no stutter the owner notices.

During the same run the owner also says whether 240x90 is readable (gap 7; if not, a US-038 grid slice goes into sprint 2). The tester confirms there's no gap in the parapet/breach to fall out of (gap 10; file a bug if there is one).

## Sprint 2 candidates
Minimal sound slice (P1 per D-020: lever, gear, grate, boulder, footsteps; PO carves it out of US-020), US-022 relay wake (P1), BUG-OWN-003 slim (only if the US-056 walk-check needs it), US-018 (if not done), US-038 grid slice (if the owner finds 240x90 unreadable), paperwork closes for US-029/US-024.

## Later (not in M1)
- **Owner story + progression idea** (`docs/owner-ideas/2026-09-24-story-and-progression.md`): crash intro animation, vanished loved one + SOS hook, no XP (gear levels, magic from beacons/wells/quests with a small skill tree, bow), trading, crafting, animals/monsters/plants, biomes. Writer + PO fold it into the GDD (story section 3 + a new progression section). The manager adds it to roadmap M2+ (D-020). The crash intro isn't added to M1.
- Walk-out through the breach onto real terrain replaces the end trigger in M2 (US-026, D-020).
