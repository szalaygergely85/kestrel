# S8-C-04 Settings full view - 2026-10-09

Scope: extended `game/js/ui/settings.js` with `createSettingsView`, a pure opt-in
full-panel controller/draw API, plus Node tests, preview and repeatable GPU harness.
Uses PC-A's `settings.full`, `controls` and `quality` assets; no design, engine,
main.js or production world changes. Legacy pause-panel API remains covered by its
existing 22 assertions. Host contract: `game/js/ui/settings.README.md`.

Quality strip, independent Off/Low/Mid/High shadows (approved decision overrides
writer off/soft/sharp), grid, 0..10 volume display over 0..1 data, mute, text size,
reduce motion, Back. Select ends stop, focus wraps, Enter/Space toggles, disabled
rows/quality choices skip. Detached plain options restore byte-stably; all labels
and per-control colours/opaque backgrounds come from the supplied style. Changed
labels cache on input events; draw helpers and strip strings persist across frames.

Checks:
- Legacy Settings: 22/22 PASS.
- Full view: source/snapshot isolation, JSON round trip for every option, selected
  restart note, authored opaque 64x25 cells, volume limits, all option changes,
  toggle keys, one-shot Back, disabled skips and invalid options PASS.
- Separate exposed-GC probe: 10,000 warm-up + 100,000 draw calls, retained heap
  below unchanged 65,536-byte bar PASS. This optional stress probe takes ~8 s;
  ordinary test runner skips the exposed-GC-only loop.
- Real NVIDIA/Lovelace WebGPU and RTX 4060/D3D11 WebGL2, 400x150 scene + 160x60 UI:
  physical quality/shadow/volume/toggle/Esc controls PASS, zero JS exceptions.
- `node tools/check-deps.mjs`: check-deps OK (644 files), 1,358 existing warnings.
- Full runner: 370/370 PASS, zero FAIL/TIMEOUT/WARN; Settings full view 567 ms.
- Final origin/master 33d7a40 + origin/pc-a 467a0bf sync unchanged; diff check clean.

Visible: yes in inspected WebGPU capture - complete brass frame, cream labels,
gold Quality band and volume slider readable on the dark plate. Captures:
`docs/test-reports/captures/settings-webgpu.png`, `settings-webgl2.png` (ignored).
LOOK RISK: one repeated WebGPU capture was completely blank, then the next was
fully readable; WebGL2 dropped frame/labels and retained some value rows. Same
previously recorded UI present/compositor symptom; this is not a stable visual
completion claim. NEEDS B1: compare CPU UI/live present/CDP capture, recommend fix
that shared presentation seam; alternative explicit owner walk on both backends.

NEEDS B1: opt in to this full view from the title/pause host; map mute -> muted,
shadows -> shadowQuality; persist/apply comfort fields and audio volume (current
platform does not whitelist comfort fields and synth has no volume setter). Validate
live grid refusal through the host disabled-choice callback. Recommend existing
host adapters; alternative keep the pure preview until each application seam lands.

Repeat: `node tools/verify-settings.mjs 9888 webgpu` (or `webgl2`). Preview is
memory only. Owned Python/browser/profile processes cleaned up; port 8000 untouched.
The original checkout's owner-edited world file was left untouched: sync initially
refused, so development used the clean pc-c clone `../kestrel_pc_c_continue`.
