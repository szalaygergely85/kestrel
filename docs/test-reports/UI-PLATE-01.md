# UI-PLATE-01 — PC-C UI background audit

2026-10-07. Scope: UI calls in `game/js`, `engine/ui`, and editor overlays. PC-C owns the caller fixes; `engine/render/**` and `game/js/main.js` belong to B1.

## Changes

- Editor selection brackets, selected light/interactable marks, world markers, and hover dot: all 11 `setCell` sites in `tools/editor/select.js` now provide the existing toast plate `#0a0b10` ([10,11,16], `design/items.js`), through `overlayStyle.js`.
- Terrain brush ring now supplies the same plate; placement drag `+` now supplies its existing help/drag text plate `#0c120c`.
- `overlayPlate.test.mjs` exercises real selection/hover/marker paths against CellBuffer and verifies explicit plate RGB, opaque alpha, and matching designer toast colour. It imports through `engine/index.js`.

## Remaining UI audit

| Calls | Result |
|---|---|
| Game interaction prompt | `main.js` already provides `plateBg: '#0a0b10'`; untouched |
| Crosshair | Glyph-only `setGlyph` deliberately preserves scene background |
| `engine/ui/crosshair.js` prompt text | Production caller supplies plate. Public style declares it optional; omitted plate still reaches drawText/CellBuffer as undefined. NEEDS PC-A/B1: establish fallback/default contract if other callers should support omission |
| Title/end cards, pause/settings, HUD, debug overlay | Numeric setCellRGB backgrounds or explicit DOM backgrounds; no omitted string background found |
| Notes | Deliberate paper/paperEdge/shadow backgrounds; white paper is authored |
| Inventory and loot toast | Authored numeric panel/slot/plate colours are passed through |
| Rich text / panels / world overlay | Rich text defaults to explicit BLACK; panels use numeric black; depth overlay changes only glyph/foreground and preserves scene bg by design |
| Editor help, icon renderer, drag label | Explicit valid backgrounds; drag marker omission fixed |
| Dev demo/bench/glyph pages | Explicit string/numeric backgrounds |

**NEEDS B1: AC2 still open.** `engine/render/CellBuffer.js::_parseColor` silently defaults missing/unrecognised colour strings to white; malformed hex can produce NaN. Add the specified once-in-dev diagnostic and parser tests in the owning lane. Recommend preserve valid-input behaviour and existing release contract while warning once; alternative PC-A specifies a new fallback policy. PC-C did not change renderer files or claim this AC done.

## Visual check

Real WebGL2/D3D11 on NVIDIA GeForce RTX 4060; editor scene grid **400x150**; screenshot `docs/test-reports/captures/ui-plate-01-editor.png` (local ignored capture). Lantern selected, camera about 2 m south at lamp height, with ordinary scene-tree/inspector selection path. Visible: tiny gold scene markers on dark scene; no large white plate visible. **LOOK RISK:** selection bracket/hover mark is not clearly readable in this GPU capture; Node tests verify the corrected background bytes, but owner/editor visual acceptance remains open. Larger/close bounds may hit the existing 400-cell highlight-area guard; GPU overlay presentation needs a separate owning-lane check if the marks still disappear. No guard or colour design was changed.

First browser attempt failed transiently while fetching the editor module; fresh retries booted and captured successfully. Only the server/browser started by the probe were stopped.

## Validation

Focused overlay test PASS. First full run: 263 PASS / 2 FAIL: the new test's deep import (fixed to public entry), and terrainStroke timing 157.9 ms against 150 ms during browser work (baseline audit run passed). Next full run: 264 PASS / 1 FAIL, pre-existing collider heap check (121,408 bytes / 65,536-byte bound); isolated rerun of both collider suites: 2/2 PASS. Final verification is recorded in `docs/lanes/pc-c.md`. No thresholds widened; renderer/world tests unchanged.
