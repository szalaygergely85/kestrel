# SETTINGS-STYLE-01 (2026-10-09)

The shared production Settings panel used by title-menu Settings and pause S
now uses uiStyle.menu: opaque plate, brass frame/rivets, spaced decorated title,
gold band and both focus markers, matching font/grid and highlighted hint keys.
The existing legacy option order, navigation, persistence, grid refusal and
click-to-resume closure are retained. Its Resolution label follows the owner's
request. Cached skin/value strings avoid adding allocations to warmed drawing.
No designer asset, palette, engine or main.js edit.

The full createSettingsView uses the same skin when menuStyle is supplied or
the game's ASSETS.uiStyle.menu is present. It retains the seven existing
options and Back, plus the owner's explicitly requested LOD distance row.
lodScale cycles the shipped preset multipliers 0.6 / 0.8 / 1 / 1.25, defaults
to 1 and emits onChange('lodScale', value). Resolution retains the existing
grid values. Quality/shadow restart notes and all current control semantics
remain. A taller 72x36 card fits the controls and their notes; the shared legacy
panel uses the title card's 72x28 dimensions. Legacy full-view callers without
menuStyle remain compatible. No new copy for story content or new colours.

Title-menu preview now opens the full Settings view and Esc/Back returns to
the menu. Preview changes are memory-only. Shared production panel remains
the existing Resolution/Mute/Back model: this change does not mount full
graphics controls in main.js. NEEDS B1: mount createSettingsView for both title
and pause, map lodScale to the existing graphics LOD knob and persist it with
the other graphics options; recommend next-launch application matching the
restart note, alternative apply live only after the renderer seam supports it.
TITLE-MENU-02 Load host/recency notes remain open.

Focused suites PASS: settings 26 checks; full view existing options round trip,
LOD change/validation, Back consumption, menu frame/marker token overrides,
opaque band, control behaviour and legacy compatibility.
Full gate 372/372 PASS, zero FAIL/TIMEOUT/WARN. check-deps OK (652 files, 1,358 existing warnings).

Real NVIDIA/Lovelace WebGPU (no fallback), scene 400x150/UI 160x60:
tools/verify-settings.mjs 9886 webgpu --game PASS, zero runtime exceptions.
Physical quality/shadows/LOD/resolution/volume/mute/Esc checks; preview title
Settings entry/return; real game title Settings, fresh New game then Esc/S
pause Settings. The probe uses public engine.setGrid(400,150,{immediate:true})
after boot to establish the required capture grid while the title menu freezes
steps. This is a harness setup, not a live grid-change fix. Initial captures
were taken during graphics calibration at 160x60 and discarded/replaced.

Inspected ignored captures settings-title-webgpu.png,
settings-game-title-webgpu.png and settings-game-pause-webgpu.png.
Visible: yes - brass frame and gold selected row stand out on the dark plate;
Settings heading, all full-preview controls and hint footer are readable.
Real-game captures use the ordinary wake position; no camera/world edits.
Game captures verify the existing three-row panel, not full graphics wiring.
Owned browser/server/profile cleaned; port 8000 and owner's world untouched.

Status: NEEDS PC-A: PO review for styling; full graphics mounting NEEDS B1.
