// game/js/quest/practiceTarget.test.js (US-078d, PO REJECT gap 2 - Q12 item 1). Headless Node ESM, no framework.
// Run: node game/js/quest/practiceTarget.test.js
//
// Real content (world_m1's placed tower), same precedent as swordTake.test.js - never a hand-rolled fake def.
import { World } from '../../../engine/index.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import { createPracticeTarget, applyPropTargetables } from './practiceTarget.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; farTowerMod; ferrumLightsMod; // classic scripts: side effects on globalThis.ASSETS
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const worldM1 = assets.world('world_m1');
function freshWorld() {
  return World.load(worldM1, assets, {});
}
function makeEvents() {
  const listeners = new Map();
  return {
    on(name, fn) {
      let s = listeners.get(name); if (!s) { s = new Set(); listeners.set(name, s); } s.add(fn);
      return () => s.delete(fn);
    },
    emit(name, payload) { const s = listeners.get(name); if (!s) return; for (const fn of Array.from(s)) fn(payload); },
  };
}

// ---------------------------------------------------------------------------
// content: tower.level.json carries the "practiceTarget" prop (Q12 item 1a, content copy).
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const handle = world.get('tower.practiceTarget');
  ok('World.load auto-spawns the real practiceTarget prop entity', !!handle);
  ok('practiceTarget prop uses the practiceTarget voxel model', handle && handle.getComponent('voxel').model === 'practiceTarget');
  ok('World.load does not map `targetable` itself (PO REJECT gap 2 - stays game-side)', !handle.data.components.targetable);
}

// ---------------------------------------------------------------------------
// applyPropTargetables: maps the content `targetable: {r, zMin, zMax}` to `components.targetable {radius, height}`.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  applyPropTargetables(world);
  const handle = world.get('tower.practiceTarget');
  const tgb = handle.data.components.targetable;
  ok('applyPropTargetables adds components.targetable', !!tgb);
  ok('radius = targetable.r (0.2)', tgb.radius === 0.2);
  ok('height = targetable.zMax (1.6, PO REJECT\'s exact mapping, not zMax-zMin)', tgb.height === 1.6);
}
{
  // Idempotent / safe to call twice (main.js calls it once per world:loaded, every load/restart).
  const world = freshWorld();
  applyPropTargetables(world);
  applyPropTargetables(world);
  const tgb = world.get('tower.practiceTarget').data.components.targetable;
  ok('calling applyPropTargetables twice is harmless', tgb.radius === 0.2 && tgb.height === 1.6);
}
{
  // A prop with no `targetable` key (e.g. the sword) is left untouched - no spurious component.
  const world = freshWorld();
  applyPropTargetables(world);
  ok('a prop with no targetable key gets no components.targetable', !world.get('tower.sword').data.components.targetable);
}

// ---------------------------------------------------------------------------
// createPracticeTarget: combat:hit on *.practiceTarget plays flash -> wobble (32 steps) -> idle; a hit during
// wobble restarts flash. A hit on an unrelated target is ignored.
// ---------------------------------------------------------------------------
{
  const world = freshWorld();
  const events = makeEvents();
  const pt = createPracticeTarget(world, events, { flash: 6 });
  const handle = world.get('tower.practiceTarget');

  events.emit('combat:hit', { source: 'player', target: 'tower.sword', damage: 1 }); // unrelated target: ignored
  ok('a hit on an unrelated target does not touch the practice target', handle.getComponent('voxel').anim !== 'flash');

  events.emit('combat:hit', { source: 'player', target: 'tower.practiceTarget', damage: 1 });
  ok('combat:hit on *.practiceTarget plays flash', handle.getComponent('voxel').anim === 'flash');

  for (let i = 0; i < 5; i++) pt.step();
  ok('still flash before 6 steps elapse', handle.getComponent('voxel').anim === 'flash');
  pt.step();
  ok('flash -> wobble at exactly 6 steps', handle.getComponent('voxel').anim === 'wobble');

  // A hit during wobble restarts flash.
  events.emit('combat:hit', { source: 'player', target: 'tower.practiceTarget', damage: 1 });
  ok('a hit during wobble restarts flash', handle.getComponent('voxel').anim === 'flash');

  for (let i = 0; i < 6; i++) pt.step();
  ok('restarted flash -> wobble again at 6 steps', handle.getComponent('voxel').anim === 'wobble');
  for (let i = 0; i < 32; i++) pt.step();
  ok('wobble -> idle at 32 steps', handle.getComponent('voxel').anim === 'idle');

  pt.dispose();
  events.emit('combat:hit', { source: 'player', target: 'tower.practiceTarget', damage: 1 });
  ok('dispose() drops the listener - a hit after dispose does nothing', handle.getComponent('voxel').anim === 'idle');
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
