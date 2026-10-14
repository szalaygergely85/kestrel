# PC-A ratify pass 2026-10-14 (architect, PC-A)

Scope: architecture 38.16a, 38.19-38.64; decisions D-052 (PC-B), D-053..D-083 incl. D-078; PC-B batch reviews 2026-10-13 / 2026-10-14. Read headings + normative parts. Probes: `check-deps` (OK, 71 warnings), import scans of engine/physics + engine/fauna, greps for code state (WG-5 landed, editor frame.js deleted, stamina, fauna coupling, grab).
Note: D-066 already ratified D-053..D-065 and 38.24-38.39; they are re-checked here only for later conflicts.

## Architecture notes
- 38.16a: RATIFIED WITH NOTE: both facts are history now (ME-20c 38.18 landed the `--ao` path; 38.15 particles DROP stands).
- 38.19: RATIFIED WITH NOTE: "lands after ED-WG-01 / GL editor" parts are done/moot (WG-5 landed); ortho rules stand.
- 38.20: RATIFIED (frame-exact two-phase HZB, conservative margins, gpucompare identity gate; default-off rule now driven by 38.60 R3).
- 38.21: RATIFIED WITH NOTE: deletion list done (frame.js/sprites.js gone, check-deps GL_ONLY rule); WG-5 leftovers in item 4 are history.
- 38.22: RATIFIED WITH NOTE: GL2/LVIS sentences ("GpuDeviceGL2 throws", "frozen GLSL keeps LVIS") are moot after WG-5; ME-19e scope = WebGPU + twin only.
- 38.23: RATIFIED (append-only shade block, count 0 bit-identical; still used for the sea-monster dark tint).
- 38.24: RATIFIED WITH NOTE: D-053 later bullet "walls back to per-block glyphs" wins; only `rock_soft` carries `glyph:'texel'` in design/detail-pass.js (stone/brick per-block). GLSL code point moot.
- 38.25 (+ amendment): RATIFIED.
- 38.26: RATIFIED WITH NOTE: GL golden reference retired with WG-5; `pick-golden-webgpu.json` is the reference.
- 38.27: RATIFIED WITH NOTE: heading still says "pending ARCH review"; the y-axis rename (batch-review-2026-10-09-pcb item 5) is done in leash.js/perceive.js. Update the heading text when next touched.
- 38.28: RATIFIED WITH NOTE: item 4 (dialogue input lock via `vLocked`) is superseded by D-064 "never lock"; main.js already follows D-064 (DIALOGUE-LOCK-01). Mark item 4 superseded.
- 38.29: RATIFIED (three.js/Tauri confined to tools/chargen*, check-deps rule 21 present; D-054 exception).
- 38.30: RATIFIED.
- 38.31: RATIFIED WITH NOTE: item 10 ("nothing reads fauna except the render feed", "beastSim hash identical with fauna on/off") is broken by 38.56 (c) as built; see CHANGES on 38.56.
- 38.32: RATIFIED.
- 38.33: RATIFIED.
- 38.34: RATIFIED (D-059/D-063 later keep the fine head as an option only).
- 38.35: RATIFIED WITH NOTE: D-082 (objects never givers) supersedes any object-given mark (e.g. D-064 "! over the wake-spot note").
- 38.36: RATIFIED WITH NOTE: D-080: player text says "Waystone" everywhere; internal `kind:'relay'` / ids may stay.
- 38.37: RATIFIED WITH NOTE: same D-080/D-082 wording rule for the Bend Relay and note givers.
- 38.38: RATIFIED WITH NOTE: superseded in part by 38.43 (grid), 38.58 ("do not pool near" amended), 38.59 (budgets).
- 38.39: RATIFIED.
- 38.40: RATIFIED WITH NOTE: stage budget "<= 6 ms median" superseded by D-068 EQ-04 bullet (12 ms per stage render, 20 Hz cap, 0 alloc).
- 38.41: RATIFIED.
- 38.42: RATIFIED.
- 38.43: RATIFIED WITH NOTE: "beach (no swimming)" polygon, "Max 2 bands in memory", 12 MB terrain and "WebGL2 + WebGPU" perf line are superseded (38.54, 38.58, 38.59 40 MB, D-053); inline load-bake 220 ms line ratified.
- 38.44: RATIFIED WITH NOTE: D-082: `sites` of `kind:'prop'` may be objective targets only, never `giver`/`turnIn`; add a lint rule (follow-up QPIPE-LINT-01).
- 38.45: RATIFIED WITH NOTE: (3) "No swimming / deep = wall" and (5) "do not add swimming" superseded by 38.54 (D-070); GLSL fallback sentence moot. Mark inline when touched.
- 38.46: RATIFIED WITH NOTE: `ferrumGlow` horizon billboard conflicts with D-078 item 2 ("never a horizon sprite"); D-068 M4 scope (later) keeps MAP-08 silhouettes; billboard needs an owner yes (conflict C4).
- 38.47: RATIFIED WITH NOTE: "JS/WGSL/GLSL twins" -> JS/WGSL only.
- 38.48: RATIFIED.
- 38.49: RATIFIED.
- 38.50: RATIFIED.
- 38.51 (+ amendment): RATIFIED.
- 38.52 (+ 5 amendments): RATIFIED WITH NOTE: six layered amendments; the TUFT-PERF "do not change fpK" line is superseded (stated); RTX ultra <= 0.15 ms and the OB-121 RTX 0.12 ms at 560x210 high now coexist: the later OB-121 number wins for high. Consolidate into one normative block next time the carpet is touched.
- 38.53: RATIFIED WITH NOTE: unlock is a quest-reward flag, no level stat; "level 5" must mean the level-5 zone band / story beat, not a player level (conflict C1).
- 38.54: RATIFIED WITH NOTE: (a) `engine/physics/swim.js` imports `../core/math.js` (clamp), against its own item 1 and 27.10; inline it. (b) SWIM-05 AC "12 s swim -> drown" is stale: D-070 amendment = only diving drains (stamina.js already does this). (c) batch-review 2026-10-14: NaN `waterZ/waterFloorZ` live in a serialized component (follow-up SWIM-SAVE-01).
- 38.55: RATIFIED.
- 38.56: CHANGES: see below.
- 38.57: RATIFIED WITH NOTE: loot tiers fine/tempered/warden fixed by band follow the pre-D-081 tier table; D-081 (later) replaces tier stats with RPG stats; keep tier names only as rarity/band labels until the D-081 epic lands.
- 38.58: RATIFIED (24 MB default superseded by 38.59's 32 MB, stated there).
- 38.59: RATIFIED.
- 38.60: RATIFIED WITH NOTE: the open "ARCH DECISION asked: frag_depth" was answered ACCEPT (batch-review-2026-10-13-pcb R6c (a), plus the vertex-stage storage guard (b)); record it in 38.60 and as an `impostorCard`-only exemption under the WGSL rules (architecture ~l.4062 "no frag_depth"). "GL2 path" mention moot.
- 38.61 (+ 2a/2b): RATIFIED.
- 38.62: RATIFIED WITH NOTE: batch-review-2026-10-14 ASK answers (compute `bindings.textures` after buffers, `instanceOffset` on render bind, `DECOR_MAX_ROWS` 16384 = side^2*2*species) say "PC-A records this in 38.62": not yet recorded; the 8192 in the note is stale. WebGL2 mention moot.
- 38.63: RATIFIED (implements D-079; look 0 byte-identical; no design import in engine).
- 38.64: CHANGES: see below.

## Decisions
- D-052 (PC-B, M1.5/M2 closed): RATIFIED.
- D-053: RATIFIED WITH NOTE: internal order: texel glyphs on stone/brick then "walls back to per-block glyphs": the later bullet wins (code matches). Flat 8 ms GPU p95 "on every preset" vs later Intel targets (C3).
- D-054: RATIFIED.
- D-055: RATIFIED (fine head kept as an option by D-059/D-063).
- D-056: RATIFIED.
- D-057: RATIFIED.
- D-058: RATIFIED WITH NOTE: Fen removal reversed by D-062 (stated).
- D-059: RATIFIED WITH NOTE: proportions superseded by D-063 (stated).
- D-060: RATIFIED WITH NOTE: relay naming superseded for the player by D-080.
- D-061: RATIFIED.
- D-062: RATIFIED.
- D-063: RATIFIED.
- D-064: RATIFIED WITH NOTE: ford/wading/swim lines superseded by D-068 (wade) and D-070 (swim); "! over the wake-spot note" superseded by D-082.
- D-065: RATIFIED WITH NOTE: "no magic" partly reopened by D-069.
- D-066: RATIFIED (either PC may sign).
- D-067: RATIFIED (wins over D-078 item 2 on the gate/Part II, per D-078's own header).
- D-068: RATIFIED.
- D-069: RATIFIED WITH NOTE: "level 5" read as zone band 5 / story beat (C1).
- D-070: RATIFIED.
- D-071: RATIFIED.
- D-072: RATIFIED.
- D-073: RATIFIED WITH NOTE: superseded by D-076 (stated).
- D-074: RATIFIED.
- D-075: RATIFIED (see C3).
- D-076: RATIFIED.
- D-077: RATIFIED.
- D-078: RATIFIED WITH NOTE: item 2 (no Part II pass, two bridges, Ferrum never as a horizon sprite) and item 3 ("stronger spells") are superseded where D-064/D-065/D-067/D-068/D-069/D-070 differ (its own header rule); item 3 "NO XP, no player level" still holds and governs D-069/D-081 (C1, C2).
- D-079: RATIFIED.
- D-080: RATIFIED.
- D-081: RATIFIED WITH NOTE: STR/DEX/INT must come from gear only (no level-up points) unless the owner reopens D-078 item 3 (C2).
- D-082: RATIFIED.
- D-083: RATIFIED WITH NOTE: Easy/Normal/Hard is a global setting, not the zone "enemy scaling" D-078 rejects; no conflict.

## Batch review spot-check (2026-10-13 / 2026-10-14 PC-B)
Sound. No threshold widening found (R6c ties allowed only at view-pick/oct boundaries with a story note = 38.60 item 7; carpet/decor rows "never widened"). Twin parity enforced (ENV-01c sink/sway gap caught although gpucompare could not; ENV-01a i32 overflow caught by probe). Zero-alloc per 38.61 (ENV-01d < 16 B rejected, allocProbe min-of-5 required). Two notes: (1) WMP-03 (2026-10-13) was accepted with a retained-heap check, which 38.61 (2a) no longer allows: switch it to `tools/allocProbe.mjs` (follow-up). (2) The `groundAt` ALLOC_EXEMPT cap 15.2 B/call is just above the 38.61 (2b) "< 12 B" bar; accepted as the (4) measured+25 % exemption, keep it explicit in 38.61.

## CHANGES
1. **38.56 (c) fauna <-> beastSim.** As built (beastSim.js 502-508 `setThreats`/`nearestPrey`, `fauna.kill`), beastSim now reads fauna state, and fauna spawns depend on the camera view cone (38.31 item 3). This breaks 38.31 item 10 without saying so, and makes beast hunts depend on the camera. Required: add to 38.56 (c) "supersedes 38.31 item 10: beastSim reads fauna via nearestPrey/kill; beastSim with fauna is deterministic only for the same player+camera trace; replay/hash and quest-sim tests run with fauna = null (already bit-identical); hunts/EAT never write anything saved or hashed (beasts reset on load)". Add one test that the beastSim replay hash with `fauna: null` is unchanged by the hunt code. Then ratify.
2. **38.64 item 5 GRAB "the player controller locks input".** Contradicts D-064 (no in-game lock except menus, death screen, travel fade, intro wake). Required before BEAST-08b: either pin movement only (camera, attack and the mash key stay live, release on mash goal / 120 steps), or ESCALATE TO MANAGER for an owner exception recorded in decisions.md. Recommendation: movement pin, no lock.

## Conflicts
- **C1 levels (D-078 vs D-069 / D-067).** D-078 item 3 (owner 2026-10-09): no XP, no player level; D-067 confirms zone level bands, no XP. D-069 "fireball at level 5" is later but does not introduce XP. Reading that holds all three: level 5 = the level-5 zone band (crossing the river) / a story beat; 38.53 already implements it as a quest flag. PO to word FB-02 that way; owner confirm in the next walk.
- **C2 item stats (D-078 vs D-081).** D-081 (later) wins for item stats (replaces the tier table). STR/DEX/INT attributes are fine from gear; any per-player attribute growth would need a player level and reopen D-078 item 3: unclear, owner decides in the D-081 epic.
- **C3 GPU budget (D-053 vs 38.43 / 38.60 / D-075).** D-053: flat 8 ms GPU p95 on every preset. 38.43 sets Intel GPU p95 <= 14 ms, 38.60 Intel high <= 10 ms; D-075 (later) says ultra = RTX only but gives no numbers. Unclear which wins: owner/manager to state whether 8 ms applies per preset on the RTX only, or also on the Intel high preset. Recommendation: 8 ms on the RTX at every preset; Intel = high/medium, <= 10 ms.
- **C4 Ferrum (D-078 vs D-068 / 38.46).** D-078: Ferrum "never a horizon sprite"; 38.46 adds the `ferrumGlow` billboard next to the baked silhouette. D-068 M4 scope (later) keeps the silhouettes; the glow billboard needs an owner yes.
- **C5 givers (D-082 vs D-064 / 38.44).** Objects are never givers: the D-064 wake-note mark and 38.44 prop sites as givers go (D-082 wins).

## Follow-up stories (<= 1 d each)
- ARCH-DOC-RATIFY-01 [PC-A, 0.25 d]: doc-only: 38.56 + 38.31 item 10 text (CHANGES 1), 38.60 frag_depth answer + WGSL-rule exemption, 38.62 ASK answers + DECOR_MAX_ROWS 16384, inline "superseded by" marks in 38.28 item 4, 38.40, 38.43, 38.45, 38.54 SWIM-05 AC, 38.27 heading.
- LIFE-DET-01 [PC-B, 0.25 d]: beastSim replay-hash test with `fauna: null` covering the hunt/EAT code paths (CHANGES 1).
- BEAST-08b-PIN [PC-B, with 08b]: GRAB as a movement pin, no input lock (CHANGES 2), or the owner exception first.
- SWIM-SAVE-01 [PC-A, 0.5 d]: keep `waterZ/waterFloorZ` out of serialized body state (non-serialized scratch or finite sentinel), inline `clamp` in swim.js (physics stand-alone), physics + save round-trip tests.
- SIM-RULE15-01 [PC-B, 0.5 d]: `game/js/quest/sim/regionalBeasts.js` uses Math.hypot/cos/sin in sim code (check-deps rule 15 warnings): replace with integer/literal tables or move to create time.
- WMP-03-PROBE [PC-B, 0.25 d]: switch the WMP-03 retained-heap check to `tools/allocProbe.mjs` per 38.61 (2a).
- QPIPE-LINT-01 [PC-B, 0.5 d]: validate-content/quest lint: a quest `giver`/`turnIn` must resolve to an NPC/animal site (D-082), never `kind:'prop'`; givers must stand on walkable ground (OB-147).
- PLAYER-TEXT-RELAY-01 [PC-B, 0.25 d]: lint player-facing strings for "relay" (D-080).
