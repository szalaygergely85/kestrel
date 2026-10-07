// MESH-PHYS-01: collision proxies, collide:false, merged broad phase, no tunnelling.
// Run: node engine/world/meshProxy.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssetRegistry, World, PHYSICS, meshFromJSON, planMeshCollision, buildPrismProxy, WALK_OVER_H, makeFrame, localToWorld } from '../index.js';
import { integrate } from '../physics/integrate.js';
import { buildWorldColliders } from './colliders.js';
import { moveCircleMesh, probeSupport } from '../physics/meshCollide.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const load = (n) => meshFromJSON(JSON.parse(readFileSync(new URL(`../../content/meshes/quaternius/${n}.mesh.json`, import.meta.url), 'utf8')));
const rock = load('Rock_Medium_1'), tree = load('DeadTree_1'), pebble = load('Pebble_Round_1'), path = load('RockPath_Square_Wide');
const strip = (m) => { const c = { ...m }; delete c.collider; delete c.collide; return c; };

// --- generator -------------------------------------------------------------------------------------------
ok(rock.collider && rock.collider.length / 9 <= 48 && rock.collider.length / 9 >= 12, 'rock has a <=48 tri proxy');
ok(tree.collider.length / 9 <= 48, 'tree proxy <=48 tris');
ok(pebble.collide === false && path.collide === false && !pebble.collider, 'pebbles + flat path stones are walk-over');
const plan = planMeshCollision('x/Plain', rock.pos);
assert.deepEqual(Array.from(plan.collider), Array.from(buildPrismProxy(rock.pos))); checks++;
ok(!planMeshCollision('x/low', Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, WALK_OVER_H - 0.01])).collide, 'height rule');
ok(!planMeshCollision('quaternius/Mushroom_X', rock.pos).collide, 'name rule');
// trunk-thin: the tree proxy footprint comes from the lower band, not the 6 m canopy
let tx0 = Infinity, tx1 = -Infinity;
for (let i = 0; i < tree.collider.length; i += 3) { tx0 = Math.min(tx0, tree.collider[i]); tx1 = Math.max(tx1, tree.collider[i]); }
ok(tx1 - tx0 < 2.5, `tree proxy is trunk sized (${(tx1 - tx0).toFixed(2)} m)`);

// Footprint ring of a prism proxy: the first vertex of each side quad's first triangle (sides come first).
function ringOf(c) {
  const ring = [];
  for (let s = 0; s * 18 < c.length && c[s * 18 + 2] === c[2] && c[s * 18 + 5] === c[2] && c[s * 18 + 8] !== c[2]; s++) ring.push([c[s * 18], c[s * 18 + 1]]);
  return ring;
}
function insideRing(ring, x, y, grow) {
  let worst = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    worst = Math.min(worst, (ex * (y - a[1]) - ey * (x - a[0])) / Math.hypot(ex, ey));
  }
  return worst >= -grow;
}
const rr = ringOf(rock.collider);
ok(rr.length >= 3 && rr.length <= 8, 'ring recovered');
let worstOut = 0;
for (let i = 0; i < rock.pos.length; i += 3) {
  for (let g = 0; g < 0.6; g += 0.01) if (insideRing(rr, rock.pos[i], rock.pos[i + 1], g)) { worstOut = Math.max(worstOut, g); break; }
}
ok(worstOut < 0.35, `proxy hugs the render footprint (worst vertex ${worstOut.toFixed(2)} m outside)`);

// --- runtime: proxy used, collide:false skipped, fallback ---------------------------------------------------
const place = (id, m, x, y, yaw = 0, extra = {}) => ({ id, mesh: m, origin: { x, y, z: 0 }, yawDeg: yaw, ...extra });
const build = (structs) => buildWorldColliders({ structures: structs, assets: { mesh: () => { throw new Error('no ref'); } } });
let cs = build([place('r', rock, 0, 0)]);
assert.equal(cs.length, 1); assert.equal(cs[0].bvh.triCount, rock.collider.length / 9); checks += 2;
cs = build([place('p', pebble, 0, 0), place('s', path, 3, 0), place('q', rock, 6, 0, 0, { collide: false })]);
assert.equal(cs.length, 0); checks++;
const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
cs = build([place('r', strip(rock), 0, 0), place('r2', strip(rock), 9, 0)]);
console.warn = warn;
assert.equal(cs[0].bvh.triCount, rock.triCount * 2); assert.equal(warned, 1); checks += 2; // fallback = render tris, warned once per mesh id

// --- broad phase == brute force ------------------------------------------------------------------------------
const structs = [];
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let i = 0; i < 24; i++) structs.push(place(`s${i}`, i % 3 ? rock : tree, rnd() * 60, rnd() * 20, rnd() * 360));
const merged = build(structs);
const single = structs.map((s) => build([s])[0]);
const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax, walkCos: Math.cos(PHYSICS.maxSlopeDeg * Math.PI / 180) };
const A = { x: 0, y: 0, blockedX: 0, blockedY: 0, nx: 0, ny: 0, overflow: false }, B = { ...A };
const SA = {}, SB = {};
let hits = 0;
for (let i = 0; i < 4000; i++) {
  const x = rnd() * 64 - 2, y = rnd() * 24 - 2, z = rnd() * 3 - 0.5, dx = (rnd() - 0.5) * 0.3, dy = (rnd() - 0.5) * 0.3;
  moveCircleMesh(merged, merged.length, x, y, dx, dy, 0.3, z, true, opts, A);
  moveCircleMesh(single, single.length, x, y, dx, dy, 0.3, z, true, opts, B);
  if (Math.abs(A.x - B.x) > 1e-9 || Math.abs(A.y - B.y) > 1e-9 || A.blockedX !== B.blockedX || A.blockedY !== B.blockedY) assert.fail(`collideCircle differs at ${x},${y},${z}`);
  if (A.x !== x + dx || A.y !== y + dy) hits++;
  probeSupport(merged, merged.length, x, y, z, true, opts, SA); probeSupport(single, single.length, x, y, z, true, opts, SB);
  if (SA.floorHit !== SB.floorHit || (SA.floorHit && Math.abs(SA.floorZ - SB.floorZ) > 1e-9) || SA.ceilZ !== SB.ceilZ) assert.fail(`probeSupport differs at ${x},${y},${z}`);
  checks += 2;
}
ok(hits > 50, `fixture actually collides (${hits} pushed moves)`);

// --- no tunnelling: drop a capsule at full fall speed onto the proxy ---------------------------------------------
const room = { name: 'room', version: 1, cellSize: 1, size: { w: 40, h: 40 }, rows: Array(40).fill('.'.repeat(40)),
  legend: { '.': { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false } },
  sun: { azimuthDeg: 30, elevationDeg: 45 }, start: { x: 0.5, y: 0.5, facingDeg: 0 }, props: [], interactables: [], triggers: [] };
const assets = new AssetRegistry({ palette: { rgb: {} }, levels: { room }, meshes: { rock, tree } });
function drop(meshId, yaw, ox, oy, z0, vz) {
  const world = World.load({ name: 'drop', structures: [{ id: 'room', level: 'room', origin: { x: 0, y: 0, z: 0 } },
    { id: 'm', mesh: meshId, origin: { x: 20, y: 20, z: 0 }, yawDeg: yaw }] }, assets, { physics: 'mesh' });
  const c = world.colliders.find((k) => k.id === 'meshes:static');
  const e = { id: 'p', type: 'player', transform: { x: 20 + ox, y: 20 + oy, z: z0, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: PHYSICS.radius, height: PHYSICS.height, eyeH: PHYSICS.eyeHeight, vx: 0, vy: 0, vz, grounded: false, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: z0 } } };
  for (let i = 0; i < 300; i++) integrate(e, 1 / 60, {}, world, PHYSICS);
  return { e, c };
}
let landedTop = 0, landedBeside = 0;
for (const meshId of ['rock']) for (const yaw of [0, 37, 120]) for (let ox = -2.4; ox <= 2.41; ox += 0.4) for (let oy = -2.4; oy <= 2.41; oy += 0.4) for (const [z0, vz] of [[4, -14], [5, -18]]) {
  const { e, c } = drop(meshId, yaw, ox, oy, z0, vz);
  const t = e.transform, b = e.components.body, tri = c.bvh.tri;
  const tag = `${meshId} yaw ${yaw} off ${ox.toFixed(1)},${oy.toFixed(1)} z=${t.z.toFixed(2)}`;
  ok(Number.isFinite(t.z) && Number.isFinite(t.x), `finite ${tag}`);
  ok(b.grounded, `grounded after the drop: ${tag}`);
  ok(t.z >= -0.02, `not below the floor: ${tag}`);
  // never inside the proxy: count proxy surface crossings of a vertical ray through the capsule centre above the feet+0.3
  let up = 0;
  for (let k = 0; k < c.bvh.triCount; k++) {
    const o = k * 9, ax = tri[o], ay = tri[o + 1], bx = tri[o + 3], by = tri[o + 4], cx = tri[o + 6], cy = tri[o + 7];
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((by - cy) * (t.x - cx) + (cx - bx) * (t.y - cy)) / d, l2 = ((cy - ay) * (t.x - cx) + (ax - cx) * (t.y - cy)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    if (l1 * tri[o + 2] + l2 * tri[o + 5] + l3 * tri[o + 8] > t.z + 0.3) up++;
  }
  ok(up % 2 === 0, `capsule centre inside the proxy: ${tag}`);
  if (t.z > 0.5) landedTop++; else landedBeside++;
}
ok(landedTop > 10 && landedBeside > 10, `both outcomes exercised (top ${landedTop}, beside ${landedBeside})`);

// Walk into the trunk from 8 directions (and run into it): the capsule is stopped outside the proxy.
for (let a = 0; a < 360; a += 45) {
  const world = World.load({ name: 'walk', structures: [{ id: 'room', level: 'room', origin: { x: 0, y: 0, z: 0 } },
    { id: 'm', mesh: 'tree', origin: { x: 20, y: 20, z: 0 }, yawDeg: 20 }] }, assets, { physics: 'mesh' });
  const c = world.colliders.find((k) => k.id === 'meshes:static');
  const r = a * Math.PI / 180, cx = 20, cy = 20; // trunk is at the mesh origin
  const e = { id: 'p', type: 'player', transform: { x: cx + Math.cos(r) * 4, y: cy + Math.sin(r) * 4, z: 0, yawDeg: Math.atan2(-Math.cos(r), Math.sin(r)) * 180 / Math.PI, pitchDeg: 0 },
    components: { body: { radius: PHYSICS.radius, height: PHYSICS.height, eyeH: PHYSICS.eyeHeight, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: 0 } } };
  const fr = makeFrame(20, 20, 0, 0, 20), wp = {};
  const ring = ringOf(tree.collider).map(([x, y]) => { localToWorld(fr, x, y, 0, wp); return [wp.x, wp.y]; });
  let minD = Infinity, inside = 0;
  for (let i = 0; i < 400; i++) {
    integrate(e, 1 / 60, { forward: 1, run: true }, world, PHYSICS);
    minD = Math.min(minD, Math.hypot(e.transform.x - cx, e.transform.y - cy));
    if (insideRing(ring, e.transform.x, e.transform.y, 0)) inside++;
  }
  ok(inside === 0, `walker never inside the trunk prism (dir ${a})`);
  ok(minD > 0.55, `walker is stopped at the trunk, never reaches its centre (min ${minD.toFixed(2)} m, dir ${a})`);
}

console.log(`${checks} passed, 0 failed. ALL PASS`);
