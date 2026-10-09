#!/usr/bin/env node
// MESH-PHYS-01 bench: collideCircle cost with the 29 road-side Quaternius meshes of content/worlds/world_m1.
//   node tools/bench-mesh-collide.mjs
// "before" = render triangles, one collider per placed mesh (no proxy, no collide:false, no merge);
// "after"  = what World.load does now (proxy / collide:false / one merged BVH).
// Uses only the public engine entry; the "before" set is built by stripping `collider`/`collide` from the
// mesh data and building one BVH per mesh exactly like the old colliders.js did.
import fs from 'node:fs';
import { readMeshJSON } from './mesh-file.mjs';
import { meshFromJSON, makeFrame, PHYSICS, World } from '../engine/index.js';
import { buildWorldColliders, moveCircleMesh, probeSupport, buildBvhFromMesh, frameMatrix12 } from '../engine/dev.js';

const world = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const placed = world.structures.filter((s) => s.mesh);
const meshes = new Map();
for (const s of placed) if (!meshes.has(s.mesh)) meshes.set(s.mesh, meshFromJSON(readMeshJSON(`content/meshes/${s.mesh}.mesh.json`)));

function setup(strip) {
  const asset = (id) => {
    const m = meshes.get(id);
    if (!strip) return m;
    const c = { ...m }; delete c.collider; delete c.collide; return c;
  };
  const structs = placed.map((s) => ({ id: s.id, mesh: asset(s.mesh), origin: s.origin, frame: makeFrame(s.origin.x, s.origin.y, s.origin.z, 0, s.yawDeg || 0) }));
  if (!strip) return buildWorldColliders({ structures: structs, assets: { mesh: asset } });
  // old path: one collider (BVH over the render tris) per mesh
  return structs.map((s) => {
    const bvh = buildBvhFromMesh(s.mesh, frameMatrix12(s.frame, new Float64Array(12)));
    return { id: s.id, kind: 'trimesh', bvh, enabled: true,
      min: Float64Array.from(bvh.nodeMin.subarray(0, 3)), max: Float64Array.from(bvh.nodeMax.subarray(0, 3)) };
  });
}

// Deterministic walk path along the road verge; footZ follows the structures' mean slope.
const xs = placed.map((s) => s.origin.x), ys = placed.map((s) => s.origin.y);
const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
const N = 20000;
const pts = [];
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
for (let i = 0; i < N; i++) {
  const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
  pts.push([x, y, -1.23 + (x - 1412) * 0.0685, (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.2]);
}
const opts = { height: PHYSICS.height, stepUpMax: PHYSICS.stepUpMax, walkCos: Math.cos(PHYSICS.maxSlopeDeg * Math.PI / 180) };
const out = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
const sup = {};

function bench(label, colliders) {
  const R = 0.3, n = colliders.length;
  let sink = 0;
  for (let pass = 0; pass < 2; pass++) for (const p of pts) { moveCircleMesh(colliders, n, p[0], p[1], p[3], p[4], R, p[2], true, opts, out); sink += out.x; } // warm-up
  let best = Infinity, bestP = Infinity;
  for (let rep = 0; rep < 5; rep++) {
    let t = performance.now();
    for (const p of pts) { moveCircleMesh(colliders, n, p[0], p[1], p[3], p[4], R, p[2], true, opts, out); sink += out.x; }
    best = Math.min(best, (performance.now() - t) * 1000 / N);
    t = performance.now();
    for (const p of pts) { probeSupport(colliders, n, p[0], p[1], p[2], true, opts, sup); sink += sup.floorZ; }
    bestP = Math.min(bestP, (performance.now() - t) * 1000 / N);
  }
  let tris = 0;
  for (const c of colliders) tris += c.bvh.triCount;
  console.log(`${label.padEnd(34)} colliders ${String(n).padStart(2)}  tris ${String(tris).padStart(6)}  collideCircle ${best.toFixed(2)} us/call  probeSupport ${bestP.toFixed(2)} us/call`);
  return best;
}
console.log(`${placed.length} placed road-side meshes, ${N} random verge positions`);
const before = bench('before (render tris, 1 BVH/mesh)', setup(true));
const after = bench('after (proxy + collide:false + merged)', setup(false));
console.log(`speed-up x${(before / after).toFixed(1)}  target <= 1.5 us/call: ${after <= 1.5 ? 'OK' : 'MISS'}`);
if (process.argv.includes('--assert') && after > 1.5) process.exit(1);

// ED-MESH-01e: World.rebuildMeshColliders() cost on the same placements (budget <= 3 ms, architecture 37.20).
{
  const w = Object.create(World.prototype);
  Object.assign(w, { structures: [], renderVersion: 0, structVersion: 0, events: null, physicsMode: 'mesh', colliders: [], assets: { mesh: (id) => meshes.get(id) } });
  for (const s of placed) w.placeMesh(meshes.get(s.mesh), s.origin, s.id, s.yawDeg || 0);
  w.colliders = buildWorldColliders(w);
  for (let i = 0; i < 3; i++) w.rebuildMeshColliders(); // warm-up
  const ts = [];
  for (let i = 0; i < 15; i++) { w.setMeshPlacement(placed[0].id, { x: placed[0].origin.x + i * 0.1, y: placed[0].origin.y, z: placed[0].origin.z, yaw: i * 7 }); const t = performance.now(); w.rebuildMeshColliders(); ts.push(performance.now() - t); }
  ts.sort((a, b) => a - b);
  console.log(`rebuildMeshColliders (${placed.length} placements) median ${ts[7].toFixed(2)} ms  max ${ts[14].toFixed(2)} ms  budget <= 3 ms: ${ts[7] <= 3 ? 'OK' : 'MISS'}`);
}
