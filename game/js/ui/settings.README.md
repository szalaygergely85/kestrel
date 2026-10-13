# S8-C-04 Settings view host contract

`createSettingsView(options, {style, controls, quality, rgb, onChange, isDisabled})`
from `settings.js` supplies the full designer panel. Pass `ASSETS.uiStyle.settings.full`,
`.controls`, `.quality`, and `ASSETS.palette.rgb`. Existing pause-panel exports remain
available; the host chooses when to mount the full view.

- `handleKey(code)` consumes arrows/WASD, Enter/Space and Esc. Enter/Space toggles
  booleans, advances other values, or emits Back. Choice ends stop; navigation wraps.
- `draw(ui)` draws at the authored 160x60 UI coordinates with an opaque plate.
- `snapshot()` returns detached plain options; construct a new view from that object
  to restore. Volume is 0..1 in this contract; the slider displays 0..10.
- `takeAction()` returns `back` once, then null; `selectedId()` exposes focus.
- `onChange(id, value)` runs on value changes. Map `mute` to platform `muted` and
  `shadows` to `shadowQuality`; quality/grid use their existing keys. The host owns
  persistence, grid application/refusal, audio volume and comfort effects. Mark an
  unavailable row or choice via `isDisabled(id, value)` (undefined value = row).
- Off/Low/Mid/High shadows are independent from quality. Both graphics choices show
  Restart to apply. No numeric shadow tiers are defined by this view.

Preview: `game/js/ui/settings.preview.html?backend=webgpu` (or `webgl2`).
Verification: `node tools/verify-settings.mjs 9888 webgpu`.
Preview state is memory only; it does not write the player's preferences.
