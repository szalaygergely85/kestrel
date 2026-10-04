// BUG-CLOTH-002: real tower draft, visibility sleep, capsule response and save/load.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { AssetRegistry, World, serialize, deserialize, PHYSICS_DEFAULTS, integrate, stepRollers, resolveBodyContacts, stepSectorAnims } from '../../../engine/index.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';

const root = new URL('../../../', import.meta.url);
const html = await readFile(new URL('game/index.html', root), 'utf8');
globalThis.window = globalThis;
for (const match of html.matchAll(/<script\b[^>]*\bsrc="(\.\.\/design\/[^"?]+)"/g)) {
  const url = new URL(match[1], new URL('game/index.html', root));
  // The developer's optional local voxel pack is absent in a clean checkout.
  if (match[1].startsWith('../design/local/')) {
    try { await access(url); } catch { continue; }
  }
  await import(url.href);
}
const { assets } = await loadTestAssets();
assert.ok(assets instanceof AssetRegistry);
const world = World.load(assets.world('world_m1'), assets);
const sys = world.cloths, cloth = sys.cloths[0], anchor = Array.from(cloth.pos.slice(0, 3));
const wind = [0, 0, 0];
world.wind.sampleInto(...anchor, 0, wind);
assert.ok(Math.abs(wind[1]) > 0, 'the real stairwell has a local draft');
world.wind.sampleInto(1460, 1040, 0, 0, wind);
assert.ok(wind.every((v) => v === 0), 'outside the stairwell stays calm');
const push = [0, 0]; world.wind.pushAt(anchor[0], anchor[1], 0, push);
assert.ok(push.every((v) => v === 0), 'the cosmetic draft does not push the player');
let tick = 0;
function frame(body, field = world.wind) {
  if (body) sys.setBody(0, ...body); else sys.clearBodies();
  sys.tick(++tick, field, anchor[0] + 1, anchor[1] - 2, 2.5);
  sys.markDrawn(0); // Renderer runs after the fixed step, as in the real game loop.
}
const start = Array.from(cloth.pos);
for (let i = 0; i < 180; i++) frame(null);
let sway = 0;
for (let i = 0; i < cloth.pos.length; i++) sway = Math.max(sway, Math.abs(cloth.pos[i] - start[i]));
assert.ok(sway > 0.002, `visible real-content cloth sways under the draft (${sway})`);
assert.equal(sys.stats.awake, 1);
const calm = World.load({ ...assets.world('world_m1'), wind: null }, assets).wind;
for (let i = 0; i < 1200; i++) frame(null, calm);
assert.equal(sys.isAsleep(0), true, 'visible cloth rests without wind or body contact');
const before = Array.from(cloth.pos), bb = cloth.bbox;
const body = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2 - 0.08, bb[2], 0.3, 1.7];
for (let i = 0; i < 30; i++) frame(body, calm);
assert.equal(sys.bodyCount, 1);
assert.equal(sys.isAsleep(0), false, 'body overlap wakes resting real-content cloth');
let displacement = 0;
for (let i = 0; i < cloth.pos.length; i++) displacement = Math.max(displacement, Math.abs(cloth.pos[i] - before[i]));
assert.ok(displacement > 0.05, `capsule pushes the cloth aside (${displacement})`);
const restored = deserialize(JSON.parse(JSON.stringify(serialize(world))), assets);
restored.wind.sampleInto(...anchor, 0, wind);
assert.ok(Math.abs(wind[1]) > 0, 'the authored draft survives save/load');
// Owner pose: the removed cheek-wall cell lets the player cross the canvas row.
const tower = assets.level('tower');
assert.equal(tower.rows[4][18], '3', 'the removed cheek wall becomes the adjacent 0.9 m stair landing');
assert.equal(tower.legend['3'].solid, false);
assert.equal(tower.rows[3].slice(16, 20), '1234', 'the original stair run stays intact');
assert.equal(tower.rows[4].slice(16, 18), 'cc', 'the remaining cheek wall and mason mark stay intact');
const P = PHYSICS_DEFAULTS, steps = Math.round(3 / P.fixedDt);
const passage = [];
function walkOwnerPose(physics, clothOn) {
  const w = World.load(assets.world('world_m1'), assets, { physics });
  const player = { id: 'probe', transform: { x: 1500.14, y: 1022.57, z: 1.8, yawDeg: 276, pitchDeg: -17 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0,
      grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: 1.8 } } };
  const t = player.transform, b = player.components.body;
  const controls = { forward: 1, run: false, yawDeg: 276, pitchDeg: -17 };
  const trace = new Float64Array(steps * 3);
  const clothTrace = new Float32Array(steps * w.cloths.cloths[0].pos.length);
  let crossedAt = -1;
  assert.equal(w.get('tower.burnerFire').data.components.body, undefined, 'fire artwork has no physical body');
  for (let i = 0; i < steps; i++) {
    stepSectorAnims(w, P.fixedDt);
    integrate(player, P.fixedDt, controls, w, P);
    if (clothOn) w.cloths.setBody(0, t.x, t.y, t.z, b.radius, b.height);
    else w.cloths.clearBodies();
    w.cloths.tick(i + 1, w.wind, t.x, t.y, t.z + b.eyeH);
    stepRollers(w, P.fixedDt, P);
    resolveBodyContacts(w, player, P);
    w.cloths.markDrawn(0);
    clothTrace.set(w.cloths.cloths[0].pos, i * w.cloths.cloths[0].pos.length);
    if (crossedAt < 0 && t.y + b.radius < 1022) crossedAt = i + 1;
    trace[i * 3] = t.x; trace[i * 3 + 1] = t.y; trace[i * 3 + 2] = t.z;
  }
  assert.ok(crossedAt > 0 && crossedAt <= steps, `${physics}: the whole capsule crosses the canvas row within 3 seconds`);
  assert.ok(t.x < 1498 && t.y + b.radius < 1022, `${physics}: the owner heading continues through to the stair lane`);
  if (clothOn) passage.push(`${physics} ${(crossedAt * P.fixedDt).toFixed(3)} s to clear row, end (${t.x.toFixed(6)}, ${t.y.toFixed(6)}, ${t.z.toFixed(6)})`);
  return { trace, clothTrace };
}
for (const physics of ['grid', 'mesh']) {
  const contact = walkOwnerPose(physics, true), noContact = walkOwnerPose(physics, false);
  assert.deepEqual(contact.trace, noContact.trace,
    `${physics}: cloth cannot block the player or change any movement step`);
  let parting = 0;
  for (let i = 0; i < contact.clothTrace.length; i++) {
    parting = Math.max(parting, Math.abs(contact.clothTrace[i] - noContact.clothTrace[i]));
  }
  assert.ok(parting > 0.05, `${physics}: the crossing capsule parts the cloth beyond wind-only motion (${parting})`);
  passage.push(`${physics} contact parting ${parting.toFixed(4)} m`);
}

console.log(passage.join('\n'));
console.log(`cloth physics: sway ${sway.toFixed(4)} m, capsule displacement ${displacement.toFixed(4)} m. ALL PASS`);
