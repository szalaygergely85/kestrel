// tools/editor/panel.test.mjs - US-033 (docs/architecture.md 24.13: "place +
// panel - tests: validation table"). Plain Node ESM, no DOM (only the pure
// top half of panel.js is exercised here - the DOM form builder at the
// bottom is browser-only, same split as pick.js/select.js).
import {
  isValidId, lightPresetNames, countLights, harvestBehaviourNames,
  defaultItemForKind, defaultWorldPropItem, kindForSelection, validateItem,
} from './panel.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ' - ' + detail : ''}`);
  }
}

// ---- isValidId --------------------------------------------------------------
ok('isValidId: accepts letter-start alnum/_/-', isValidId('prop_7') && isValidId('a') && isValidId('A-b_9'));
ok('isValidId: rejects a leading digit', !isValidId('7prop'));
ok('isValidId: rejects punctuation', !isValidId('prop.7') && !isValidId('prop 7'));
ok('isValidId: rejects empty/non-string', !isValidId('') && !isValidId(undefined) && !isValidId(3));

// ---- lightPresetNames --------------------------------------------------------
{
  const palette = { lights: { ambient: {}, sun: {}, torch: {}, lantern: {} } };
  const names = lightPresetNames(palette);
  ok('lightPresetNames: excludes ambient/sun', !names.includes('ambient') && !names.includes('sun'));
  ok('lightPresetNames: keeps real presets', names.includes('torch') && names.includes('lantern'));
}

// ---- countLights / harvestBehaviourNames -------------------------------------
{
  const doc = {
    files: new Map([
      ['level/a', { kind: 'level', def: { lights: [{ id: 'l1' }, { id: 'l2' }], interactables: [{ id: 'i1', interact: 'lever.pull' }], triggers: [{ id: 't1', trigger: 'hint.show' }] } }],
      ['level/b', { kind: 'level', def: { lights: [{ id: 'l3' }] } }],
      ['world/w', { kind: 'world', def: { entities: [] } }],
    ]),
  };
  ok('countLights: sums lights across level files', countLights(doc) === 3, String(countLights(doc)));
  const names = harvestBehaviourNames(doc);
  ok('harvestBehaviourNames: finds interact + trigger names', names.includes('lever.pull') && names.includes('hint.show'), JSON.stringify(names));
}

// ---- defaultItemForKind ------------------------------------------------------
{
  const pos = { x: 1, y: 2, z: 3 };
  const prop = defaultItemForKind('prop', 'prop_1', pos, { modelKey: 'lantern' });
  ok('defaultItemForKind prop: shape', prop.model === 'lantern' && prop.x === 1 && prop.y === 2 && prop.z === 3 && prop.facing === 0);

  const light = defaultItemForKind('light', 'light_1', pos);
  ok('defaultItemForKind light: preset torch, z lifted 1.2m, on', light.preset === 'torch' && light.z === 4.2 && light.on === true);

  const trigger = defaultItemForKind('trigger', 'trigger_1', pos);
  ok('defaultItemForKind trigger: circle zone, r 1.5, zMin below z', trigger.shape === 'circle' && trigger.type === 'zone' && trigger.r === 1.5 && trigger.zMin === 2.5);

  const inter = defaultItemForKind('interactable', 'interactable_1', pos);
  ok('defaultItemForKind interactable: radius 1.5, prompt, empty interact', inter.radius === 1.5 && inter.prompt === '[E] Use' && inter.interact === '');

  let threw = false;
  try { defaultItemForKind('nope', 'x', pos); } catch (e) { threw = true; }
  ok('defaultItemForKind: throws on an unknown kind', threw);

  const worldProp = defaultWorldPropItem('prop_2', pos, 'waystone');
  ok('defaultWorldPropItem: components.voxel.model + yawDeg (world-entity shape)', worldProp.type === 'prop' && worldProp.components.voxel.model === 'waystone' && worldProp.yawDeg === 0);
}

// ---- kindForSelection ---------------------------------------------------------
ok('kindForSelection: props/lights/triggers/interactables/entities', [
  kindForSelection({ collection: 'props' }) === 'prop',
  kindForSelection({ collection: 'lights' }) === 'light',
  kindForSelection({ collection: 'triggers' }) === 'trigger',
  kindForSelection({ collection: 'interactables' }) === 'interactable',
  kindForSelection({ collection: 'entities' }) === 'entity',
].every(Boolean));

// ---- validateItem: the validation table (24.13's own wording) ---------------
const fakeAssets = { has: (kind, key) => kind === 'model' && (key === 'lantern' || key === 'waystone') };
const palette = { lights: { ambient: {}, sun: {}, torch: {}, lantern: {} } };

{
  const item = { id: 'prop_1', model: 'lantern', x: 1, y: 2, z: 0, facing: 0 };
  const errs = validateItem('prop', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: a valid prop has no errors', errs.length === 0, JSON.stringify(errs));
}
{
  const item = { id: '7bad', model: 'lantern', x: 1, y: 2, z: 0 };
  const errs = validateItem('prop', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects a bad id format', errs.some((e) => e.startsWith('id:')), JSON.stringify(errs));
}
{
  const item = { id: 'prop_1', model: 'lantern', x: 1, y: 2, z: 0 };
  const errs = validateItem('prop', item, { assets: fakeAssets, palette, siblingIds: new Set(['prop_1']) });
  ok('validateItem: rejects a duplicate id', errs.some((e) => e.includes('already used')), JSON.stringify(errs));
}
{
  const item = { id: 'prop_1', model: 'ghost-model', x: 1, y: 2, z: 0 };
  const errs = validateItem('prop', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects an unknown model key', errs.some((e) => e.includes('model')), JSON.stringify(errs));
}
{
  const item = { id: 'light_1', preset: 'nope', x: 1, y: 2, z: 0 };
  const errs = validateItem('light', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects an unknown light preset', errs.some((e) => e.includes('preset')), JSON.stringify(errs));
}
{
  const item = { id: 'trigger_1', x: 1, y: 2, r: -1 };
  const errs = validateItem('trigger', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects r <= 0', errs.some((e) => e.startsWith('r:')), JSON.stringify(errs));
}
{
  const item = { id: 'interactable_1', x: 1, y: 2, radius: 0 };
  const errs = validateItem('interactable', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects radius <= 0', errs.some((e) => e.startsWith('radius:')), JSON.stringify(errs));
}
{
  const item = { id: 'trigger_1', x: 1, y: 2, zMin: 5, zMax: 2 };
  const errs = validateItem('trigger', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects zMin >= zMax', errs.some((e) => e.includes('zMin')), JSON.stringify(errs));
}
{
  const item = { id: 'prop_1', model: 'lantern', x: NaN, y: 2, z: 0 };
  const errs = validateItem('prop', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: rejects a NaN position (this story\'s own "never invalid" AC)', errs.some((e) => e.startsWith('x:')), JSON.stringify(errs));
}
{
  // A world-file "entity" prop (endMarker shape): model lives under components.voxel.
  const item = { id: 'prop_2', type: 'prop', components: { voxel: { model: 'waystone' } }, x: 1, y: 2, z: 0, yawDeg: 0 };
  const errs = validateItem('entity', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: reads model out of components.voxel for a world-entity prop', errs.length === 0, JSON.stringify(errs));
}
{
  // player (no model field at all) - an "entity" with no model must not be forced to have one.
  const item = { id: 'player', x: 1, y: 2, z: 0 };
  const errs = validateItem('entity', item, { assets: fakeAssets, palette, siblingIds: new Set() });
  ok('validateItem: a plain entity with no model field is not forced to have one', errs.length === 0, JSON.stringify(errs));
}

console.log(`panel.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
