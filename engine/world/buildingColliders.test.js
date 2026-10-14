// BLD-01 (OB-139): the own voxel buildings (design/models/buildings_voxel.js) -> static box colliders.
// Every bld* model yields boxes, a capsule-radius walker climbs the bldHouseTwo + bldWatchtower stairs and passes
// each door, no walk spot lies on/in a roof or wall box, and the world_m1 ruin entities stand clear of its boxes.
// Run: node engine/world/buildingColliders.test.js
import fs from 'node:fs';
import { buildingBoxShapes, buildPropCollider } from './colliders.js';
import { moveCircleMesh, probeSupport } from '../physics/meshCollide.js';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis;
for (const f of ['palette', 'detail-pass']) (0, eval)(fs.readFileSync(new URL(`../../design/${f}.js`, import.meta.url), 'utf8'));
globalThis.ASSETS.models = globalThis.ASSETS.models || {};
(0, eval)(fs.readFileSync(new URL('../../design/models/buildings_voxel.js', import.meta.url), 'utf8'));
const A = globalThis.ASSETS;
let pass = 0, fail = 0;
const failures = [];
const ok0 = makeOk(() => pass++, () => fail++, (msg) => failures.push(msg));
const ok = (cond, name) => ok0(name, !!cond, '');
const OPTS = { height: 1.8, stepUpMax: 0.45, walkCos: Math.cos(50 * Math.PI / 180) };
const R = 0.3;

const place = (id, x = 0, y = 0, z = 0, yawDeg = 0) => {
  const m = A.models[id], shapes = [];
  buildingBoxShapes(shapes, m.colliders, { x, y, z, yawDeg }, id);
  return { m, shapes, col: buildPropCollider(shapes, shapes.length) };
};
// rotate a model-frame point by the placement yaw (same convention as buildingBoxShapes)
const rot = (yawDeg, x, y) => { const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c * x - s * y, s * x + c * y]; };

ok(A.buildingsVoxel.ids.length >= 10 && A.buildingsVoxel.ids.every((i) => A.models[i]), 'all bld* models registered in ASSETS.models');
for (const id of A.buildingsVoxel.ids) {
  const { m, shapes, col } = place(id, 100, 200, 5, 90);
  ok(m.colliders.length > 0 && shapes.length === m.colliders.length, `${id}: ${shapes.length} boxes -> static shapes`);
  ok(col && col.kind === 'trimesh' && col.max[2] > 5, `${id}: static trimesh collider`);
}

// walker: moves along a straight line in 0.1 m strokes, footZ follows the support (probeSupport) like the player
function walk(col, from, to, footZ) {
  const out = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  const sup = { floorZ: 0, floorHit: false, fnx: 0, fny: 0, fnz: 0, floorCollider: -1, floorTri: -1, ceilZ: 0, ceilHit: false };
  let [x, y] = from, z = footZ;
  const len = Math.hypot(to[0] - x, to[1] - y), n = Math.ceil(len / 0.1);
  for (let i = 0; i < n; i++) {
    const dx = (to[0] - from[0]) / n, dy = (to[1] - from[1]) / n;
    moveCircleMesh([col], 1, x, y, dx, dy, R, z, true, OPTS, out);
    x = out.x; y = out.y;
    probeSupport([col], 1, x, y, z, true, OPTS, sup);
    if (sup.floorHit && sup.floorZ <= z + OPTS.stepUpMax + 1e-6 && sup.floorZ > z - 0.6) z = sup.floorZ;
  }
  return { x, y, z, dist: Math.hypot(to[0] - x, to[1] - y) };
}

// stairs: walk the ramp from 0.6 m before the first tread to the middle of the last box (landing / top)
for (const id of ['bldHouseTwo', 'bldWatchtower', 'bldStairsStone']) {
  const { m, col } = place(id);
  for (const st of m.walk.stairs) {
    const byId = Object.fromEntries(m.colliders.map((c) => [c.id, c.box]));
    const f = byId[st.steps[0]], l = byId[st.steps[st.steps.length - 1]];
    const mid = (b) => [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2];
    const a = mid(f), z0 = Math.max(0, f[5] - 0.25), b = mid(l);
    const dir = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / dir, uy = (b[1] - a[1]) / dir;
    const r = walk(col, [a[0] - ux * 0.6, a[1] - uy * 0.6], b, z0);
    ok(r.dist < 0.2 && Math.abs(r.z - l[5]) < 0.05, `${id} stair ${st.id}: top reached (z ${r.z.toFixed(2)} of ${l[5]}, miss ${r.dist.toFixed(2)} m)`);
  }
}

// doors: walk 1.2 m outside -> 1.2 m inside along the wall normal, at every yaw of 0/90/180/270
const OUT = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
for (const id of A.buildingsVoxel.ids) {
  const { m } = place(id);
  for (const d of m.walk.doors) {
    const n = OUT[d.wall]; if (!n) continue;
    const cx = (d.box[0] + d.box[3]) / 2, cy = (d.box[1] + d.box[4]) / 2;
    for (const yaw of [0, 90, 180, 270]) {
      const { col } = place(id, 0, 0, 0, yaw);
      const p = (k) => rot(yaw, cx + n[0] * k, cy + n[1] * k);
      // start up to 1.4 m outside, but on the door's own floor (a raised door, e.g. the watchtower landing, has only a short deck outside; floor must reach 0.4 m behind the start)
      let k0 = 1.4;
      const sp = { floorZ: 0, floorHit: false, fnx: 0, fny: 0, fnz: 0, floorCollider: -1, floorTri: -1, ceilZ: 0, ceilHit: false };
      for (; k0 > 0.5; k0 -= 0.1) { const q = p(k0 + 0.4); probeSupport([col], 1, q[0], q[1], d.box[2], true, OPTS, sp); if (sp.floorHit && Math.abs(sp.floorZ - d.box[2]) < 0.1) break; }
      const r = walk(col, p(k0), p(-1.4), d.box[2]);
      ok(r.dist < 0.2 && Math.abs(r.z - d.box[2]) < 0.35, `${id} door ${d.id} yaw ${yaw}: passable (miss ${r.dist.toFixed(2)} m)`);
    }
  }
}

// NPC / giver spots: never inside a wall/roof/etc. box, always with the floor under them
for (const id of A.buildingsVoxel.ids) {
  const { m } = place(id);
  for (const [name, s] of Object.entries(m.walk.spots)) {
    const bad = m.colliders.filter((c) => c.kind !== 'floor' && c.kind !== 'step' && c.kind !== 'landing' && c.box[0] < s[0] && s[0] < c.box[3] && c.box[1] < s[1] && s[1] < c.box[4] && s[2] > c.box[2] - 0.05 && s[2] < c.box[5] - 0.05);
    const roof = m.colliders.filter((c) => c.kind === 'roof' && c.box[0] < s[0] && s[0] < c.box[3] && c.box[1] < s[1] && s[1] < c.box[4] && s[2] >= c.box[5] - 0.05);
    ok(!bad.length && !roof.length, `${id}.spots.${name}: clear of blockers, not on a roof`);
  }
}

// world_m1: the Rook ruin entities stand clear of the bldRuin boxes (nest, chests, Rook)
const W = JSON.parse(fs.readFileSync(new URL('../../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const house = W.entities.find((e) => e.id === 'bldRuinHouse');
ok(!!house && house.components.voxel.model === 'bldRuin', 'world_m1 has the bldRuinHouse entity');
ok(!W.structures.some((s) => /Wall_UnevenBrick|Prop_Chimney2/.test(s.mesh) && Math.hypot(s.origin.x - house.x, s.origin.y - house.y) < 9), 'no kit wall/chimney pieces left at the ruin');
for (const id of ['nest', 'chestBoots', 'chestRook', 'rook']) {
  const e = W.entities.find((q) => q.id === id), lx = e.x - house.x, ly = e.y - house.y;
  const hit = A.models.bldRuin.colliders.filter((c) => c.box[0] - 0.2 < lx && lx < c.box[3] + 0.2 && c.box[1] - 0.2 < ly && ly < c.box[4] + 0.2 && c.box[2] < 0.6 && c.kind !== 'floor');
  ok(!hit.length, `${id} clear of bldRuin boxes${hit.length ? ' (' + hit.map((c) => c.id).join(',') + ')' : ''}`);
}
console.log(`buildingColliders: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('FAIL ' + f);
process.exit(fail ? 1 : 0);
