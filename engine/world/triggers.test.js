// engine/world/triggers.test.js (US-017). Headless Node ESM, no framework.
// Run: node engine/world/triggers.test.js
//
// Per the architect's tech notes (docs/backlog.md US-017 item 5): the
// tag/cells union and the mismatch warning, enter fires exactly once,
// `once`, circle `zMin`, and standing inside after a load.
import { World } from './World.js';
import { updateTriggers } from './triggers.js';
import { AssetRegistry } from '../core/assets.js';
import paletteMod from '../../design/palette.js';
import towerDef from '../../design/levels/tower.js';
// US-011 (7.5 item 1): World.load throws on an unregistered props[].model.
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; towerDef;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------
// A tiny synthetic level: an 'E' cell tagged `trigger:end` at (1,1), one
// `def.cells` entry that matches it exactly ([[1,1]]) for the no-mismatch
// case, and a circle trigger `hint` (r 1, zMin 1) centred at (5, 1).
// ---------------------------------------------------------------------------
function makeLevelDef(cellsOverride) {
  return {
    name: 'trig_test',
    legend: {
      '.': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false },
      'E': { floorH: 0, ceilH: 3, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false, tag: 'trigger:end' },
      '#': { floorH: 3, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: true },
    },
    rows: [
      '######',
      '.E...#',
      '......',
      '######',
    ],
    start: { x: 0.5, y: 2.5, facingDeg: 0 },
    triggers: [
      { id: 'end', cells: cellsOverride !== undefined ? cellsOverride : [[1, 1]], trigger: 'test.end', once: true },
      { id: 'hint', shape: 'circle', x: 5, y: 1, r: 1, zMin: 1, trigger: 'test.hint', once: false },
    ],
  };
}

function makeWorld(cellsOverride) {
  return World.load({
    name: 'triggers_test', terrain: null,
    structures: [{ id: 's1', level: 'trig_test_synthetic', origin: { x: 0, y: 0, z: 0 } }],
    entities: [{ id: 'player', type: 'player', transform: { x: 0.5, y: 2.5, z: 0, yawDeg: 0, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.8 } } }],
    state: {},
  }, {
    level: () => makeLevelDef(cellsOverride),
    terrain: () => { throw new Error('no terrain expected'); },
  });
}

let fired = [];
const fakeEngine = {};
function registerFakeBehaviours(world) {
  world.fireTrigger = (name, ctx) => { fired.push({ name, ctx }); return true; };
}

// ---------------------------------------------------------------------------
// 1. Tag + def.cells agree (no mismatch warning), mask built correctly.
// ---------------------------------------------------------------------------
{
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  const world = makeWorld();
  console.warn = origWarn;

  ok('1a: world.triggers has 2 records', world.triggers.length === 2, `got ${world.triggers.length}`);
  const end = world.triggers.find((t) => t.id === 'end');
  ok('1b: cell trigger mask marks (1,1)', end.mask[1 * end.levelW + 1] === 1);
  ok('1c: no mismatch warning when tag cells === def.cells', !warnings.some((w) => w.includes('differ')), warnings.join('|'));
}

// ---------------------------------------------------------------------------
// 2. Mismatch: def.cells names an extra cell the tag doesn't - warned once.
// ---------------------------------------------------------------------------
{
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  const world = makeWorld([[1, 1], [3, 1]]); // (3,1) has no `trigger:end` tag
  console.warn = origWarn;

  ok('2a: mismatch warning fires once', warnings.filter((w) => w.includes('differ')).length === 1, warnings.join('|'));
  const end = world.triggers.find((t) => t.id === 'end');
  ok('2b: union still includes the extra cell', end.mask[1 * end.levelW + 3] === 1);
  ok('2c: union still includes the tagged cell', end.mask[1 * end.levelW + 1] === 1);
}

// ---------------------------------------------------------------------------
// 3. Enter fires exactly once; `once` blocks a re-enter.
// ---------------------------------------------------------------------------
{
  fired = [];
  const world = makeWorld();
  registerFakeBehaviours(world);
  const actor = world.get('player').data;

  // Outside the trigger cell (0.5, 2.5) -> step into it (1.5, 1.5).
  updateTriggers(world, fakeEngine, actor);
  ok('3a: no fire while outside', fired.length === 0);

  actor.transform.x = 1.5; actor.transform.y = 1.5;
  updateTriggers(world, fakeEngine, actor);
  ok('3b: enter fires once', fired.length === 1 && fired[0].name === 'test.end');
  ok('3c: used flag set (once: true)', world.state['used.s1.end'] === true);

  // Still inside next step: no re-fire (no edge).
  updateTriggers(world, fakeEngine, actor);
  ok('3d: still inside does not refire', fired.length === 1);

  // Leave, then re-enter: `once` blocks it.
  actor.transform.x = 0.5; actor.transform.y = 2.5;
  updateTriggers(world, fakeEngine, actor);
  actor.transform.x = 1.5; actor.transform.y = 1.5;
  updateTriggers(world, fakeEngine, actor);
  ok('3e: once blocks a re-enter', fired.length === 1);
}

// ---------------------------------------------------------------------------
// 4. Circle + zMin: inside the radius but below zMin does not fire; above does.
// ---------------------------------------------------------------------------
{
  fired = [];
  const world = makeWorld();
  registerFakeBehaviours(world);
  const actor = world.get('player').data;
  actor.transform.x = 5.4; actor.transform.y = 1.4; actor.transform.z = 0; // inside r=1, below zMin=1

  updateTriggers(world, fakeEngine, actor);
  ok('4a: below zMin does not fire', fired.length === 0);

  actor.transform.z = 1.0;
  updateTriggers(world, fakeEngine, actor);
  ok('4b: at/above zMin fires', fired.length === 1 && fired[0].name === 'test.hint');

  // Not `once`: leaving and re-entering fires again.
  actor.transform.x = 0;
  updateTriggers(world, fakeEngine, actor);
  actor.transform.x = 5.4; actor.transform.z = 1.0;
  updateTriggers(world, fakeEngine, actor);
  ok('4c: not-once trigger refires on a second enter', fired.length === 2);
}

// ---------------------------------------------------------------------------
// 5. Standing inside right after a load counts as an enter (7.4 rule).
// ---------------------------------------------------------------------------
{
  fired = [];
  const world = World.load({
    name: 'triggers_test2', terrain: null,
    structures: [{ id: 's1', level: 'trig_test_synthetic2', origin: { x: 0, y: 0, z: 0 } }],
    entities: [{ id: 'player', type: 'player', transform: { x: 1.5, y: 1.5, z: 0, yawDeg: 0, pitchDeg: 0 }, components: { body: { radius: 0.3, height: 1.8 } } }],
    state: {},
  }, { level: () => makeLevelDef(), terrain: () => { throw new Error('no terrain'); } });
  registerFakeBehaviours(world);
  const actor = world.get('player').data;

  updateTriggers(world, fakeEngine, actor);
  ok('5a: standing inside after load fires on the first update', fired.length === 1 && fired[0].name === 'test.end');
}

// ---------------------------------------------------------------------------
// 6. Real tower data: the `end` trigger's tag cells === def.cells exactly
// (no mismatch warning on the actual content pack).
// ---------------------------------------------------------------------------
{
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  const world = World.load({
    name: 'tower_real_test', terrain: null,
    structures: [{ id: 'tower', level: 'tower', origin: { x: 1480, y: 1018, z: 0 } }],
    entities: [],
    state: {},
  }, assets);
  console.warn = origWarn;

  const end = world.triggers.find((t) => t.structId === 'tower' && t.id === 'end');
  ok('6a: real tower has the end trigger', !!end);
  ok('6b: no mismatch warning on real content', !warnings.some((w) => w.includes('differ')), warnings.join('|'));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
console.log('ALL PASS');
