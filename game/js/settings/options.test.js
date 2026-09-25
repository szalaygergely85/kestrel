// game/js/settings/options.test.js (US-038b, row 30f). Headless Node ESM,
// no framework - same style as game/js/ui/titleCard.test.js.
// Run: node game/js/settings/options.test.js
import { OPTIONS, GRID_VALUES, ULTRA_GRID_VALUES, findOption, getDefaultValues, stepOptionValue, isValidValue } from './options.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---- shape (US-038 AC "Data-driven") ----
for (const o of OPTIONS) {
  ok(`${o.id}: has id/label/type`, typeof o.id === 'string' && typeof o.label === 'string'
    && ['choice', 'toggle', 'range'].includes(o.type));
  if (o.type === 'range') {
    ok(`${o.id}: range has min/max/step/default`, typeof o.min === 'number' && typeof o.max === 'number'
      && typeof o.step === 'number' && typeof o.default === 'number' && o.default >= o.min && o.default <= o.max);
  } else {
    ok(`${o.id}: choice/toggle has values[] + default in it`, Array.isArray(o.values) && o.values.includes(o.default));
  }
}

const ids = OPTIONS.map((o) => o.id);
ok('has grid/fullscreen/mouseSensitivity/invertY/mute', ['grid', 'fullscreen', 'mouseSensitivity', 'invertY', 'mute'].every((id) => ids.includes(id)));

// ---- grid: 240x90/320x120/400x150/480x180, default 240x90 (D-025) ----
ok('GRID_VALUES matches D-025 list', JSON.stringify(GRID_VALUES) === JSON.stringify(['240x90', '320x120', '400x150', '480x180']));
ok('grid default is 240x90', findOption('grid').default === '240x90');
// Per the actual US-038a bench result + uiStyle.settings v1.16 (design), only
// 480x180 is 'ultra' - 400x150 benched as "normal" (see options.js header).
ok('only 480x180 is ultra', JSON.stringify(ULTRA_GRID_VALUES) === JSON.stringify(['480x180']));

// ---- mouse sensitivity: 0.05-0.40 step 0.025 default 0.15 ----
const sens = findOption('mouseSensitivity');
ok('sensitivity range', sens.min === 0.05 && sens.max === 0.40 && sens.step === 0.025 && sens.default === 0.15);

// ---- findOption ----
ok('findOption unknown -> null', findOption('nope') === null);
ok('findOption known', findOption('mute').id === 'mute');

// ---- getDefaultValues ----
{
  const d = getDefaultValues();
  ok('getDefaultValues has every option id', ids.every((id) => id in d));
  ok('getDefaultValues grid default', d.grid === '240x90');
  ok('getDefaultValues invertY default false', d.invertY === false);
}

// ---- stepOptionValue: choice (grid), no wrap ----
{
  const grid = findOption('grid');
  ok('grid step +1 from 240x90 -> 320x120', stepOptionValue(grid, '240x90', 1) === '320x120');
  ok('grid step -1 from 240x90 stays at 240x90 (no wrap)', stepOptionValue(grid, '240x90', -1) === '240x90');
  ok('grid step +1 from 480x180 stays at 480x180 (no wrap)', stepOptionValue(grid, '480x180', 1) === '480x180');
  ok('grid step -1 from 480x180 -> 400x150', stepOptionValue(grid, '480x180', -1) === '400x150');
  ok('grid step from an unknown current value falls back to default first', stepOptionValue(grid, 'bogus', 1) === '320x120');
}

// ---- stepOptionValue: disabled values are skipped, still no wrap ----
{
  const grid = findOption('grid');
  const disabled = (v) => v === '400x150';
  ok('grid step +1 skips a disabled middle value', stepOptionValue(grid, '320x120', 1, disabled) === '480x180');
  ok('grid step -1 skips a disabled middle value', stepOptionValue(grid, '480x180', -1, disabled) === '320x120');
  const allDisabledAbove = (v) => v === '400x150' || v === '480x180';
  ok('grid step +1 with every value above disabled stays put', stepOptionValue(grid, '320x120', 1, allDisabledAbove) === '320x120');
}

// ---- stepOptionValue: toggle ----
{
  const fs = findOption('fullscreen');
  ok('toggle step +1 from false -> true', stepOptionValue(fs, false, 1) === true);
  ok('toggle step +1 from true stays true (no wrap)', stepOptionValue(fs, true, 1) === true);
  ok('toggle step -1 from true -> false', stepOptionValue(fs, true, -1) === false);
  ok('toggle step -1 from false stays false (no wrap)', stepOptionValue(fs, false, -1) === false);
}

// ---- stepOptionValue: range (mouse sensitivity), clamps at the ends, no float drift ----
{
  const s = findOption('mouseSensitivity');
  ok('range step +1 from 0.15 -> 0.175', Math.abs(stepOptionValue(s, 0.15, 1) - 0.175) < 1e-9);
  ok('range step -1 from 0.05 stays at 0.05 (clamped)', stepOptionValue(s, 0.05, -1) === 0.05);
  ok('range step +1 from 0.40 stays at 0.40 (clamped)', stepOptionValue(s, 0.40, 1) === 0.40);
  ok('range step from NaN/undefined falls back to default first', stepOptionValue(s, undefined, 1) === 0.175);
  // ten downward steps from the max should land exactly on a step boundary, no drift
  let v = 0.40;
  for (let i = 0; i < 10; i++) v = stepOptionValue(s, v, -1);
  ok('repeated stepping has no float drift', Math.abs(v - 0.15) < 1e-9);
}

// ---- isValidValue ----
{
  ok('isValidValue: known good grid', isValidValue('grid', '320x120') === true);
  ok('isValidValue: bad grid string', isValidValue('grid', '999x999') === false);
  ok('isValidValue: range in bounds', isValidValue('mouseSensitivity', 0.2) === true);
  ok('isValidValue: range out of bounds', isValidValue('mouseSensitivity', 5) === false);
  ok('isValidValue: unknown id', isValidValue('nope', 1) === false);
}

if (failures.length) {
  console.error(`FAIL (${fail} of ${pass + fail}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
} else {
  console.log(`ALL PASS (${pass} checks)`);
  process.exit(0);
}
