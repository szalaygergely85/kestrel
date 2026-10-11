// engine/mesh/meshDrawCap.test.js - OB-039: the MAX_MESH_DRAWS cap on single placed-mesh draws.
// When a scene asks for more single draws than the cap, the pick must be (1) frustum-aware (off-screen props never take a
// slot), (2) deterministic nearest-first by the documented key (distance / bbox radius, ties: lower structure index),
// (3) counted in `meshFeedStats` (requested / kept / dropped) for F3. The shadow feed keeps its own eye-based pick.
// Run: node engine/mesh/meshDrawCap.test.js
import { readMeshJSON } from '../test/meshFile.test.js';
import { World } from '../world/World.js';
import { meshFromJSON } from './MeshData.js';
import { DrawList, MeshDrawCache, addMeshStructures, meshFeedStats, MAX_MESH_DRAWS } from './DrawList.js';
import { MeshGroupSet, addMeshStructuresBatched } from './meshGroups.js';
import { frustumPlanes, classifyAABB, CULL_OUT } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const rock = meshFromJSON(readMeshJSON(new URL('../../content/meshes/quaternius/Rock_Medium_1.mesh.json', import.meta.url)));
const idFor = () => 1;
const mkWorld = () => ({ structures: [], renderVersion: 0, structVersion: 0, events: null });
// a distinct mesh object per placement = never grouped (each is a lone placement) -> every one is a capped single
const place = (w, x, y, scale) => { const s = World.prototype.placeMesh.call(w, { ...rock, id: 'r' + w.structures.length }, { x, y, z: 0 }, `m${w.structures.length}`, (w.structures.length * 37) % 360); if (scale) s.scale = scale; return s; };

// camera at the origin looking north (yaw 0 = -y); 150 props ahead (north), 150 behind (south), mixed sizes, pseudo-random spread
const w = mkWorld();
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
for (let i = 0; i < 300; i++) {
  const ahead = i % 2 === 0, d = 4 + rnd() * 120, lat = (rnd() - 0.5) * d * 0.6;
  place(w, lat, ahead ? -d : d, i % 5 === 0 ? 2.5 : 0);
}
const cam = { x: 0, y: 0, z: 1.7, yawDeg: 0, pitchDeg: 0 };
const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
projTerms(cam, { cols: 240, rows: 90, pxCellW: 1, pxCellH: 1 }, terms); shearProjection(terms, M); frustumPlanes(M, planes);

const visible = (s) => { const b = s.bbox; return classifyAABB(planes, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1) !== CULL_OUT; };
// oracle: the documented key, computed independently
const keyOf = (s) => {
  const b = s.bbox, cx = Math.min(Math.max(cam.x, b.x0), b.x1), cy = Math.min(Math.max(cam.y, b.y0), b.y1);
  const d = Math.hypot(cam.x - cx, cam.y - cy), r = 0.5 * Math.hypot(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0);
  return (d + 0.5) / (r > 0.25 ? r : 0.25);
};
const inView = [];
w.structures.forEach((s, i) => { if (visible(s)) inView.push(i); });
const oracle = inView.slice().sort((a, b) => keyOf(w.structures[a]) - keyOf(w.structures[b]) || a - b).slice(0, MAX_MESH_DRAWS);

const run = (pl, shadow = false) => {
  const l = new DrawList(); l.begin();
  addMeshStructures(l, w, cam, new MeshDrawCache(), idFor, 2000, shadow, null, null, pl);
  const ids = []; for (let i = 0; i < l.count; i++) ids.push(l.items[i].objectId - 0xA000);
  return ids;
};

ok('scene asks for more in-view singles than the cap (test premise)', inView.length > MAX_MESH_DRAWS, `inView ${inView.length}`);
const a = run(planes);
ok('kept = cap', a.length === MAX_MESH_DRAWS, `kept ${a.length}`);
ok('every kept single is inside the frustum (no slot wasted off-screen)', a.every((si) => visible(w.structures[si])));
ok('kept set = the cap smallest keys among in-view props (distance / radius, ties lower index)',
  a.slice().sort((x, y) => x - y).join() === oracle.slice().sort((x, y) => x - y).join());
ok('drawn near -> far (bbox distance)', a.every((si, k) => k === 0 || distOf(si) >= distOf(a[k - 1]) - 1e-9));
function distOf(si) { const b = w.structures[si].bbox; return Math.hypot(Math.min(Math.max(0, b.x0), b.x1), Math.min(Math.max(0, b.y0), b.y1)); }
ok('meshFeedStats: requested = in-view, kept = cap, dropped = difference',
  meshFeedStats.requested === inView.length && meshFeedStats.kept === MAX_MESH_DRAWS && meshFeedStats.dropped === inView.length - MAX_MESH_DRAWS && meshFeedStats.frustum === 1,
  JSON.stringify(meshFeedStats));
ok('deterministic: same scene -> identical order', run(planes).join() === a.join());

// OB-039 regression: the frustum-blind pick spends slots behind the camera
const blind = run(null);
const blindVisible = blind.filter((si) => visible(w.structures[si])).length;
ok('frustum-blind pick (planes null) keeps fewer on-screen props (the OB-039 bug shape)', blindVisible < MAX_MESH_DRAWS, `on-screen ${blindVisible}`);

// shadow feed ignores the camera planes and does not touch the camera stats
const before = { ...meshFeedStats };
const sh = run(planes, true);
ok('shadow feed: planes ignored (behind-camera casters still eligible)', sh.some((si) => !visible(w.structures[si])));
ok('shadow feed leaves meshFeedStats alone', JSON.stringify(before) === JSON.stringify(meshFeedStats));

// batched feed passes the planes through to the single pick; under the cap nothing is dropped
{
  const w2 = mkWorld();
  for (let i = 0; i < 20; i++) World.prototype.placeMesh.call(w2, { ...rock, id: 'q' + i }, { x: (i - 10) * 2, y: -15, z: 0 }, `q${i}`, 0);
  const l = new DrawList(); l.begin();
  addMeshStructuresBatched(l, w2, cam, new MeshDrawCache(), idFor, 2000, new MeshGroupSet(), planes);
  ok('batched feed: under the cap -> dropped 0, kept = requested', meshFeedStats.dropped === 0 && meshFeedStats.kept === meshFeedStats.requested && meshFeedStats.requested > 0, JSON.stringify(meshFeedStats));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
