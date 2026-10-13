# STALE-ROWS-01 status check (2026-10-09, kestrel-3, read-only, evidence = git log + code greps)

Verdicts: DONE / PARTIAL / STALE-SUPERSEDED / OPEN. Owner-only ACs marked [owner].

| ID | Verdict | Evidence | What is left | Suggested owner/slot |
|---|---|---|---|---|
| ME-12b | DONE (row stale) | ME-19a 52da96e "remove renderer selection, mesh reference everywhere"; `?renderer` no longer in game/index.html or main.js; DEFAULT_RENDERER export (806bad6) | nothing; fallback wording moot (dda being deleted by ME-19c) | main session: close row |
| BUG-FP-001 | STALE (GL-era) | b72c3b9 prebuilds far terrain at load; mesh is the only renderer now, WebGPU default path | [owner] one visual confirm outdoors at spawn; else close | main session: close, owner glance |
| ME-15 | DONE (umbrella) | 15a 6f0577d, 15b..d (cbc219f), 15e a1b6a86 D-043 shadow map default, 15f 707458a "ARCH OK -> done"; WG-3d 0d166d9 WebGPU sun shadow wired; shadow.frag.js present | ME-15h CPU follow-up row exists separately | main session: close umbrella |
| ME-15a | DONE | 6f0577d "ME-15a done" | - | close |
| ME-16 | OPEN | no cube-shadow code anywhere in engine/ (grep cube/ME-16 = 0 hits); only row + deps; LVIS still used by lighting.js, GpuCellPipeline, wg/passLight | whole story: top-2 point-light cube maps, carried-lamp rule, LVIS retire (large, ~2-3 d, needs WGSL port per D-044) | PC-A / needs architect note for WebGPU-only; also gates ME-19e |
| ME-18 | PARTIAL / mostly superseded | ED-MESH-1a-d done (806bad6, 0b82587, 933ef9e picking on pitched mesh projection, a0d5d0a live rebuild); tools/editor has pick.js, thumbnails.js, yawDeg edit (main.js:929) | verify: pick via GI.w objectId readback (pick.js says GPU readback or fb.gbuf), mesh structure place/move/rotate, library thumbnails for meshes; ACs not individually ticked | PC-B slot: PO re-AC against ED-MESH-1 + ED-WG-01, likely close or shrink to thumbnails |
| ME-19 | PARTIAL (umbrella) | 19a 52da96e done, 19b bced9b8 done (CPU casters out); 19c-f rows todo; dda.frag.js, WorldTextures, sectorCaster refs still in engine/ (levelMesh.js, MeshData.js, glsl/dda.frag.js) | 19c (GPU dda out, unblocked by D-043), 19d shear, 19e, 19f | 19c: PC-A (or kestrel slot); 19f: PC-B |
| ME-19e | OPEN | row todo, after ME-16 | LVIS out (~0.5 d); blocked by ME-16 | PC-A after ME-16 |
| ME-21 | OPEN | no storey/building content in content/ or design/ (grep 0); no commits | PO story + designer building + stairs/door; deps ME-14 (mesh structures) / ME-12 | PO sonnet -> designer; then PC-A/B |
| US-070a | STALE-SUPERSEDED | row says superseded by ME-15/16; sun shadows shipped as map (D-043); steps 1-3 PC-B done | point-light shadows -> ME-16; `?shadows=grid` CPU fallback moot | main: close, point to ME-16 |
| US-070b | DONE via ME-15c | ME-15c "terrain receive ... satisfies US-070b/070c" (27.9a); backlog row/section still `todo` | [owner] look at tower shadow on grass | main: close with ME-15c ref |
| US-079b | DONE pending owner | f7429ac/b87102c ARCH fixes applied; beastSim death/sink/corpseDust, tests 135/0 per row; row in arch-review | ARCH re-check of fixes (no verdict recorded), [owner] walk-test | arch batch + owner |
| US-079c | DONE code, status stale | 7c5dbc5 "boar fight readability"; beastSim.js:254/796 deOverlap, :145 `waiting`, :369 single charger, beastView `!` notice (l.88), windup clip | AC "charge costs 5 HP" + tests: not individually verified; [owner] walk-test (two boars never merged) | main: set po-review; owner walk |
| US-038 | PARTIAL, mostly DONE | 038a engine.setGrid (main.js:124/443/530); 038b game/js/ui/settings.js (grid, mute, fullscreen, mouse sens, invertY) + settings.test.js; storage via platform/saveRelay | confirm remembered-per-browser (US-060) and fullscreen row in rowOrder (settings.js:19 notes design only lists grid/mute/back); [owner] look | main: re-tag po-review/testing |
| US-026 | PARTIAL / split | row split US-026a (bounded walk-out) / 026b (streaming); terrainMesh.js, capsule.js, config.js carry US-026 refs; walking outdoors works on mesh | 026b S2-S4,S6,S7 + CO-6 chunk streaming still open; 026a likely done | PC-A (architect note first); mark 026a done after PO check |
| US-027 | DONE (row stale) | row itself: 027a + 027b done, owner playthrough + gpucompare OK | nothing | main: close |
| ED-MESH-1 | DONE (umbrella) | 1a 806bad6, 1b 0b82587, 1c 933ef9e, 1d a0d5d0a, review fixes d8aca3b / 13a2b75 ("1c/1d/138a done"); later folded into ED-WG-01 (0666987, arch 38.21) | residual: outer-ring floorH edit still re-bakes ~286 ms (1d note); ED-SCALE-1, ED-SNAP-1 are separate rows | main: close |
| ED-MESH-1b | DONE (row stale) | d8aca3b "1a/1b done"; 0b82587 wiring; row text still "todo - after 1a" | nothing | main: close |

## Counts
DONE (incl. stale-done): ME-12b, ME-15, ME-15a, US-070b, US-079b(owner pending), US-079c(owner pending), US-027, ED-MESH-1, ED-MESH-1b = 9
STALE/SUPERSEDED: BUG-FP-001, US-070a = 2
PARTIAL: ME-18, ME-19, US-038, US-026 = 4
OPEN: ME-16, ME-19e, ME-21 = 3

## Open items worth queuing
1. ME-16 (point-light cube shadows) -> unblocks ME-19e (LVIS out); architect note for WebGPU first.
2. ME-19c (GPU dda out; unblocked by D-043) then 19d, 19f.
3. ME-21 proof building: PO story + designer first.
4. ME-18 residual (mesh thumbnails / objectId pick AC audit) via PO re-AC.
5. US-026b/CO-6 streaming; needs architect note.
6. Owner-only: US-079b/c walk-test, US-070b tower shadow look, BUG-FP-001 spawn glance.
