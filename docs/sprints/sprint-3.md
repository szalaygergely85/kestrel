# Sprint 3 (planned 2026-09-25, D-026)

Owner: Manager (scope), Product Owner (stories/acceptance). M1 closed (D-024); this sprint opens M2.

## Goal
**Step out of the tower: the player walks from the breach onto real terrain, at a grid they choose, on a content format the editor can write.**

## Stories
| # | ID | Story | PC | Main files | Gate | Depends on |
|---|---|---|---|---|---|---|
| 1 | US-027a | Content loader: `loadPack` / `migrate` / byte-stable `stringify`, `AssetRegistry.fromJSON` (D-023 item 2) | PC-A | `engine/content/*` (new), `engine/core/AssetRegistry*`, `engine/index.js` export | architect notes (opus) -> programmer -> ARCH review (fable, first review) -> main session | PO ACs from architecture.md 19 |
| 2 | US-038a | Live `engine.setGrid(cols, rows)` (no reload) + D-025 clamp 160x60..480x180 | PC-A | `engine/core/engine.js`, `engine/render/RenderTargetGL.js`, `engine/render/gpu/*` (G-buffer/texture re-alloc) | architect notes (opus) -> programmer -> ARCH review (opus) -> owner `?bench=1` at 400x150 + 480x180 | #1 on master (one PC-A agent at a time) |
| 3 | US-026a | Walk out: near-LOD terrain band around the tower, walking on terrain with slope limits/slide, end card moves to a terrain end marker (D-020 end trigger replaced) | PC-A | `engine/world/terrain*`, `engine/render/terrain*` + GLSL, `engine/physics/*` (terrain contact/slope), `design/levels/world_m1` data (end marker, via PC-A designer, flipped format per #4) | PO ACs (opus) -> architect notes (fable) -> programmer -> ARCH review -> PO -> owner walk-test | #1, #4 flip of `world_m1` |
| 4 | US-027b | `tools/export-content.mjs` converter; flip `world_m1` + `tower` / `test_room` to JSON in `content/`; preview JSON helper; US-058 reads JSON (D-023 item 3) | PC-B | `tools/export-content.mjs` (+test), `content/*`, delete `design/levels/{tower,test_room,world_m1}.js` in the same commit, `game/index.html` script tags (shared hot file: small edit) | programmer -> PC-A PO (sonnet) -> main session gpucompare 27/27 unchanged | #1 on master; US-058 done. Nobody else edits those level files during the flip commit (D-023 item 4) |
| 5 | US-038b | Settings panel, game side (row 30f): open/close, navigation, sensitivity / invert Y / mute / volume, remembered, pause on focus loss; grid + fullscreen rows unhidden once #2 is on master (D-025 list) | PC-B | `game/js/ui/settings.js`, `game/js/settings/options.js`, `game/js/platform/*`, <= 5 lines `game/js/main.js` | programmer -> PC-A PO -> tester (owner-visible) | US-060, designer P4 (`uiStyle.settings` + mock); grid row needs #2 |
| 6 | US-058 | Content validator (row 30b) | PC-B | `tools/validate-content.mjs` (+test) | programmer -> PC-A PO (sonnet) | none (ready) |
| S | BUG-PERF-001 | JS spikes (row 25w): (a) `sim.quest` 4.5 ms [PC-B, `game/js/quest/*`]; (b) `sim.physics` 3.1 ms + (c) `r.ui` 1.2 ms/frame [PC-A] | both | see row | main session verifies with `?bench=1` worst-frame sections (no PO, perf bug) | (a) ready; (b)(c) PC-A stretch after #2 |

**Moved out (D-026):** US-051a object physics -> sprint 4 opener with US-026b (streaming + `content/chunks/` + OWN-REQ-002). US-031 editor -> sprint 4 at the earliest (D-023).

## PC-B queue (in order; sonnet programmer only; every item: Node tests, no `engine/` edits, sync from master first)
1. **US-058** content validator - ready now (validates the current JS `design/` data).
2. **US-060** platform storage + remembered mute - ready now.
3. **BUG-PERF-001 (a)** `sim.quest` spike - ready now (find the behaviour, make it O(1)/alloc-free, Node test).
4. **US-020d** room tone + SOS chime + volume API - ready now (needed by US-038b's volume row).
5. **US-027b** converter + flip - **needs US-027a on master** (PC-A P-A3).
6. **US-038b** settings panel - **needs designer P4** (PC-A P-A4); grid/fullscreen rows need US-038a (P-A5), hidden until then.
7. Filler if blocked: **US-059** capture-browser (ready), then **US-021** log (needs designer P3).
Items 1-4 are ~1.5-2 PC-B days of runway; PC-A must land P-A3 inside that window.

PC-B's `po-review` pile (US-020b, US-020c, US-057, OWN-REQ-005a/b) gets a PC-A PO (sonnet) pass first, so fix passes can be queued behind item 1.

## PC-A order (one agent at a time; prep for PC-B comes first)
- **P-A1 PO (opus, one pass):** ACs for US-027a, US-027b, US-038a (with D-025 bench ACs), US-026a (carve from the US-026 sketch, pick the terrain end marker, bounded area size); plus a sonnet-level routine review of PC-B's 5 `po-review` rows (may be a separate sonnet call).
  - **Done 2026-09-25 (PO, opus):** story sections `### US-027a`, `### US-027b`, `### US-038a`, `### US-026a` in docs/backlog.md. US-026a "bounded" = 3x3 near-LOD chunks (128 m) baked at load, walk bound r 96 m around the tower (slide along, hint `boundsEdge`); breach end trigger removed, end card moves to a designer voxel **waystone** ~60 m WSW of the breach (toward the signal tower), no M1-ending flag. US-038a adds a `?debug=1` F4 grid-cycle dev key until US-038b. PC-B review: US-020b, US-020c, US-057, OWN-REQ-005a+b PO OK -> `testing`. PC-B queue block at the top of the backlog re-ordered to this sprint.
- **P-A2 Architect (opus):** US-027a implementation notes (from architecture.md 19) + US-038a notes (re-alloc, max texture size at 480x180, UI layer re-bind) in one pass.
- **P-A3 Programmer:** US-027a -> ARCH review -> merge to master and push (unblocks PC-B item 5).
- **P-A4 Designer:** `uiStyle.settings` + mock in `design/preview/title.html` (P4); `uiStyle.logPanel` + decal (P3) in the same pass if cheap. Before PC-B reaches item 6.
- **P-A5 Programmer:** US-038a -> ARCH review -> owner bench 400x150 / 480x180 -> master.
- **P-A6 Architect (fable):** US-026a tech notes; designer builds the waystone voxel model + places the terrain end marker in the flipped `world_m1` JSON after PC-B's item 5 lands.
- **P-A7 Programmer:** US-026a -> ARCH review -> PO -> owner walk-test.
- **Stretch:** BUG-PERF-001 (b)(c).

## Shared-file risk
- `game/index.html`: US-027b removes level script tags (PC-B); nobody else touches script tags in that window.
- `game/js/main.js`: US-038a (setGrid wiring, PC-A), US-038b + US-060 (<= 5 lines, PC-B), US-026a (end trigger, PC-A). Land in the order above; pull master before each.
- `design/levels/world_m1`: frozen during the US-027b flip commit; afterwards only `content/*.json` is edited (designer for US-026a).
- `design/palette.js` / `detail-pass.js`: only the designer (P-A4, US-026a terrain glyphs if needed), append-only.

## Exit = owner walk-test
Owner plays the tower at 240x90, steps through the breach and walks the terrain to the end marker; opens settings, switches to 400x150 and 480x180 live, then back. Pass when:
- walking on terrain feels solid: no falling through, steep slopes slide, the far view joins the near band without a visible seam or pop;
- the end card appears at the terrain end marker; `R` restarts cleanly;
- settings: grid change without reload, mute/volume/sensitivity survive a reload; 240x90 + 320x120 meet the US-018 bar, 400x150 per D-025;
- main session: levels load from `content/*.json`, `?gpucompare=1` all PASS, all Node suites + `node tools/check-deps.mjs` + `node tools/validate-content.mjs` OK.
