// engine/world/interaction.test.js (US-012). Headless Node ESM, no
// framework. Run: node engine/world/interaction.test.js
//
// Sections 1-7 (mechanics: cone/reach/nearest/LOS/once/requires/no-alloc)
// use an inline fixture (architect tech note 6) - a hand-built "world" with
// just the surface `findInteractTarget`/`updateInteraction` read
// (`interactables`, `state`, `sectorAt`, `get`, `fireInteraction`,
// `events`, `_emit`), no real Level/AssetRegistry needed. Section 8 (the
// serialize round trip) needs the real engine + design assets, since
// `world.state`/`components.light` round-tripping is `serialize.js`'s job,
// not this story's.
import { findInteractTarget, updateInteraction, hasLineOfSight } from './interaction.js';
import { World, serialize, deserialize } from '../index.js';
import paletteMod from '../../design/palette.js';
// US-027b: test_room moved to content/levels/test_room.level.json.
import { loadTestAssets } from '../../tools/testing/content-node.mjs';

paletteMod; // classic script: side effect on globalThis.ASSETS
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

// ---------------------------------------------------------------------------
// Inline fixture: a "world" with just the surface interaction.js reads.
// ---------------------------------------------------------------------------
// Default fixture: one structure covering the whole plane at origin.z = 0,
// so `structureAt` always matches (sections 1-9 predate the structure/
// terrain split and don't care about footprint edges). `_setStructures`/
// `_setTerrain` let sections 10-11 override this for the origin.z and
// outside-the-footprint cases the architect's fix targets.
function makeWorld() {
  const solid = new Set(); // 'x,y' integer cell keys
  const entities = new Map();
  const behaviours = new Map();
  let structures = [{
    origin: { x: 0, y: 0, z: 0 },
    bbox: { x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 },
    level: {
      sectorAt(lx, ly) {
        return solid.has(`${Math.floor(lx)},${Math.floor(ly)}`)
          ? { solid: true, floorH: 0, ceilH: 3 }
          : { solid: false, floorH: 0, ceilH: 3 };
      },
    },
  }];
  let terrain = null; // { heightAt(x, y) } or null -> outsideSector is solid (D-008 default)
  const w = {
    state: {},
    interactables: [],
    interaction: { targetKey: null, prompt: '', dist: 0, angleDeg: 0 },
    events: null,
    structureAt(x, y) {
      for (const s of structures) {
        const b = s.bbox;
        if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return s;
      }
      return null;
    },
    outsideSector(x, y) {
      if (!terrain) return { solid: true, floorH: 0, ceilH: 0 };
      return { solid: false, floorH: terrain.heightAt(x, y), ceilH: 'sky' };
    },
    get(id) { return entities.get(id) || null; },
    fireInteraction(name, ctx) {
      const fn = behaviours.get(name);
      return fn ? fn(ctx) : undefined;
    },
    _emit() {}, // interact-listener ring: not under test here
    // test-only helpers ------------------------------------------------------
    _blockCell(x, y) { solid.add(`${x},${y}`); },
    _setEntity(id, e) { entities.set(id, e); },
    _setBehaviour(name, fn) { behaviours.set(name, fn); },
    _setStructures(list) { structures = list; },
    _setTerrain(t) { terrain = t; },
  };
  return w;
}

/** One interactable at `angleFromNorthDeg`/`dist` from the origin (eye at 0,0,0 looking due north, pitch 0). */
function recAtAngle(id, angleFromNorthDeg, dist, extra = {}) {
  const rad = angleFromNorthDeg * Math.PI / 180;
  return {
    key: `s.${id}`, structId: 's', id, name: `${id}.use`,
    x: dist * Math.sin(rad), y: -dist * Math.cos(rad), z: 0,
    radius: 1.8, prompt: `[E] ${id}`, once: false, requires: null, propId: null,
    def: {}, usedKey: null,
    ...extra,
  };
}

const EYE_NORTH = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0 };

// ---------------------------------------------------------------------------
// 1. Cone: 19 deg is a hit, 21 deg is a miss (default coneDeg = 20).
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
  w.interactables = [recAtAngle('a19', 19, 1.0)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('19 deg inside the 20 deg cone: a hit', out.targetKey === 's.a19', JSON.stringify(out));

  w.interactables = [recAtAngle('a21', 21, 1.0)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('21 deg outside the 20 deg cone: a miss', out.targetKey === null, JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 2. Reach: 1.79 m is a hit, 1.81 m is a miss (radius 1.8, default reach 1.8).
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
  w.interactables = [recAtAngle('near', 0, 1.79)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('1.79 m within radius/reach 1.8: a hit', out.targetKey === 's.near');

  w.interactables = [recAtAngle('far', 0, 1.81)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('1.81 m beyond radius/reach 1.8: a miss', out.targetKey === null);
}

// ---------------------------------------------------------------------------
// 3. Of two targets in the cone, the one nearest the view centre wins.
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
  w.interactables = [recAtAngle('wide', 15, 1.0), recAtAngle('narrow', 5, 1.0)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('nearest-to-centre wins regardless of array order', out.targetKey === 's.narrow', JSON.stringify(out));

  w.interactables = [recAtAngle('narrow', 5, 1.0), recAtAngle('wide', 15, 1.0)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('...and order-independent', out.targetKey === 's.narrow', JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 4. Line of sight blocked through a solid cell.
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  ok('hasLineOfSight: clear line, nothing blocking', hasLineOfSight(w, 0, 0, 0.5, 0, -1.5, 0.5));
  w._blockCell(0, -1);
  ok('hasLineOfSight: a solid cell in between blocks it', !hasLineOfSight(w, 0, 0, 0.5, 0, -1.5, 0.5));

  const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
  w.interactables = [recAtAngle('behindWall', 0, 1.5)];
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('findInteractTarget: LOS-blocked target gives no target', out.targetKey === null);
}

// ---------------------------------------------------------------------------
// 5. `once`: a used entry gives no target and never fires again.
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  const rec = recAtAngle('lamp', 0, 1.0, { once: true, usedKey: 'used.s.lamp' });
  w.interactables = [rec];
  let calls = 0;
  w._setBehaviour('lamp.use', () => { calls++; return true; });

  updateInteraction(w, {}, EYE_NORTH, true);
  ok('first E press: fires and sets the used flag', calls === 1 && w.state['used.s.lamp'] === true);

  updateInteraction(w, {}, EYE_NORTH, true);
  ok('used entry: findInteractTarget gives no target, so a second E does not fire again',
    calls === 1 && w.interaction.targetKey === null);
}

// ---------------------------------------------------------------------------
// 6. A stub returning `false` does not consume (no used flag set).
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  const rec = recAtAngle('stubbed', 0, 1.0, { once: true, usedKey: 'used.s.stubbed' });
  w.interactables = [rec];
  w._setBehaviour('stubbed.use', () => false);

  updateInteraction(w, {}, EYE_NORTH, true);
  ok('a behaviour returning false leaves the used flag unset', w.state['used.s.stubbed'] !== true);
  updateInteraction(w, {}, EYE_NORTH, true);
  ok('...so the entry keeps giving a target', w.interaction.targetKey === 's.stubbed');
}

// ---------------------------------------------------------------------------
// 7. `requires`: disabled while the state key is falsy.
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  const rec = recAtAngle('gated', 0, 1.0, { requires: 'tower.lantern.taken' });
  w.interactables = [rec];
  const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };

  findInteractTarget(w, EYE_NORTH, null, out);
  ok('requires unmet (falsy state key): no target', out.targetKey === null);

  w.state['tower.lantern.taken'] = true;
  findInteractTarget(w, EYE_NORTH, null, out);
  ok('requires met: a target', out.targetKey === 's.gated');
}

// ---------------------------------------------------------------------------
// 8. `findInteractTarget` allocates nothing (10k calls, --expose-gc).
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  w.interactables = [recAtAngle('a', 10, 1.0), recAtAngle('b', -8, 1.2), recAtAngle('c', 25, 0.5)];
  const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
  const eye = { x: 0, y: 0, z: 0, yawDeg: 3, pitchDeg: 1 };

  if (typeof global.gc === 'function') {
    for (let i = 0; i < 1000; i++) { eye.yawDeg = i % 360; findInteractTarget(w, eye, null, out); } // warm-up
    global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 10000; i++) { eye.yawDeg = i % 360; findInteractTarget(w, eye, null, out); }
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const grewBy = after - before;
    ok('10k calls to findInteractTarget: no significant heap growth', grewBy < 512 * 1024, `grew by ${grewBy} bytes`);
  } else {
    for (let i = 0; i < 10000; i++) { eye.yawDeg = i % 360; findInteractTarget(w, eye, null, out); }
    ok('10k calls to findInteractTarget run without throwing (run with --expose-gc for the heap-growth check)', true);
  }
}

// ---------------------------------------------------------------------------
// 9. Serialize round trip keeps the used flag and the `light` component
//    (real World/serialize/deserialize + design assets - generic engine
//    mechanisms, US-012 only needs to confirm nothing about `light` or
//    `used.*` state keys is special-cased away).
// ---------------------------------------------------------------------------
{
  const world = World.load({
    name: 'interaction_roundtrip', terrain: null,
    structures: [{ id: 'room', level: 'test_room', origin: { x: 0, y: 0, z: 0 }, yawSteps: 0 }],
    entities: [{ id: 'player', type: 'player', spawn: { structure: 'room', from: 'start' } }],
    state: { 'used.room.lamp': true },
  }, assets, {});
  world.get('player').setComponent('light', {
    preset: 'lantern', on: true, attach: 'eye', offset: { right: 0.3, down: 0.3, fwd: 0.4 }, sway: { amp: 0.02 },
  });

  const state = JSON.parse(JSON.stringify(serialize(world)));
  const loaded = deserialize(state, assets, {});

  ok('serialize round trip keeps the used flag', loaded.state['used.room.lamp'] === true);
  const light = loaded.get('player').getComponent('light');
  ok('serialize round trip keeps the light component', light && light.preset === 'lantern' && light.on === true && light.attach === 'eye');
}

// ---------------------------------------------------------------------------
// 10. Coordinate spaces (arch review, 2026-09-24): a structure placed at
//    origin.z = 5 must have its level-local floorH/ceilH offset by origin.z
//    before comparing against world z.
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  w._setStructures([{
    origin: { x: 0, y: 0, z: 5 },
    bbox: { x0: -10, x1: 10, y0: -10, y1: 10 },
    level: { sectorAt() { return { solid: false, floorH: 0, ceilH: 3 }; } },
  }]);
  ok('structure at origin.z=5: visible above the offset floor (world z 6 > floor 0+5)',
    hasLineOfSight(w, 0, 0, 6, 0, -1, 6));
  ok('structure at origin.z=5: blocked below the offset floor (world z 4.5 < floor 0+5)',
    !hasLineOfSight(w, 0, 0, 4.5, 0, -1, 4.5));
}

// ---------------------------------------------------------------------------
// 11. A ray from open terrain (outside every structure footprint) into a
//    footprint must use `world.outsideSector`, not be treated as blocked.
// ---------------------------------------------------------------------------
{
  const w = makeWorld();
  w._setTerrain({ heightAt() { return 0; } });
  w._setStructures([{
    origin: { x: 5, y: 0, z: 0 },
    bbox: { x0: 5, x1: 15, y0: -5, y1: 5 },
    level: { sectorAt() { return { solid: false, floorH: 0, ceilH: 3 }; } },
  }]);
  // eye at x=0 (open terrain, outside the footprint), target at x=8 (inside it).
  ok('LOS from open terrain into a footprint is not blocked',
    hasLineOfSight(w, 0, 0, 1, 8, 0, 1));
}

console.log(`interaction.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n' + failures.join('\n')); process.exit(1); }
