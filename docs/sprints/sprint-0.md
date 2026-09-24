# Sprint 0 review (2026-09-24, retroactive)

Owner: Product Owner. Written after the day's work. Sources: session handoff 3 in `docs/backlog.md`, the M1 build-order table, and the latest commits (d00e5b8 .. 355ea3c). The PO had no shell in this session, so the story list comes from the backlog, not from a full `git log --since=2026-09-24`.

## Goal (retroactive)
Make the M1 tower slice complete end to end (lit GPU world, interaction, wake-to-ending flow). Owner walk-tests then found that the props and the ending don't work for a player yet.

## Done (tester PASS)
| ID | What it gives the player |
|---|---|
| US-006 | Point lights + flicker on the GPU (burner, lamp) |
| US-007 | Sun + shaft shadow |
| US-011 | Billboard prop art (D-011 reskin), interim until voxel props |
| US-012 | Interaction `[E]` + brass lamp pickup (carried light) |
| US-015 | Wake sequence, `KESTREL` title, map card (`M`), hints |
| US-017 | End trigger, walk + fade, end card, `R` restart |
| US-030b | 2x2 ray coverage anti-shimmer (owner walk-test passed) |
| US-045 | WebGL2-required screen + software-renderer warning (D-017) |
| BUG-LIGHT-001, BUG-LIGHT-002, BUG-CAST-001 | CPU/GPU parity: gpucompare 14/14 ALL PASS, light gating on |
| BUG-OWN-002 | Props no longer shrink as you walk closer |

Also: US-039 voxel format (pre-M3, earlier), owner real-GPU measurement 8 lights @320x120 = gpu 1.46 ms (budget 4 ms), D-017, D-019, architect tech notes for US-040 (15.2) and US-041a (15.3).

## Not done
| ID | State | Why |
|---|---|---|
| US-016 | dev | JS oracle, shading, horizon data done; GPU terrain march (pass A2) + horizon billboards not built. The breach shows empty sky on the shipping path. |
| US-018 | todo | Final perf + F3 overlay; blocked until the overworld and voxel props exist. |
| US-040, US-041a | todo | Pulled into M1 by D-019 (voxel props); tech notes ready. |
| BUG-OWN-003 | todo (slimmed) | See-through billboards; only flames/glows remain after the voxel swap. |
| ART-OWN-001 | design | Designer building solid props as voxel models (in progress). |
| US-029 / US-024 | testing / po-review | Paperwork: both work in the build, status rows not closed. |
| P1/P2 | todo | US-022 relay wake, US-019 dust, US-020 sound, US-021 log, US-023 see-through grate, US-044 flicker harness. |

## Bugs and requests found by the owner
| ID | Report | Outcome |
|---|---|---|
| BUG-OWN-002 | Props shrink when walking closer | **Fixed** (MAX_SCALE clamp removed, LOD scale by own size). |
| BUG-OWN-003 | Props see-through | Slimmed by D-019: solid props go voxel (opaque); billboard `fill` only if still seen after the swap. |
| BUG-OWN-004 | Terrain dark, can't see anything | `?gpu=0` colour bug fixed (testing); GPU path closes with US-016 A2. |
| BUG-OWN-005 | "Put me back to respawn when I went up" | Not physics: that was the M1 ending firing at the breach with no vista. PO decision below. |
| ART-OWN-001 | Props not recognisable, lever hard to find | Rework as voxel models (D-019); readability ACs kept. |
| OWN-REQ-001 | Props should be real 3D, not turn to face me | D-019 option (a): US-040 + US-041a in M1. US-041 split done (US-041a M1 P0, US-041b before M3). |

## BUG-OWN-005 decision (PO)
- **End card must say:** it's the end of chapter one, not a death or respawn. Typed lines stay (`The signal is still calling.` / relay alt, `Someone is out there.`), then `- End of Chapter One: The Tower -`, `Thank you for playing.` (dim), `[R] Play again from the wreck` ("Wake again" reads like a respawn). Content-only in `uiStyle.endText`; the writer may polish it (<= 40 chars per line).
- **Make the ending feel deliberate:** it fires only where the US-016 vista fills the view, plus a one-time summit hint `Out there. Step through the breach.` so the player walks out on purpose.
- **Walk-on (manager decides):** PO proposes **no** for M1. Outside the breach there's only far-LOD terrain with no near LOD or slope physics (US-026, M2), so walking on would show a broken world. In M2, US-026 replaces the end trigger with the walk-out.
- Priority raised P1 -> **P0**: "do I understand it's the end?" is an M1 exit question.

## Missing to be playable (M1, as a player)
Ordered by how badly each gap breaks a first playthrough.

1. **I reach the top and see nothing** (US-016 GPU A2). The breach is empty sky on the shipping path. The payoff view (signal tower, Ferrum behind, envelope below) is missing, so the ending has no reason.
2. **The ending reads as a reset** (BUG-OWN-005). No "end of chapter" wording, `[R] Wake again` sounds like respawn, and nothing warns me that stepping out ends the slice.
3. **I can't recognise or find the puzzle props** (ART-OWN-001, OWN-REQ-001, BUG-OWN-003). The lever is hard to spot on the wall, ground objects are unreadable, props turn to face me and look see-through. The lever is the whole puzzle's key, so it has to be findable. Needs US-040 -> US-041a -> voxel prop swap + walk-check.
4. **Cause and effect is weak** (lever -> grate, boulder). There's no sound (US-020 P2): no lever clunk, gear ratchet, grate rattle, boulder thud. The grate rises 1.5 s after the pull. If the grate isn't in view from the lever, the player may not notice it opened. Check the chains read visually; consider a short camera-free cue (grate rattle sound is the cheapest). PO proposes moving a **minimal sound slice** (lever, grate, boulder, footsteps) to P1 for M1.
5. **Nothing to do at the summit before the ending** (US-022 relay wake, P1). The relay bowl is dead and silent. The magic hint (pillar 6) and the alt end line only exist if US-022 lands. Without it, the summit is just a trigger.
6. **Where do I go, and why do I need the lamp?** The hints cover the burner, climbing and the chart, but nothing says the goal is the top of the tower before the map card. The lamp's value (lighting the dark mid-level) has to be felt; confirm the mid ledge/stair is dark enough without it. Walk-check item, not a story yet.
7. **Readability of the grid** (240x90 default). The owner never confirmed 240x90 is readable on a normal screen (the 320x120 complaint). If not, a grid-only slice of US-038 comes into M1 (D-011 note).
8. **Never played end to end with a real mouse** by the owner (handoff 3 to-do). Restart via `R` was only verified in Node/headless. One real playthrough (wake -> lamp -> boulder -> lever -> grate -> summit -> end -> `R` -> second run) is the real M1 acceptance test.
9. **Perf/stutter unproven on the full slice** (US-018): overworld + voxel pass + 8 lights at 240x90 and 320x120, no frame > 25 ms.
10. **Falling off / out of bounds:** no kill plane or fall reset exists. The tester should confirm there's no gap in the parapet/breach where the player can leave the tower and get stuck outside. If there is one, file a bug.

## Next / for the manager
- Owner story + progression idea to fold into the GDD (writer + PO) and roadmap M2+ (manager) (`docs/owner-ideas/2026-09-24-story-and-progression.md`). Not in sprint 1: M1 stays the tower slice.
- Decide BUG-OWN-005 walk-on (PO proposes no free walk-on in M1).
- Decide whether a minimal M1 sound slice (gap 4) moves US-020 from P2 to P1.
- Main session: add US-040 to the M1 build-order table (US-041a is row 25k).

## Proposed sprint 1 (for the manager)
**Goal:** a first-time player can finish the tower. They see the vista, recognise and use the props, and understand that the ending is the end of chapter one.

| # | Story | Why | Notes |
|---|---|---|---|
| 1 | US-016 finish: GPU terrain march A2 + horizon billboards | Gap 1, closes BUG-OWN-004 (1) | In progress (architect). Engine: ARCH review. |
| 2 | US-040 GPU voxel pass A3 + gpucompare | Gap 3 | Tech notes 15.2. D-019 gate: gpucompare + <= 0.5 ms p95 after one fix round, else fallback (b). |
| 3 | US-041a Voxel props: rotated normals, `voxel` binding, lever pull, mounts | Gap 3 | Tech notes 15.3. Designer: lever voxel with parts. |
| 4 | **New: M1 voxel prop swap + owner walk-check** (content) | Gap 3, closes OWN-REQ-001 + ART-OWN-001; decides whether BUG-OWN-003 slim is still needed | Designer's voxel ModelDefs for all solid props into the registry (no level edit per 15.3 item 1), yaw rules, flames/glows stay billboards; PO checks in game at 160x60 + 240x90; owner walk-check. PO to write the story (next free ID). |
| 5 | BUG-OWN-005 end-card text + summit hint (content) | Gap 2 | Small; designer `uiStyle.endText` + `tower.js` hint trigger; writer polish. |
| 6 | US-018 perf budget + F3 overlay (stretch) | Gap 9, M1 exit | Only after 1-4; else first story of sprint 2. |

Sprint 2 candidates: BUG-OWN-003 slim (if the walk-check still sees through effects), US-022 relay wake, minimal sound slice, grid-readability decision (US-038 slice), owner end-to-end playthrough as the M1 exit test.
