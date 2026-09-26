// tools/editor/livepatch.test.mjs - US-064 (docs/architecture.md 24.8's
// commit->rebuild path measured at 73-90 ms against the real tower vs the
// 5 ms budget). Plain Node ESM, no framework. Run with:
//
//   node tools/editor/livepatch.test.mjs
import {
  isPatchableRecord, applyPropTransformPatch, applyLightPatch, findLightHandle, resolveLightPreset,
} from './livepatch.js';
import { makeFieldEditRecord, makeInsertRecord, makeDeleteRecord, makeRenameBatch, applyEdit, invert } from './commands.js';
import { World, LightSet, buildLightSet } from '../../engine/index.js';
import { loadTestAssets } from '../testing/content-node.mjs';
import paletteMod from '../../design/palette.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import terrainDef from '../../design/levels/overworld_far.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod;
farTowerMod; ferrumLightsMod; terrainDef;
// Loaded ONCE (world.test.js's own precedent) - `loadTestAssets` merges into
// `globalThis.ASSETS` and a second call trips the "no dual source" guard.
const { assets: realAssets } = await loadTestAssets();

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
function approxArr(a, b, eps = 1e-6) {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
}

// ---- isPatchableRecord: classification -------------------------------------
{
  const before = { id: 'brazier', model: 'brazier', x: 1, y: 1, z: 0, facing: 0 };
  const nudge = makeFieldEditRecord('nudge', 'level/fixture', 'props', before, 0, { x: 1.25 });
  ok('prop x nudge is patchable', isPatchableRecord(nudge));

  const yaw = makeFieldEditRecord('yaw', 'level/fixture', 'props', before, 0, { facing: 45 });
  ok('prop facing yaw is patchable', isPatchableRecord(yaw));

  const modelEdit = makeFieldEditRecord('edit', 'level/fixture', 'props', before, 0, { model: 'rubble' });
  ok('prop model edit is NOT patchable (no live model swap)', !isPatchableRecord(modelEdit));

  const idEdit = makeFieldEditRecord('edit', 'level/fixture', 'props', before, 0, { id: 'brazier2' });
  ok('an id-changing field edit is NOT patchable (handled as a rename batch anyway)', !isPatchableRecord(idEdit));

  const lightBefore = { id: 'brazier', preset: 'torch', x: 1, y: 1, z: 1.2, on: true };
  const lightMove = makeFieldEditRecord('nudge', 'level/fixture', 'lights', lightBefore, 0, { x: 1.5 });
  ok('light x nudge is patchable', isPatchableRecord(lightMove));
  const lightToggle = makeFieldEditRecord('edit', 'level/fixture', 'lights', lightBefore, 0, { on: false });
  ok('light on/off toggle is patchable', isPatchableRecord(lightToggle));
  const lightPreset = makeFieldEditRecord('edit', 'level/fixture', 'lights', lightBefore, 0, { preset: 'relay' });
  ok('light preset edit IS patchable (US-069: LightSet.setParams closed the gap)', isPatchableRecord(lightPreset));

  const worldProp = { id: 'endMarker', type: 'prop', components: { voxel: { model: 'x' } }, x: 0, y: 0, z: 0, yawDeg: 0 };
  const worldPropMove = makeFieldEditRecord('nudge', 'world/w', 'entities', worldProp, 0, { x: 1 });
  ok('a world-file prop entity move is patchable', isPatchableRecord(worldPropMove));
  const notAProp = { id: 'somethingElse', type: 'marker', x: 0, y: 0 };
  const otherEntityMove = makeFieldEditRecord('nudge', 'world/w', 'entities', notAProp, 0, { x: 1 });
  ok('a non-prop world entity is NOT patchable', !isPatchableRecord(otherEntityMove));

  const insert = makeInsertRecord('level/fixture', 'props', before);
  ok('an insert (place) is NOT patchable - always a full rebuild', !isPatchableRecord(insert));
  const del = makeDeleteRecord('level/fixture', 'props', before, 0);
  ok('a delete is NOT patchable - always a full rebuild', !isPatchableRecord(del));
  const rename = makeRenameBatch('level/fixture', 'level', 'props', before, 0, 'brazier2', { props: [before], lights: [], interactables: [], triggers: [] });
  ok('a rename batch is NOT patchable - always a full rebuild', !isPatchableRecord(rename));
}

// ---- applyPropTransformPatch --------------------------------------------
{
  const t = { x: 0, y: 0, z: 0, yawDeg: 0 };
  applyPropTransformPatch(t, { x: 5, y: 6, z: 1, facing: 90 }, { x: 100, y: 200, z: 10 }, false);
  ok('level-space prop: x/y/z add the structure origin', t.x === 105 && t.y === 206 && t.z === 11, JSON.stringify(t));
  ok('level-space prop: facing maps to transform.yawDeg', t.yawDeg === 90);

  const t2 = { x: 0, y: 0, z: 3, yawDeg: 45 };
  applyPropTransformPatch(t2, { x: 5, y: 6, z: 'ground' }, { x: 0, y: 0, z: 0 }, false);
  ok('a non-numeric z (\'ground\') leaves transform.z untouched', t2.z === 3);
  ok('an untouched facing leaves transform.yawDeg untouched', t2.yawDeg === 45);

  const t3 = { x: 0, y: 0, z: 0, yawDeg: 0 };
  applyPropTransformPatch(t3, { x: 5, y: 6, z: 1, yawDeg: 200 }, { x: 0, y: 0, z: 0 }, true);
  ok('world-space prop: x/y/z pass through unchanged (no origin)', t3.x === 5 && t3.y === 6 && t3.z === 1);
  ok('world-space prop: yawDeg field maps directly', t3.yawDeg === 200);
}

// ---- applyLightPatch / findLightHandle (fake LightSet) ---------------------
{
  function fakeLightSet() {
    const moves = [];
    let onCalls = [];
    const paramCalls = [];
    return {
      count: 2,
      key: ['tower.brazier', 'tower.beacon'],
      move(h, x, y, z) { moves.push({ h, x, y, z }); },
      setOn(h, on) { onCalls.push({ h, on }); },
      setParams(h, p) { paramCalls.push({ h, p }); },
      _moves: moves,
      get _onCalls() { return onCalls; },
      _paramCalls: paramCalls,
    };
  }
  const ls = fakeLightSet();
  ok('findLightHandle finds an existing key', findLightHandle(ls, 'tower.brazier') === 0);
  ok('findLightHandle finds the second key', findLightHandle(ls, 'tower.beacon') === 1);
  ok('findLightHandle returns -1 for an unknown key', findLightHandle(ls, 'tower.nope') === -1);

  applyLightPatch(ls, 0, { x: 1, y: 2, z: 1.2, on: false }, { x: 10, y: 20, z: 0 }, false);
  ok('applyLightPatch moves the handle in world space (origin added)', ls._moves[0].x === 11 && ls._moves[0].y === 22 && ls._moves[0].z === 1.2, JSON.stringify(ls._moves[0]));
  ok('applyLightPatch toggles on/off when the patch carries it', ls._onCalls[0].h === 0 && ls._onCalls[0].on === false);
  ok('applyLightPatch does not call setParams when the patch carries no preset', ls._paramCalls.length === 0);

  // US-069: a `preset` edit resolves through the palette and calls `setParams`.
  const torch = resolveLightPreset(realAssets.palette, 'torch');
  ok('resolveLightPreset resolves a real preset', torch && typeof torch.radius === 'number' && Array.isArray(torch.hue), JSON.stringify(torch));
  ok('resolveLightPreset returns null for an unknown preset', resolveLightPreset(realAssets.palette, 'nope_preset') === null);

  applyLightPatch(ls, 1, { x: 5, y: 5, z: 1.2, preset: 'torch' }, { x: 0, y: 0, z: 0 }, true, realAssets.palette);
  ok('applyLightPatch: a preset edit calls setParams with the resolved params', ls._paramCalls.length === 1 && ls._paramCalls[0].h === 1, JSON.stringify(ls._paramCalls));
  ok('applyLightPatch: setParams params match resolveLightPreset', JSON.stringify(ls._paramCalls[0].p) === JSON.stringify(torch), JSON.stringify(ls._paramCalls[0].p));

  // An unknown preset name: still moves/no throw, but no setParams call (nothing to resolve to).
  const lsBad = fakeLightSet();
  applyLightPatch(lsBad, 0, { x: 1, y: 1, z: 1, preset: 'not_a_real_preset' }, { x: 0, y: 0, z: 0 }, true, realAssets.palette);
  ok('applyLightPatch: an unknown preset name is a no-op for setParams (no throw)', lsBad._paramCalls.length === 0);
}

// ---- integration: a real tower prop + a real tower light, patched live ----
{
  const world = World.load(realAssets.world('world_m1'), realAssets, {});
  const tower = world.structures.find((s) => s.id === 'tower');
  ok('fixture: the real tower has a "brazier" prop', !!tower.level.def.props.find((p) => p.id === 'brazier'));

  const brazierProp = tower.level.def.props.find((p) => p.id === 'brazier');
  const before = { ...brazierProp };
  const entId = `${tower.id}.brazier`;
  const entity = world.entity(entId);
  ok('the real World spawned a live entity for the tower brazier prop', !!entity);
  const beforeTransform = { ...entity.transform };

  const rec = makeFieldEditRecord('nudge', 'level/tower', 'props', brazierProp, 0, { x: brazierProp.x + 0.25 });
  ok('a real nudge record is patchable', isPatchableRecord(rec));
  applyPropTransformPatch(entity.transform, rec.after, tower.origin, false);
  ok('the live entity transform moved by the nudge amount', Math.abs(entity.transform.x - (beforeTransform.x + 0.25)) < 1e-9, String(entity.transform.x));
  ok('no other transform field moved', entity.transform.y === beforeTransform.y && entity.transform.z === beforeTransform.z && entity.transform.yawDeg === beforeTransform.yawDeg);

  // Undo (invert + patch) restores the EXACT pre-edit transform - the
  // US-064 AC's "a patch-path-specific undo test proving a patched-then-
  // undone edit produces byte-identical state to before the edit".
  const inv = invert(rec);
  applyPropTransformPatch(entity.transform, inv.after, tower.origin, false);
  ok('undo (patch path) restores the exact pre-edit transform (byte-identical)', JSON.stringify(entity.transform) === JSON.stringify(beforeTransform), JSON.stringify(entity.transform));

  // The real tower light "brazier" (co-located, same id, different
  // collection - see commands.test.mjs's own note on this).
  const lightDef = tower.level.def.lights.find((l) => l.id === 'brazier');
  ok('fixture: the real tower has a "brazier" light', !!lightDef);
  ok('fixture: it starts on the "torch" preset', lightDef.preset === 'torch', lightDef.preset);
}

// ---- integration: a real LightSet, a light `preset` edit patched live -----
// (US-069, closing the US-064 gap: "extend the existing live-patch timing
// test to cover a light preset edit going through the PATCH path now, not a
// full World.load rebuild").
{
  const world = World.load(realAssets.world('world_m1'), realAssets, {});
  const ls = buildLightSet(world, realAssets.palette);
  const key = 'tower.brazier';
  const handle = findLightHandle(ls, key);
  ok('a real LightSet has a handle for the tower brazier light', handle >= 0, String(handle));

  ls.update(0, world); // seed pos/col from the initial ("torch") preset
  const torchExpected = resolveLightPreset(realAssets.palette, 'torch');
  ok('fixture: the live handle starts with the torch preset\'s radius', ls.pos[handle * 4 + 3] === torchExpected.radius, String(ls.pos[handle * 4 + 3]));

  const rec = makeFieldEditRecord('edit', 'level/tower', 'lights', { id: 'brazier', preset: 'torch', x: 18.5, y: 6.5, z: 1.2, on: true }, 0, { preset: 'relay' });
  ok('a real preset edit record is patchable (isPatchableRecord)', isPatchableRecord(rec));

  let worldLoadCallsForPreset = 0;
  const realLoadForPreset = World.load;
  World.load = (...args) => { worldLoadCallsForPreset++; return realLoadForPreset.apply(World, args); };
  try {
    applyLightPatch(ls, handle, rec.after, { x: 0, y: 0, z: 0 }, false, realAssets.palette);
  } finally {
    World.load = realLoadForPreset;
  }
  ok('the "gap closed" proof: a preset edit patches live with ZERO World.load calls', worldLoadCallsForPreset === 0, String(worldLoadCallsForPreset));

  const relayExpected = resolveLightPreset(realAssets.palette, 'relay');
  ok('setParams was applied to the raw fields immediately', ls.radius[handle] === relayExpected.radius && approxArr(ls.baseHue.slice(handle * 3, handle * 3 + 3), relayExpected.hue));
  ls.update(0, world); // "next frame" - the live buffer picks it up
  ok('the GPU-facing pos/col buffer reflects the new preset on the next update()', ls.pos[handle * 4 + 3] === relayExpected.radius, `${ls.pos[handle * 4 + 3]} vs ${relayExpected.radius}`);
}

// ---- Node timing probe: 100 nudges of one existing prop, doc+patch only ---
// (US-064 AC: "< 5 ms each (median) on the new doc+patch path (no World.load
// call in the hot path)"). Builds the World ONCE outside the loop - the
// whole point being that a real per-edit World.load never happens again.
{
  const world = World.load(realAssets.world('world_m1'), realAssets, {});
  const tower = world.structures.find((s) => s.id === 'tower');
  const entId = `${tower.id}.brazier`;
  const entity = world.entity(entId);

  // A minimal one-file doc over the real tower def (mirrors doc.js's own
  // "def IS the registry's own object" convention) - only `props` is
  // exercised here.
  const doc = { files: new Map([['level/tower', { kind: 'level', id: 'tower', def: tower.level.def, meta: { nextId: 1000 }, dirty: false, handle: null }]]) };
  const N = 100;
  const durations = [];
  let worldLoadCalls = 0;
  const realLoad = World.load;
  World.load = (...args) => { worldLoadCalls++; return realLoad.apply(World, args); };
  try {
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const item = doc.files.get('level/tower').def.props.find((p) => p.id === 'brazier');
      const index = doc.files.get('level/tower').def.props.indexOf(item);
      const sign = i % 2 === 0 ? 1 : -1;
      const rec = makeFieldEditRecord('nudge', 'level/tower', 'props', item, index, { x: item.x + sign * 0.05 });
      applyEdit(doc, rec);
      if (isPatchableRecord(rec)) applyPropTransformPatch(entity.transform, rec.after, tower.origin, false);
      durations.push(performance.now() - t0);
    }
  } finally {
    World.load = realLoad;
  }
  ok('World.load was never called by the 100-nudge doc+patch loop', worldLoadCalls === 0);
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  ok(`100 nudges: median duration < 5 ms (got ${median.toFixed(4)} ms)`, median < 5);
  console.log(`  (100-nudge doc+patch median: ${median.toFixed(4)} ms, max: ${sorted[sorted.length - 1].toFixed(4)} ms)`);
}

console.log(`livepatch.test.mjs: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
