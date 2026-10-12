// engine/world/interaction.test.js (US-012). Headless Node ESM, no
// framework. Run: node engine/world/interaction.test.js
//
// Sections (mechanics: ray pick/reach/nearest/LOS/once/requires/no-alloc)
// use an inline fixture (architect tech note 6) - a hand-built "world" with
// just the surface `findInteractTarget`/`updateInteraction` read
// (`interactables`, `state`, `sectorAt`, `get`, `fireInteraction`,
// `events`, `_emit`), no real Level/AssetRegistry needed. Section 8 (the
// serialize round trip) needs the real engine + design assets, since
// `world.state`/`components.light` round-tripping is `serialize.js`'s job,
// not this story's.
import { findInteractTarget, updateInteraction, hasLineOfSight, resolvePropPicks } from './interaction.js';
import { World, serialize, deserialize } from '../index.js';
import paletteMod from '../../design/palette.js';
// US-027b: test_room moved to content/levels/test_room.level.json.
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

paletteMod; // classic script: side effect on globalThis.ASSETS
const { assets } = await loadTestAssets();

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

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



// ---------------------------------------------------------------------------
// OB-066: crosshair RAY targeting (replaces the OB-052/OB-063 angular cone).
// ---------------------------------------------------------------------------
const fresh = () => ({ targetKey: null, prompt: '', dist: 0, angleDeg: 0 });
const pick = (w, eye, cfg) => { const o = fresh(); findInteractTarget(w, eye, cfg || null, o); return o; };
{
  const w = makeWorld();
  w.interactables = [recAtAngle('a', 0, 1.0)];
  ok('ray: crosshair on the object -> target', pick(w, EYE_NORTH).targetKey === 's.a');
  w.interactables = [recAtAngle('side', 30, 1.0)];
  ok('ray: object 30 deg aside (0.5 m off the ray) -> none', pick(w, EYE_NORTH).targetKey === null);
  w.interactables = [recAtAngle('side', 90, 1.0)];
  ok('ray: object 90 deg aside -> none', pick(w, EYE_NORTH).targetKey === null);
  w.interactables = [recAtAngle('behind', 180, 1.0)];
  ok('ray: object behind -> none', pick(w, EYE_NORTH).targetKey === null);
  w.interactables = [recAtAngle('far', 0, 2.5)];
  ok('ray: beyond reach (2.5 m) -> none', pick(w, EYE_NORTH).targetKey === null);
  w.interactables = [recAtAngle('far', 0, 1.7)];
  ok('ray: 1.7 m within reach -> target', pick(w, EYE_NORTH).targetKey === 's.far');
  w.interactables = [recAtAngle('small', 0, 1.7, { radius: 1.0 })];
  ok('ray: per-rec radius cap (radius 1.0 at 1.7 m) -> none', pick(w, EYE_NORTH).targetKey === null);
  w.interactables = [recAtAngle('far', 0, 1.6), recAtAngle('near', 0, 0.9)];
  ok('ray: two on the ray, nearest wins', pick(w, EYE_NORTH).targetKey === 's.near');
  w.interactables = [recAtAngle('near', 0, 0.9), recAtAngle('far', 0, 1.6)];
  ok('ray: ...order independent', pick(w, EYE_NORTH).targetKey === 's.near');
  w.interactables = [recAtAngle('behindWall', 0, 1.5)];
  w._blockCell(0, -1);
  ok('ray: LOS-blocked target -> none', pick(w, EYE_NORTH).targetKey === null);
}
{ // forgiveness + hysteresis + vertical extent
  const w = makeWorld();
  // small note on a post at 1.2 m: 0.1 m wide pick (half 0.05); pad 0.06 (OB-088: was 0.15)
  const note = { ...recAtAngle('note', 0, 1.2), pick: { x0: -0.05, x1: 0.05, y0: -1.25, y1: -1.15, z0: -0.1, z1: 0.1 } };
  w.interactables = [note];
  const yawFor = (offM) => Math.atan2(offM, 1.2) * 180 / Math.PI;
  ok('note: crosshair 0.04 m off its edge still targeted', pick(w, { ...EYE_NORTH, yawDeg: yawFor(0.09) }).targetKey === 's.note');
  ok('OB-088: crosshair 0.12 m off the edge not targeted', pick(w, { ...EYE_NORTH, yawDeg: yawFor(0.17) }).targetKey === null);
  ok('note: crosshair 0.3 m off the edge not targeted', pick(w, { ...EYE_NORTH, yawDeg: yawFor(0.35) }).targetKey === null);
  const o = fresh(); o.targetKey = 's.note';
  findInteractTarget(w, { ...EYE_NORTH, yawDeg: yawFor(0.15) }, null, o);
  ok('hyst: held target survives 0.1 m off the edge', o.targetKey === 's.note');
  ok('hyst: ...but is not acquired fresh', pick(w, { ...EYE_NORTH, yawDeg: yawFor(0.27) }).targetKey === null);
  // vertical: default box 0.8 m tall centred on rec.z; eye 1.6, object z 1.0 at 1.2 m
  const mk = { key: 's.n', structId: 's', name: 'n', prompt: 'Read', x: 0, y: -1.2, z: 1.0, radius: 3, once: false, requires: null, propId: null, usedKey: null };
  w.interactables = [mk];
  let allPitch = true;
  for (let p = -40; p <= -20; p += 5) if (pick(w, { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: p }, { reach: 3 }).targetKey !== 's.n') allPitch = false;
  ok('vertical: pitch -40..-20 hits a 0.8 m tall object 1.2 m ahead from eye 1.6', allPitch);
  ok('vertical: pitch +10 misses it', pick(w, { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 10 }, { reach: 3 }).targetKey === null);
  ok('eye inside the pick volume -> target', pick(w, { x: 0, y: -1.2, z: 1.0, yawDeg: 123, pitchDeg: 5 }).targetKey === 's.n');
  w.interactables = [{ ...mk, y: 50, pick: { x0: -1, x1: 1, y0: -2, y1: -1, z0: 0, z1: 3 } }];
  ok('rec.pick used instead of rec.x/y/z', pick(w, { x: 0, y: 0, z: 1.6, yawDeg: 0, pitchDeg: 0 }, { reach: 3 }).targetKey === 's.n');
}

// OB-063/OB-066 real tower content: positions from tower.level.json + the world origin from world_m1.world.json.
{
  const { readFileSync } = await import('node:fs');
  const lvl = JSON.parse(readFileSync(new URL('../../content/levels/tower.level.json', import.meta.url), 'utf8'));
  const wj = JSON.parse(readFileSync(new URL('../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
  const org = wj.structures.find((s) => s.id === 'tower').origin;
  const w = makeWorld();
  w._setStructures([{ origin: { x: 0, y: 0, z: 0 }, bbox: { x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 },
    level: { sectorAt: () => ({ solid: false, floorH: 0, ceilH: 'sky' }) } }]);
  const recs = lvl.interactables.filter((r) => r.prompt && typeof r.x === 'number').map((r) => ({
    key: 't.' + r.id, structId: 't', id: r.id, name: r.id, prompt: r.prompt, x: org.x + r.x, y: org.y + r.y, z: (org.z || 0) + (r.z || 0),
    radius: r.radius ?? 1.8, once: false, requires: null, propId: null, usedKey: null }));
  // the gondola: an errands-style inspect rec on the prop's collider box (as World.propPickBox builds it)
  const g = lvl.props.find((p) => p.id === 'gondola'), gc = g.colliders[0];
  const rad = g.facing * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
  const gx = org.x + g.x + c * gc.c[0] - sn * gc.c[1], gy = org.y + g.y + sn * gc.c[0] + c * gc.c[1];
  const ex = Math.abs(c) * gc.half[0] + Math.abs(sn) * gc.half[1], ey = Math.abs(sn) * gc.half[0] + Math.abs(c) * gc.half[1];
  const gz0 = (org.z || 0) + g.z;
  recs.push({ key: 'qi.gondola', structId: null, name: 'quest.inspect', prompt: '[E] Inspect gondola', x: gx, y: gy, z: gz0 + gc.c[2],
    radius: 2.4, once: false, requires: null, propId: null, usedKey: null,
    pick: { x0: gx - ex, x1: gx + ex, y0: gy - ey, y1: gy + ey, z0: gz0, z1: gz0 + 2 * gc.half[2] } });
  w.interactables = recs;
  ok('fixture: tower notes + gondola loaded', recs.some((r) => r.id === 'noteSteelHush') && recs.some((r) => r.key === 'qi.gondola'), String(recs.length));
  // OB-066 owner pose (1496.26, 1024.19) yaw 304 pitch -19, looking at the wall: the gondola must NOT be picked
  let hit = null;
  for (const eyeZ of [1.6, 1.7, 1.8]) { const o = pick(w, { x: 1496.26, y: 1024.19, z: gz0 + eyeZ, yawDeg: 304, pitchDeg: -19 }, { reach: 2.4 }); if (o.targetKey) hit = eyeZ + ':' + o.targetKey; }
  ok('OB-066: owner pose yaw 304 pitch -19 does not pick the gondola', hit === null, String(hit));
  // positive control: aim at the box centre from the same spot (only if within the 2.4 m radius)
  const brg = Math.atan2(gx - 1496.26, -(gy - 1024.19)) * 180 / Math.PI, d = Math.hypot(gx - 1496.26, gy - 1024.19);
  const ez = gz0 + 1.6, pit = Math.atan2(gz0 + gc.c[2] - ez, d) * 180 / Math.PI;
  ok('OB-066: aiming at the gondola box centre picks it (d=' + d.toFixed(2) + ')', d > 2.0 || pick(w, { x: 1496.26, y: 1024.19, z: ez, yawDeg: brg, pitchDeg: pit }, { reach: 2.4 }).targetKey === 'qi.gondola');
  // OB-063 owner pose (1489.50, 1026.33, 6.00) yaw 264 pitch -30 gives no target
  let any = null;
  for (const eyeZ of [6.0, 6.6, 7.0, 7.6]) { const o = pick(w, { x: 1489.5, y: 1026.33, z: eyeZ, yawDeg: 264, pitchDeg: -30 }); if (o.targetKey) any = eyeZ + ':' + o.targetKey; }
  ok('OB-063/066: owner pose yaw 264 pitch -30 gives no target (eye z 6.0..7.6)', any === null, String(any));
  // positive control: face the steel-hush page from 1.2 m
  const n = recs.find((r) => r.id === 'noteSteelHush');
  const bx = n.x - 1.2 * Math.sin(239 * Math.PI / 180), by = n.y + 1.2 * Math.cos(239 * Math.PI / 180);
  const bearing = Math.atan2(n.x - bx, -(n.y - by)) * 180 / Math.PI;
  const pitchN = -Math.atan2(0.6, 1.2) * 180 / Math.PI; // eye 0.6 m above the page
  ok('OB-066: aiming at the page from 1.2 m (yaw +3) prompts', pick(w, { x: bx, y: by, z: n.z + 0.6, yawDeg: bearing + 3, pitchDeg: pitchN }).targetKey === 't.noteSteelHush');
  ok('OB-066: 30 deg off the page does not', pick(w, { x: bx, y: by, z: n.z + 0.6, yawDeg: bearing + 30, pitchDeg: pitchN }).targetKey === null);
}

{ // OB-084: [E] only when aimed, on the WHOLE body (live entity box), and not from inside a box while looking away
  const w = makeWorld();
  const boar = { id: 'boar1', transform: { x: 0, y: -2, z: 0 }, components: {} };
  w.entity = (id) => (id === 'boar1' ? boar : null);
  const rec = { key: 'loot.boar1', name: 'beast.loot', prompt: '[E] Loot', x: 0, y: -2, z: 0.3, radius: 3, once: false, requires: null,
    propId: 'boar1', usedKey: null, bodyId: 'boar1', bodyR: 0.7, bodyH: 0.7 };
  w.interactables = [rec];
  const eye = (yaw, pitch, x = 0, y = 0) => pick(w, { x, y, z: 1.6, yawDeg: yaw, pitchDeg: pitch });
  const pAt = (dx, dy, dz) => Math.atan2(dz, Math.hypot(dx, dy)) * 180 / Math.PI;
  ok('OB-084: aiming at the body centre prompts', eye(0, pAt(0, 2, 0.35 - 1.6)).targetKey === 'loot.boar1');
  ok('OB-084: aiming at the rump (0.6 m off the centre point) prompts', eye(Math.atan2(0.6, 2) * 180 / Math.PI, pAt(0.6, 2, 0.35 - 1.6)).targetKey === 'loot.boar1');
  ok('OB-084: looking away does not prompt', eye(90, 0).targetKey === null && eye(180, -30).targetKey === null);
  boar.transform.x = 1.2; // the box follows the live entity (still within the 1.8 m reach)
  ok('OB-084: the pick box follows the entity', eye(Math.atan2(1.2, 2) * 180 / Math.PI, pAt(1.2, 2, 0.35 - 1.6)).targetKey === 'loot.boar1' && eye(-25, pAt(0, 2, -1.25)).targetKey === null);
  // eye inside a big prop box: only when its centre is within 35 deg of the crosshair
  const big = { key: 'qi.wagon', name: 'quest.inspect', prompt: '[E] Inspect wagon', x: 0, y: -1, z: 1, radius: 3, once: false, requires: null, propId: null, usedKey: null,
    pick: { x0: -2, x1: 2, y0: -3, y1: 1, z0: 0, z1: 2 } };
  w.interactables = [big];
  ok('OB-084: inside a box, facing its centre prompts', eye(0, -10).targetKey === 'qi.wagon');
  ok('OB-084: inside a box, facing away does not', eye(180, 0).targetKey === null && eye(90, 0).targetKey === null);
}

{ // OB-084: a level item on a prop picks anywhere on the prop's collider box (resolved outside the hot loop)
  const w = makeWorld();
  const box = { x0: -2, x1: 2, y0: -4, y1: -2, z0: 0, z1: 2 };
  w.propPickBox = (id) => (id === 's.wagon' ? box : null);
  const rec = { key: 's.wagonItem', structId: 's', id: 'wagonItem', name: 'x', prompt: '[E]', x: 0, y: -3, z: 1, radius: 5, once: false, requires: null, propId: 's.wagon', usedKey: null, pick: null };
  w.interactables = [rec];
  const eyeAt = (yaw) => pick(w, { x: 0, y: 0, z: 1, yawDeg: yaw, pitchDeg: 0 }, { reach: 5 }).targetKey;
  ok('OB-084: unresolved pick -> only the 0.5 m default box (aiming at the wagon edge misses)', eyeAt(Math.atan2(1.8, 3) * 180 / Math.PI) === null);
  resolvePropPicks(w);
  ok('OB-084: resolved to the prop collider box', rec.pick === box);
  ok('OB-084: aiming at the wagon edge (1.8 m off centre) now picks', eyeAt(Math.atan2(1.8, 3) * 180 / Math.PI) === 's.wagonItem');
  ok('OB-084: the hot loop does not add or change pick', rec.pick === box && Object.keys(rec).includes('pick'));
  box.x1 = 3; resolvePropPicks(w); ok('OB-084: re-resolve follows a moved prop', rec.pick === box);
}

{ // OB-088: a rotated two-piece prop picks on its PIECES, not on their union AABB
  const w = makeWorld();
  const c45 = Math.cos(Math.PI / 4), s45 = Math.sin(Math.PI / 4);
  // two posts 2 m apart (the right one rotated 45 deg): their union AABB covers the empty gap between them
  const shapes = [{ cx: -1, cy: -2, cz: 1.6, hx: 0.1, hy: 0.1, hz: 0.3, c: 1, s: 0 }, { cx: 1, cy: -2, cz: 1.6, hx: 0.1, hy: 0.1, hz: 0.3, c: c45, s: s45 }];
  const rec = { key: 'qi.wreck', name: 'quest.inspect', prompt: '[E] Inspect wreck', x: 0, y: -2, z: 1.6, radius: 3, once: false, requires: null, propId: null, usedKey: null,
    pick: { x0: -1.15, x1: 1.15, y0: -2.15, y1: -1.85, z0: 1.3, z1: 1.9 }, pickShapes: shapes };
  w.interactables = [rec];
  const at = (x, y) => pick(w, { x: 0, y: 0, z: 1.6, yawDeg: Math.atan2(x, -y) * 180 / Math.PI, pitchDeg: 0 }, { reach: 3 }).targetKey;
  ok('OB-088: aiming at either post (one rotated) picks the prop', at(-1, -2) === 'qi.wreck' && at(1, -2) === 'qi.wreck' && at(1.12, -2) === 'qi.wreck');
  ok('OB-088: aiming into the gap inside the union box does not', at(0, -2) === null && at(0.5, -2) === null);
}
console.log(`interaction.test.js: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n' + failures.join('\n')); process.exit(1); }
