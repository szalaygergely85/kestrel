# Editor UI spec (Stitch "ASCII 3D Engine Editor", 2026-09-26)

Source: owner's Google Stitch project **"ASCII 3D Engine Editor"** (`projects/1388175240229506141`), design system "Retro-Terminal ASCII Studio". Reference exports (generated HTML, open in a browser, uses Tailwind CDN + Google Fonts, reference only, never import): `design/reference/stitch-editor/`
- `viewport.html` - 3D viewport + top ribbon + place toolbar + log stream
- `scene-tree.html` - scene tree with type filter chips, visibility/lock toggles
- `inspector.html` - entity header, transform fields (axis-coloured), component cards
- `console-assets.html` - console tabs (log / prefab library / script)

The Stitch screens are generic "engine editor" mock-ups. We take the **look and layout**, and map it onto what `tools/editor/` really does today (US-031..034). Anything in the mock-ups the engine does not have is listed under "Not adopted".

## 1. Tokens (CSS custom properties on `:root` in `tools/editor/index.html`)
| Token | Value | Use |
|---|---|---|
| `--ed-void` | `#0D1117` | viewport background, input field background |
| `--ed-panel` | `#161B22` | docks, ribbon, drawer |
| `--ed-hover` | `#21262D` | buttons, hovered/selected tree row |
| `--ed-line` | `#30363D` | every 1px border / dock seam |
| `--ed-cyan` | `#38BDF8` | primary: active tool, selection, focus, Z axis |
| `--ed-amber` | `#F59E0B` | warnings, unsaved state, X axis |
| `--ed-green` | `#4ADE80` | OK/saved/running, Y axis |
| `--ed-red` | `#FFB4AB` | errors (validation messages) |
| `--ed-fg-hi` | `#F0F6FC` | values, focused rows |
| `--ed-fg` | `#C9D1D9` | labels, body text |
| `--ed-fg-dim` | `#8B949E` | units, hints, inactive tabs |
| `--ed-fg-ghost` | `#484F58` | disabled |

Axis colours follow the engine's axes: **X amber, Y green (up), Z cyan**.

Type: data/controls = `"JetBrains Mono", Consolas, "Courier New", monospace` 11-12px; panel headers = `"Space Grotesk", "Segoe UI", sans-serif` 12-13px 600, -0.02em. **No web-font or icon-font download** (the editor must work offline from `python -m http.server`): use the local fallbacks; icons are ASCII/Unicode glyphs (see 4), not Material Symbols.

Shape: 0px corners everywhere, no shadows, no blur. Focus/selected = 1px cyan inset border or a 2px cyan left bar. Floating plates over the viewport: `--ed-panel` at 92% alpha + 1px `--ed-line` border.

## 2. Layout (desktop only; min width 1280)
```
+----------------------------------------------------------------------------+
| RIBBON 36px: [ASCII QUEST EDITOR] | > Play-test  | Sel Move Yaw | Snap 0.5 | Save Load | status |
+-----------+----------------------------------------------+-----------------+
| LEFT 240  |  VIEWPORT (canvas, fills)                    | RIGHT 280       |
| Scene     |  top-left plate: CAM x y z yaw pitch  SPD    | Inspector       |
| filter    |  top-right plate: axis legend X/Y/Z          |  header (glyph, |
| chips     |  bottom-centre plate: +Prop +Light +Trigger  |  kind, id)      |
| tree      |          +Interact  (= keys 1/2/3/4)         |  Transform      |
|           |  bottom-right: fps | glyphs | presented      |  Properties     |
+-----------+----------------------------------------------+-----------------+
| DRAWER 140px collapsible (`~`): Log | Keys                                 |
+----------------------------------------------------------------------------+
```
- Canvas keeps its current sizing logic inside `#viewport`; docks only change the space it gets (resize = existing resize path).
- Drawer and both docks collapsible; collapsed state remembered in `localStorage` (try/catch).

## 3. Mapping: Stitch element -> existing editor feature
| Stitch | Editor today | Notes |
|---|---|---|
| Ribbon play/pause/stop | `P` play-test (new tab), Animate toggle | Play = play-test; pause/stop = Animate on/off. No in-editor play mode. |
| Ribbon tool modes (select/translate/rotate/scale) | click-select, drag/arrows move, `Q`/`E` yaw | Modes Select / Move / Yaw only. Buttons set what LMB-drag does; keys keep working in every mode. No scale, no X/Z rotation. |
| Ribbon snap `0.5m` | `[` / `]` snap | Shows the current snap; click cycles the same steps. |
| Scene tree + filter chips ALL/MESHES/LIGHTS/... | `#outliner` | Chips = ALL / STRUCT / PROPS / LIGHTS / TRIGGERS / INTERACT (the doc's real kinds) with counts. Tree glyphs `├─ └─ │`. Row = glyph + id + kind chip. Selected row = `--ed-hover` + cyan bar. Search box filters by id. |
| Tree visibility / lock toggles | - | **Not in this story** (needs doc fields); leave space, US-067 later. |
| Inspector header (glyph, ENTITY ID, ACTIVE) | `#properties` | Header = model glyph or kind glyph, `id`, kind chip. |
| Transform Matrix (pos/rot/scale) | Properties x/y/z/yaw fields | POSITION X/Y/Z (axis-coloured labels) + YAW deg only. Same validation + inline errors as US-033. |
| Component cards (shader matrix, rigidbody) | Properties per kind (light preset, trigger r, ...) | One card per property group, card header in Space Grotesk. |
| Place toolbar +Mesh/+Light/+Cam/+Particle/+Trigger | keys 1/2/3/4 | Buttons **+Prop +Light +Trigger +Interact**, same code path as the keys; active place mode = cyan border. |
| Viewport stats (FPS, glyphs, draw calls, mem) | F3 overlay / status line | Bottom-right plate: fps, grid size, `presented` counter. |
| CAM readout | status line camera pose | Top-left plate: `CAM x y z  yaw pitch  SPD n m/s`. |
| Console log stream | `#status`, `#io-status` | Drawer "Log" tab: timestamped lines (load, save, validation errors, pick results in `?debug=1`). `#io-status` state (saved/unsaved/invalid) also shown in the ribbon, coloured green/amber/red. |
| Keyboard help | help `<section>` | Drawer "Keys" tab. |

## 4. Glyph icons (no icon font)
play `>`, animate `~`, select `+`, move `<->` / `✥`, yaw `↻`, snap `#`, save `S`, load `L`, prop `♣`, light `☼`, trigger `◇`, interactable `¤`, structure `▦`, folder `▾ / ▸`, collapse `–`. Use a glyph only when the local mono font has it; ASCII fallbacks in brackets are fine (`[>]`).

## 5. Not adopted (mock-up only, not engine features)
Lua scripting tab, prefab "verts"/procedural meshes, rigidbody mass/friction, glyph ramp / dithering / contrast "shader matrix", net sync, layers, rotation X/Z + scale, cameras as scene nodes, mobile touch layout/gestures, orthographic TOP/FRONT/ISO views (needs an engine camera mode, see US-068). The prefab browser idea -> US-067.
