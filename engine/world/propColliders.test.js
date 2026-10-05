// PROP-COLLIDE-01a/01b0 (architecture.md 37.10). Run: node engine/world/propColliders.test.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { buildPropCollider } from './colliders.js';
import { moveCircleMesh, probeSupport } from '../physics/meshCollide.js';
import { PHYSICS_DEFAULTS as P } from '../physics/config.js';

let checks = 0;
const ok = v => { assert.ok(v); checks++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const box = { type: 'box', c: [0.2, -0.3, 0.4], half: [0.5, 0.25, 0.4], yawDeg: 11 };
const spritePrism = { type: 'prism', c: [0.2, -0.3, 0.21], r: 0.12, h: 0.42 };
const models = {
  crate: { voxel: { animations: { idle: {} } }, colliders: [box] },
  sprite: { animations: { idle: {} }, colliders: [spritePrism] },
  spriteBare: { animations: { idle: {} } },
};
function fixture(props) {
  const level = { name: 'fixture', rows: Array(12).fill('.'.repeat(12)), start: { x: 1.5, y: 1.5 },
    legend: { '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky' } }, props };
  const def = { name: 'propsFixture', terrain: null, sun: {},
    structures: [{ id: 'room', level: 'fixture', origin: { x: 10, y: 20, z: 3 } }], entities: [] };
  const assets = { level: () => level, world: () => def, model: key => models[key],
    has: (kind, key) => kind !== 'model' || !!models[key], contentVersion: null };
  return { level, def, assets, load: physics => World.load(def, assets, { physics: physics || 'mesh' }) };
}
const prop = extras => ({ id: 'crate', model: 'crate', x: 2, y: 2, z: 1, ...extras });
const collider = w => w.colliders.find(c => c.id === 'props:static');
const opts = { height: P.height, stepUpMax: P.stepUpMax, walkCos: Math.cos(Math.PI / 4) }, out = {};

// Independent corner oracle (polar rotation), including centre offset, extra yaw and scale.
for (const facing of [0, 90, 37]) {
  const f = fixture([prop({ facing, scale: 1.5 })]), w = f.load(), c = collider(w);
  ok(c && c.bvh.triCount === 12 && w.colliders.filter(x => x.id === 'props:static').length === 1);
  const rotation = facing * Math.PI / 180, yaw = (facing + 11) * Math.PI / 180;
  const centreA = Math.atan2(box.c[1], box.c[0]) + rotation, centreR = Math.hypot(box.c[0], box.c[1]) * 1.5;
  const cx = 12 + Math.cos(centreA) * centreR, cy = 22 + Math.sin(centreA) * centreR, cz = 4 + box.c[2] * 1.5;
  const min = [Infinity, Infinity, cz - 0.6], max = [-Infinity, -Infinity, cz + 0.6];
  for (const x of [-0.75, 0.75]) for (const y of [-0.375, 0.375]) {
    const a = Math.atan2(y, x) + yaw, r = Math.hypot(x, y), px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    min[0] = Math.min(min[0], px); min[1] = Math.min(min[1], py);
    max[0] = Math.max(max[0], px); max[1] = Math.max(max[1], py);
  }
  ok(min.every((v, i) => near(v, c.min[i])) && max.every((v, i) => near(v, c.max[i])));
}

const prism = { kind: 1, x: 3, y: 4, zc: 5, r: 0.4, h: 0.8, yawRad: 0, hx: 0, hy: 0, hz: 0 };
const pc = buildPropCollider([prism], 1);
ok(pc.bvh.triCount === 32 && near(pc.min[0], 3 - 0.4 / Math.cos(Math.PI / 8))
  && near(pc.max[1], 4 + 0.4 / Math.cos(Math.PI / 8)) && near(pc.min[2], 4.6) && near(pc.max[2], 5.4));
ok(buildPropCollider([], 0) === null);
const prismWorld = fixture([prop({ facing: 37, scale: 1.5, colliders: [{ type: 'prism', c: [0, 0, 0.4], r: 0.4, h: 0.8 }] })]).load();
const prismCollider = collider(prismWorld), angle = 37 * Math.PI / 180, radius = 0.6 / Math.cos(Math.PI / 8);
const px = [], py = [];
for (let i = 0; i < 8; i++) { px.push(12 + radius * Math.cos(angle + i * Math.PI / 4)); py.push(22 + radius * Math.sin(angle + i * Math.PI / 4)); }
ok(near(prismCollider.min[0], Math.min(...px)) && near(prismCollider.max[1], Math.max(...py))
  && near(prismCollider.min[2], 4) && near(prismCollider.max[2], 5.2));

const crateShape = { kind: 0, x: 0, y: 0, zc: 0.25, hx: 0.25, hy: 0.25, hz: 0.25, r: 0, h: 0, yawRad: 0 };
const crate = buildPropCollider([crateShape], 1);
for (let direction = 0; direction < 8; direction++) {
  const a = direction * Math.PI / 4, dx = Math.cos(a), dy = Math.sin(a);
  let x = dx * 2, y = dy * 2;
  for (let step = 0; step < 100; step++) {
    moveCircleMesh([crate], 1, x, y, -dx * 0.05, -dy * 0.05, P.radius, 0, true, opts, out);
    x = out.x; y = out.y;
  }
  const gap = Math.hypot(Math.max(Math.abs(x) - 0.25, 0), Math.max(Math.abs(y) - 0.25, 0));
  ok(Math.abs(gap - P.radius) <= 1e-6 && !out.overflow);
}
// Closed top supports standing; underside blocks headroom above a raised prop.
const support = {};
probeSupport([crate], 1, 0, 0, 0.5, true, opts, support);
ok(support.floorHit && support.floorZ === 0.5);
const raised = buildPropCollider([{ ...crateShape, zc: 2.25 }], 1);
probeSupport([raised], 1, 0, 0, 0, true, opts, support);
ok(support.ceilHit && support.ceilZ === 2);

const optedOut = fixture([prop({ colliders: [] })]);
ok(!collider(optedOut.load()));
// Static sprite props use authored shapes only, in the same live-pose frame as voxels.
const spriteWorld = fixture([prop({ model: 'sprite', facing: 37 })]).load(), spriteCollider = collider(spriteWorld);
ok(spriteWorld.entity('room.crate').components.sprite && spriteCollider.bvh.triCount === 32);
const spriteYaw = 37 * Math.PI / 180;
const spriteCentreAngle = Math.atan2(spritePrism.c[1], spritePrism.c[0]) + spriteYaw;
const spriteCentreRadius = Math.hypot(spritePrism.c[0], spritePrism.c[1]);
const spriteX = 12 + spriteCentreRadius * Math.cos(spriteCentreAngle);
const spriteY = 22 + spriteCentreRadius * Math.sin(spriteCentreAngle);
const spriteRingRadius = spritePrism.r / Math.cos(Math.PI / 8), sx = [], sy = [];
for (let i = 0; i < 8; i++) {
  sx.push(spriteX + spriteRingRadius * Math.cos(spriteYaw + i * Math.PI / 4));
  sy.push(spriteY + spriteRingRadius * Math.sin(spriteYaw + i * Math.PI / 4));
}
ok([Math.min(...sx), Math.min(...sy), 4].every((v, i) => near(v, spriteCollider.min[i]))
  && [Math.max(...sx), Math.max(...sy), 4.42].every((v, i) => near(v, spriteCollider.max[i])));
ok(!collider(fixture([prop({ model: 'spriteBare' })]).load()));
ok(!collider(fixture([prop({ model: 'sprite', colliders: [] })]).load()));
ok(collider(fixture([prop({ model: 'sprite', colliders: [box] })]).load()).bvh.triCount === 12);
ok(collider(fixture([prop({ model: 'spriteBare', colliders: [box] })]).load()).bvh.triCount === 12);
const warnings = [], warn = console.warn;
console.warn = m => warnings.push(m);
let dynamic;
try { dynamic = fixture([prop({ dynamic: true, radius: 0.3 })]).load(); } finally { console.warn = warn; }
ok(!collider(dynamic) && warnings.length === 1 && warnings[0].includes('room.crate') && warnings[0].includes('dynamic'));
warnings.length = 0;
console.warn = m => warnings.push(m);
let dynamicSprite, rollerSprite;
try {
  dynamicSprite = fixture([prop({ model: 'sprite', dynamic: true, radius: 0.12 })]).load();
  rollerSprite = fixture([prop({ model: 'sprite' })]).load();
  rollerSprite.entity('room.crate').components.roller = {};
  rollerSprite.rebuildPropColliders();
} finally { console.warn = warn; }
ok(!collider(dynamicSprite) && !collider(rollerSprite) && warnings.length === 2
  && warnings.every(m => m.includes('room.crate') && m.includes('dynamic')));
// A saved entity with a prop's id still must be a prop; billboards never contribute shapes.
for (const type of ['billboard', 'unit', 'item', 'boar']) {
  const sf = fixture([prop({ model: 'sprite' })]);
  sf.def.entities.push({ id: 'room.crate', type, transform: { x: 12, y: 22, z: 4 },
    components: { sprite: { model: 'sprite' } } });
  ok(!collider(sf.load()));
}
spriteWorld.entity('room.crate').components.billboard = {};
spriteWorld.rebuildPropColliders();
ok(!collider(spriteWorld));
ok(!collider(fixture([prop({})]).load('grid')));
assert.throws(() => fixture([prop({ colliders: [{ type: 'box', c: [0, 0, 0], half: [0, 1, 1] }] })]).load(), /room.crate.*invalid collider/); checks++;

// Rebuild reads edited live transforms, replaces one BVH in place, and removes empty geometry.
const f = fixture([prop({ facing: 37, scale: 1.5 }), prop({ id: 'other', x: 6, colliders: [{ type: 'prism', c: [0, 0, 0.4], r: 0.4, h: 0.8 }] })]);
const w = f.load(), first = collider(w), index = w.colliders.indexOf(first);
const twin = collider(f.load());
ok(Buffer.from(first.bvh.tri.buffer).equals(Buffer.from(twin.bvh.tri.buffer)));
w.entity('room.crate').transform.x += 4;
w.entity('room.crate').transform.yawDeg = 90;
w.entity('room.crate').transform.scale = 2;
w.rebuildPropColliders();
ok(w.colliders[index] === collider(w) && collider(w) !== first && collider(w).max[0] > first.max[0]);
const warm = performance.now();
for (let i = 0; i < 100; i++) w.rebuildPropColliders();
const rebuildMs = (performance.now() - warm) / 100;
const saved = serialize(w), restored = deserialize(saved, f.assets, { physics: 'mesh' });
ok(!Object.hasOwn(saved, 'colliders') && Buffer.from(collider(w).bvh.tri.buffer).equals(Buffer.from(collider(restored).bvh.tri.buffer)));
let seed = 741;
const rnd = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < 200; i++) {
  const x = 10 + rnd() * 12, y = 20 + rnd() * 12, z = 3 + rnd() * 4, dx = rnd() - 0.5, dy = rnd() - 0.5;
  const before = { ...w.collideCircle(x, y, dx, dy, P.radius, z, true, opts, {}) };
  const after = restored.collideCircle(x, y, dx, dy, P.radius, z, true, opts, {});
  assert.deepEqual(after, before); checks++;
}
function replay(world) {
  let x = 13, y = 22;
  const trace = new Float64Array(600 * 2);
  for (let i = 0; i < 600; i++) {
    world.collideCircle(x, y, 0.03, Math.sin(i * 0.03) * 0.02, P.radius, 4, true, opts, out);
    x = out.x; y = out.y; trace[i * 2] = x; trace[i * 2 + 1] = y;
  }
  return createHash('sha256').update(Buffer.from(trace.buffer)).digest('hex');
}
ok(replay(w) === replay(restored));
f.level.props.forEach(p => { p.colliders = []; });
w.rebuildPropColliders();
ok(!collider(w) && w.colliders.length === 1);
console.log(`PROP-COLLIDE-01a/01b0: ${checks} checks PASS; two-shape rebuild ${rebuildMs.toFixed(3)} ms`);
