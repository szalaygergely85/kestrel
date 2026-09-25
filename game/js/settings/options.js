// game/js/settings/options.js (US-038b, docs/backlog.md row 30f)
//
// The data-driven option list for the Settings panel (US-038 AC
// "Data-driven": `{ id, label, type: 'choice'|'toggle'|'range', values|min/
// max/step, default }`, rendered by `game/js/ui/settings.js` skinned with
// `ASSETS.uiStyle.settings` (design/models/title.js v1.16). No rendering,
// no `ASSETS`, no DOM/engine access here - this module is pure data plus
// small pure helpers (step/clamp), same split as design/README.md section 5
// asks for models vs. behaviour.
//
// Grid values + 'ultra' label per the *actual* D-025 bench result recorded
// in docs/backlog.md US-038a ("400x150 bench ... = normal (not ultra)";
// "480x180 ... = 'ultra' per D-025") and `uiStyle.settings.valueText.grid`/
// `notes.grid` (design v1.16, only `480x180` gets the "ultra"/"needs a fast
// GPU" treatment) - NOT the "400x150/480x180 both ultra" shorthand used
// elsewhere; the bench data + the shipped design asset agree and are the
// more specific source, so options.js follows them.
export const GRID_VALUES = ['240x90', '320x120', '400x150', '480x180'];
export const ULTRA_GRID_VALUES = ['480x180'];

export const OPTIONS = [
  { id: 'grid', type: 'choice', label: 'Grid', values: GRID_VALUES, default: '240x90' },
  { id: 'fullscreen', type: 'toggle', label: 'Fullscreen', values: [false, true], default: false },
  // GDD 4 / US-038 AC: 0.05-0.40 deg/px, step 0.025, default 0.15.
  { id: 'mouseSensitivity', type: 'range', label: 'Mouse sensitivity', min: 0.05, max: 0.40, step: 0.025, default: 0.15 },
  { id: 'invertY', type: 'toggle', label: 'Invert Y', values: [false, true], default: false },
  // Same flag the `N` key drives (US-020/audio.synth.js) - hidden by the
  // caller (game/js/ui/settings.js) if that module can't be loaded, per the
  // AC "hidden if US-020 is not built" (it is; kept as a live check, not an
  // assumption, in case a future embed omits audio).
  { id: 'mute', type: 'toggle', label: 'Mute', values: [false, true], default: false },
];

/** @returns {Object|null} the option definition, or null if `id` is unknown. */
export function findOption(id) {
  return OPTIONS.find((o) => o.id === id) || null;
}

/** Plain `{id: default}` map - the settings blob's shape before any save/URL override is applied. */
export function getDefaultValues() {
  const out = {};
  for (const o of OPTIONS) out[o.id] = o.default;
  return out;
}

function clampToStep(v, opt) {
  const steps = Math.round((v - opt.min) / opt.step);
  const clampedSteps = Math.max(0, Math.min(Math.round((opt.max - opt.min) / opt.step), steps));
  // toFixed-style rounding to kill float drift (0.1 + 0.025 etc.) without a decimal-string round trip.
  return Math.round((opt.min + clampedSteps * opt.step) * 1e6) / 1e6;
}

/**
 * One A/D (Left/Right) step on `opt`'s current value. Stops at the ends (no
 * wrap - US-038 AC "Navigation"); `isDisabled(value)` (optional) skips a
 * `choice` value the device can't take (US-038 AC "disabled" - e.g. a grid
 * `engine.setGrid` just refused), same as `uiStyle.settings.disabled.skip`.
 * Unknown/out-of-range `current` values fall back to `opt.default` first.
 * @param {Object} opt - an `OPTIONS` entry
 * @param {*} current
 * @param {1|-1} dir
 * @param {(value:*) => boolean} [isDisabled]
 */
export function stepOptionValue(opt, current, dir, isDisabled = () => false) {
  if (opt.type === 'range') {
    const from = typeof current === 'number' && Number.isFinite(current) ? current : opt.default;
    return clampToStep(from + dir * opt.step, opt);
  }
  const values = opt.values;
  let idx = values.indexOf(current);
  if (idx === -1) idx = values.indexOf(opt.default);
  let next = idx;
  for (let cand = idx + dir; cand >= 0 && cand < values.length; cand += dir) {
    if (isDisabled(values[cand])) continue; // skip a disabled value, keep stepping the same direction
    next = cand;
    break;
  }
  return values[next];
}

/** True if `id`/`value` is a valid, in-range combination (used by the platform load fallback). */
export function isValidValue(id, value) {
  const opt = findOption(id);
  if (!opt) return false;
  if (opt.type === 'range') return typeof value === 'number' && Number.isFinite(value) && value >= opt.min && value <= opt.max;
  return opt.values.includes(value);
}
