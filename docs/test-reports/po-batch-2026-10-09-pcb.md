# PO batch review 2026-10-09 (PC-B) - owner-authorised while PC-A offline

Scope: items listed in `kestrel-2/docs/test-reports/batch-review-2026-10-09-pcb.md` (batches 1-4 + re-reviews) plus DEATH-FLOW-01 part 1 (kestrel-1 7190e09).
Method and limits: this PO session had only read/grep/write tools (no shell, no git, no test runs). Verdicts rest on the architect's per-item ARCH verdicts and notes, the queue/lane ACs (`docs/pc-b-queue.md`, `docs/lanes/*.md`), and for DEATH-FLOW-01 a direct read of the code and test. Where the architect reported ARCH CHANGES and a later ARCH OK re-review exists, the later one counts. Re-run `node tools/run-tests.mjs` + `node tools/check-deps.mjs` before any status flips. Backlog rows were not edited; no commit made. PC-A may re-check.

## Verdicts

| Item | Verdict |
|---|---|
| S8-B1-10 / 18 / 04 (8302d6f, 75efdc9) | PO OK |
| SWAY host follow-up (6554888) | PO OK (open nit: pack shadow wind with the quantised time) |
| S8-B1-11 / 11b / 11c / 11d / 11e | PO OK |
| ALPHA-01f-fix + shadowList test (bc39aed) | PO OK |
| ALPHA-01f-fix2 (d8a8b78, 2fdc19c, 13ce615) | PO OK after re-review; NEEDS OWNER WALK (leaf cut-out in shadows, forest look) |
| PCB-PO-WG5A-01 (39cc778) | PO OK |
| S8-B2-12c (cloud shadow) | PO OK; NEEDS OWNER WALK (cloud look) |
| CLOUD-WRAP-01 + 01b (627e9c8, ae42f42) | PO OK; NEEDS OWNER WALK (sky re-baseline, wisp drift speed, no pop at wrap) |
| LIGHT-ALLOC-01 (k4 e46f912) | PO OK only if the 2.0 octave fix + parity test landed (ARCH CHANGES were open in batch 2, no re-review recorded): hold until confirmed |
| S8-B2-20b (AO) | PO OK; NEEDS OWNER WALK (AO look, default stays off in gpucompare) |
| US-068a / 068b1 / 068b2 / 068b3a / 068b3b (ortho) | PO OK (engine internals; `orthoIso` gpucompare row still the main session's gate) |
| US-068c editor gizmo | PO OK; NEEDS OWNER WALK (editor gizmo, preset views) |
| US-068d + gaps | PO OK for tools; browser pickParity rerun still open |
| S8-B2-10a / 10b / 10c (HZB occlusion) | PO OK (default OFF); gate still open: occl=0 identical to before, occl=1 == occl=0 |
| OCCL-STATS-01/01b/01c, OCCL-MAIN-01 | PO OK (debug only, `?occl=2`) |
| MESH-QA-01 | PO OK (tool). Owner decision on the forestWalk tri budget still waits on its numbers |
| MESH-LOD-CELLS-01 | PO OK |
| CREDITS-MOUNT-01 (f89d133) | PO OK on code; NEEDS OWNER WALK (title menu Credits, WebGPU + Arc webgl2) |
| BINDINGS-WIRE-01 (13d233e) | PO OK (no behaviour change; no rebinding UI by design) |
| TEST-FLAKY-AO-01 | PO OK |
| ME-16a/b/c/d/e/f (point shadows) | PO OK as code, feature stays default OFF; NEEDS OWNER WALK (`?pointshadows=N` tower look) after the ME-16g gate |
| ME-16 alloc partial | PO OK; known gap (582 vs 407 B/frame) stays open |
| ME-19c1/c2 | PO OK (dead code removal; GL sun-always-map) |
| ED-WG-01a / 01b / overlay / pick baseline | PO OK for engine and tools; NEEDS OWNER WALK (editor on WebGPU, overlay look) |
| BVH refit (795e6f4) | PO OK |
| FRAME-ALLOC-01/02, SWAY-GC-01, GFX-04-pc, PERF-TABLE-01, PERF-PASSP95-01, PERF-GATE-01, IGPU-ENTITY-COST-01 | PO OK (tooling/tests) |
| PARTICLE-UPLOAD-02 (105ea67 / 93eb29d) | PO REJECT: ARCH CHANGES, no fix recorded. The commented-out `rowsPerImage = h;` in `GpuDeviceWebGPU.js:179` breaks every WebGPU texture upload. Needs the restored statement + mock assert, then re-review |
| HITSTOP-01 (k1 b7f2400, fixed in bf393d9) | PO OK on the fix (sword.step every step, only beasts gated; sword.test case added); NEEDS OWNER WALK (feel at 240x90: 70 ms heavy, 50 ms light, cap 120) |
| WAYSTONE-TOUCH-01 (bf393d9) | PO OK; NEEDS OWNER WALK (touch stone: heal + toast + save) |
| HIT-SPARK-01 | PO OK (engine, not wired). Nit: hue ramps are game content; move to `design/` before wiring |
| TELEGRAPH-TINT-01, TELEGRAPH-GROUND-01, AI-PERCEIVE-01, ANIM-STATE-01a/b | PO OK (pure, not wired) |
| BOAR-SHADER-READ-01a/b (tint on WebGPU + twin) | PO OK for the stated scope. GL2 gap: on the owner's default `backend=webgl2` the boar telegraph will not show. PO ruling: accept WebGPU-only until WG-5, unless the owner wants a small GL `light.frag` follow-up. Owner decision before TELEGRAPH-WIRE-01 is judged by look |
| COMBAT-BENCH-01, COMBAT-CAPTURE-01 | PO OK (dev/tooling); NEEDS OWNER WALK (combat readability stills at 240x90) |
| DEMO-MODE-01 (72c3b42, 1f5370d) | PO OK; NEEDS OWNER WALK (`?demo=scene`, end card, save slot isolation) |
| TITLE-MENU-02 host, STALE-ROWS report, swayWindy parity, verify-particles, WG-5a-4 | PO OK |
| DEATH-FLOW-01 part 1 (k1 7190e09) | PO OK on code and tests; NEEDS OWNER WALK. See below |

## DEATH-FLOW-01 part 1 (read of `kestrel-1/game/js/fx/deathFade.js`, test, and the `main.js` hooks)

AC check against the queue row:
- 1.0 s fade-to-dark, pure `fadeAt(tMs)`, smoothstep: met (`fadeOutMs` 1000, t=0 gives 0, t=1000 gives 1). The row asked for `fadeAt -> {alpha, textAlpha}`: met (reused object).
- Test of `fadeAt`: monotone, endpoints, no-alloc over 1e5 calls: met. The no-alloc check uses a 1 MB heap delta without `--expose-gc`, so it is weak but acceptable.
- One centred line from story.md: met in substance. `death.line` is in the writer table (`Dark again. The light still blinks.`, 35 chars <= 38); the code constant matches it. It is a hard-coded copy, not read from a text key, so the two can drift.
- Input locked while fading: `inputLocked` is exposed; confirm main.js actually consumes it. The grep shows the flag feeding the virtual [E] respawn, but I found no use of `res.inputLocked` to block movement or attacks in main.js. Programmer to confirm, or the player can still move while the screen goes dark.
- Respawn once, second death ignored, unlocked afterwards: met and tested (fake `onRespawn`).
- 0.4 s fade-in: met (`fadeInMs` 400).
- Off in capture/bench/compare and `?fx=0`: met (`deathFlowEnabled`, test covers the disabled flow).
- Drawn on the ui layer, works on WebGPU: met by dithered black ui cells (O(cols*rows) per frame only while fading).
- Deviation from the row: respawn is not a direct `gameHooks.respawn()` call. The fade end drives vitals' own `[E]` respawn (virtual press), so pose logic stays untouched. Acceptable and lower risk.

Risk for the owner walk: the game already has a vitals death sequence (sink, `applyDeathFade`, `drawDeathCard` in `quest/vitalsView.js`). The new fade runs on top of it. Look for double fades, the old death card showing alongside the new line, the 1.0 s timing against the 48-step sink, and whether the old "press E" card flashes before the respawn.

## Owner-walk list
1. Die to a boar (DEATH-FLOW-01): fade, centred line, no leftover old death card, respawn on the stone with full hearts, movement locked during the fade.
2. Hit-stop feel (HITSTOP-01) on heavy and light hits at 240x90.
3. Touch the waystone (WAYSTONE-TOUCH-01): heal, toast, save.
4. Title menu Credits (CREDITS-MOUNT-01) on WebGPU and Arc webgl2.
5. Sky and cloud shadows: wisp drift speed and no pop (CLOUD-WRAP-01/01b, S8-B2-12c); AO look (S8-B2-20b).
6. Forest leaves and shadow cut-out (ALPHA-01f-fix2).
7. `?demo=scene` end card and save isolation (DEMO-MODE-01).
8. Combat readability stills from COMBAT-CAPTURE-01 at 240x90 and 400x150.
9. Editor: gizmo and preset views (US-068c), WebGPU editor and overlay (ED-WG-01b).
10. `?pointshadows=N` tower look, only after the ME-16g gate.
11. Owner decision: boar telegraph on GL2 (port to `light.frag`, or WebGPU-only until WG-5).

## Open items blocking a clean PO OK
- PARTICLE-UPLOAD-02: WebGPU `rowsPerImage` fix (REJECT above).
- LIGHT-ALLOC-01: confirm the `2.0` octave fix and the `cloudShadeQP` parity test.
- DEATH-FLOW-01: confirm `inputLocked` is consumed.
- Gates owned by the main session: `?gpucompare=1` (`orthoIso`, occl=0 vs before, occl=1 == occl=0), and the full `node tools/run-tests.mjs`.
