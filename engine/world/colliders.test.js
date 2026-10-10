import { dynamicTowerAssets } from '../../tools/testing/dynamic-tower.mjs';
// engine/world/colliders.test.js (ME-11a, docs/architecture.md 27.18 "Test
// matrix"). Headless Node ESM, no framework. Run: node engine/world/colliders.test.js
//
// Covers (ME-11a scope only - roller/contacts.js parts of 27.18's test
// matrix are ME-11b, not here): collider ids/order + AABB sanity on the
// real `world_m1`/`tower`; grate refit at t = 0, 0.25, 0.5, 1 against a
// fresh `buildLevelMesh` + `buildBvhFromMesh` build of the same `ceilH`
// (triangle multiset, 1e-9); `refitDynCollider` zero allocation; `supportAt`
// vs `floorAt`/`ceilAt` on every walkable tower cell centre; save round
// trip mid-grate-animation, 200 seeded probes bit-equal.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World } from './World.js';
import { serialize, deserialize } from './serialize.js';
import { refitDynCollider, dynBarrierQuads } from './colliders.js';
import { buildLevelMesh } from '../mesh/levelMesh.js';
import { isSectorPassable } from '../physics/capsule.js';
import { buildBvh } from '../physics/bvh.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainDef from '../../design/levels/overworld_far.js';
import lanternMod from '../../design/models/lantern.js';
import leverMod from '../../design/models/lever.js';
import voxelPropsMod from '../../design/models/voxel_props.js';
import boulderMod from '../../design/models/boulder.js';
import rubbleMod from '../../design/models/rubble.js';
import wreckageMod from '../../design/models/wreckage.js';
import relayMod from '../../design/models/relay.js';
import swordMod from '../../design/models/sword.js';
import m3PropsMod from '../../design/models/m3_props.js';
import farTowerMod from '../../design/models/far_tower.js';
import ferrumLightsMod from '../../design/models/ferrum_lights.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../test/assert.js';

if (typeof global.gc !== 'function') {
  const res = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod; terrainDef;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; voxelPropsMod;
farTowerMod; ferrumLightsMod;
const { assets: canonicalAssets } = await loadTestAssets();
const assets = dynamicTowerAssets(canonicalAssets);

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cmpVert(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
}
/** Rotates a 9-number triangle so its lexicographically-smallest vertex is first (winding preserved). */
function canonicalizeTri(t) {
  const verts = [t.slice(0, 3), t.slice(3, 6), t.slice(6, 9)];
  let minIdx = 0;
  for (let i = 1; i < 3; i++) if (cmpVert(verts[i], verts[minIdx]) < 0) minIdx = i;
  return [...verts[minIdx], ...verts[(minIdx + 1) % 3], ...verts[(minIdx + 2) % 3]];
}
function triKey(t) { return t.map((v) => v.toFixed(6)).join(','); }
function trianglesOf(bvh) {
  const list = [];
  for (let i = 0; i < bvh.triCount; i++) {
    const o = i * 9;
    list.push(Array.from(bvh.tri.subarray(o, o + 9)));
  }
  return list;
}
/** Triangle-multiset comparison (order-independent, per-vertex tolerance). */
function multisetMatch(bvhA, bvhB) {
  if (bvhA.triCount !== bvhB.triCount) return { ok: false, maxErr: Infinity, reason: `triCount ${bvhA.triCount} vs ${bvhB.triCount}` };
  const a = trianglesOf(bvhA).map(canonicalizeTri).sort((x, y) => (triKey(x) < triKey(y) ? -1 : 1));
  const b = trianglesOf(bvhB).map(canonicalizeTri).sort((x, y) => (triKey(x) < triKey(y) ? -1 : 1));
  let maxErr = 0;
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < 9; k++) maxErr = Math.max(maxErr, Math.abs(a[i][k] - b[i][k]));
  }
  return { ok: maxErr <= 1e-9, maxErr };
}

function translationMatrix(origin) {
  return Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, origin.x, origin.y, origin.z]);
}

function toRad(deg) { return (deg * Math.PI) / 180; }

// ---------------------------------------------------------------------------
// 1. World with physics: 'mesh' - collider ids/order, AABB sanity
// ---------------------------------------------------------------------------

const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const tower = world.structures.find((s) => s.id === 'tower');

ok('world.physicsMode === "mesh"', world.physicsMode === 'mesh');
ok('world.colliders is non-empty', world.colliders.length > 0);
ok('deterministic ids/order: level colliders, authored props, then kinematic NPCs', world.colliders.map((c) => c.id).filter((id) => id !== 'meshes:static').join(',') === 'tower,tower:grate,props:static,npcs:kinematic', // CH1-08a: Fen (kinematic NPC) in world_m1
  world.colliders.map((c) => c.id).join(','));

{
  const base = world.colliders.find((c) => c.id === 'tower');
  ok('base collider AABB x inside structure bbox (GS-01d: terrainFloor ring cells emit no floor, <= 1 cell short)', base.min[0] >= tower.bbox.x0 - 1e-6 && base.max[0] <= tower.bbox.x1 + 1e-6 && base.min[0] - tower.bbox.x0 <= 1 + 1e-6 && tower.bbox.x1 - base.max[0] <= 1 + 1e-6,
    `min.x=${base.min[0]} max.x=${base.max[0]} bbox=${tower.bbox.x0}..${tower.bbox.x1}`);
  ok('base collider AABB y inside structure bbox (GS-01d: terrainFloor ring cells emit no floor, <= 1 cell short)', base.min[1] >= tower.bbox.y0 - 1e-6 && base.max[1] <= tower.bbox.y1 + 1e-6 && base.min[1] - tower.bbox.y0 <= 1 + 1e-6 && tower.bbox.y1 - base.max[1] <= 1 + 1e-6,
    `min.y=${base.min[1]} max.y=${base.max[1]} bbox=${tower.bbox.y0}..${tower.bbox.y1}`);
  ok('base collider AABB z is a sane range (below floor, above summit)', base.min[2] < tower.origin.z && base.max[2] > tower.origin.z + 6,
    `min.z=${base.min[2]} max.z=${base.max[2]}`);
}

// ---------------------------------------------------------------------------
// 2. Grate refit at t = 0, 0.25, 0.5, 1 vs a fresh build of the SAME ceilH
// ---------------------------------------------------------------------------

{
  const grateCh = tower.tagMap.get('grate');
  const sector = tower.level.legend[grateCh];
  const matrix12 = translationMatrix(tower.origin);
  let worstErr = 0;
  for (const t of [0, 0.25, 0.5, 1]) {
    const ceilH = sector.floorH + (sector.dynamic.ceilOpen - sector.floorH) * t; // linear here is fine - this test only cares the two builds agree at the SAME ceilH
    sector.ceilH = ceilH;
    refitDynCollider(world, tower, 'grate');
    const collider = world.colliders.find((c) => c.id === 'tower:grate');

    // Fresh, independent build at the same ceilH.
    const fresh = buildLevelMesh(tower.level);
    const freshDyn = fresh.dyn.find((d) => d.tag === 'grate');
    // 27.18b: a fresh build = rebuilt dyn mesh + the barrier quads at the same ceilH.
    const freshPos = Float64Array.from([...freshDyn.mesh.pos, ...dynBarrierQuads(tower.level, grateCh, ceilH)]);
    const freshBvh = buildBvh(freshPos, null, matrix12);

    const cmp = multisetMatch(collider.bvh, freshBvh);
    worstErr = Math.max(worstErr, cmp.maxErr);
    ok(`grate refit t=${t}: triangle multiset matches a fresh build (1e-9)`, cmp.ok, `maxErr=${cmp.maxErr} ${cmp.reason || ''}`);
    ok(`grate refit t=${t}: collider AABB matches the fresh build's root bounds`,
      Math.abs(collider.min[2] - freshBvh.nodeMin[2]) < 1e-9 && Math.abs(collider.max[2] - freshBvh.nodeMax[2]) < 1e-9,
      `collider z ${collider.min[2]}..${collider.max[2]} fresh z ${freshBvh.nodeMin[2]}..${freshBvh.nodeMax[2]}`);
  }
  console.log(`  (grate refit worst triangle error over t=0,0.25,0.5,1: ${worstErr})`);
}

// ---------------------------------------------------------------------------
// 3. Refit zero allocation (--expose-gc, 10k refits)
// ---------------------------------------------------------------------------

{
  const grateCh = tower.tagMap.get('grate');
  const sector = tower.level.legend[grateCh];
  const savedCeilH = sector.ceilH;
  let seed = 5;
  function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  function callOnce() {
    sector.ceilH = sector.floorH + rng() * (sector.dynamic.ceilOpen - sector.floorH);
    refitDynCollider(world, tower, 'grate');
  }
  for (let i = 0; i < 5000; i++) callOnce(); // warm up (meshCollide.test.js's own note: TurboFan needs this much before the measured window)
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) callOnce();
  global.gc();
  const after = process.memoryUsage().heapUsed;
  const grew = after - before;
  sector.ceilH = savedCeilH;
  refitDynCollider(world, tower, 'grate');
  ok('10k refitDynCollider calls: no significant heap growth (--expose-gc)', grew < 64 * 1024, `grew by ${grew} bytes`);
}

// ---------------------------------------------------------------------------
// 4. supportAt vs floorAt/ceilAt on every walkable tower cell centre
// ---------------------------------------------------------------------------

{
  const opts = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(toRad(50)) };
  let checked = 0, floorMismatches = [], ceilMismatches = [], knownGrateCeilDiffs = 0, terrainAboveFloor = [];
  for (let r = 0; r < tower.level.height; r++) {
    for (let c = 0; c < tower.level.width; c++) {
      const sec = tower.level.sectorAt(c + 0.5, r + 0.5);
      if (!sec || sec.solid) continue;
      const wx = tower.origin.x + c + 0.5, wy = tower.origin.y + r + 0.5;
      const expectedFloor = world.floorAt(wx, wy);
      const expectedCeil = world.ceilAt(wx, wy);
      checked++;

      if (world.terrain) {
        const terrainZ = world.terrain.groundAt(wx, wy);
        if (terrainZ > expectedFloor + 1e-9) {
          terrainAboveFloor.push({ c, r, terrainZ, expectedFloor });
          continue; // BUG-OWN-008-adjacent case (27.18 test matrix) - report, don't fail
        }
      }

      const sup = world.supportAt(wx, wy, expectedFloor, true, opts);
      if (Math.abs(sup.floorH - expectedFloor) > 1e-6) {
        floorMismatches.push({ c, r, floorH: sup.floorH, expectedFloor });
      }
      const supCeil = sup.ceilH === 'sky' ? 'sky' : sup.ceilH;
      const gridCeil = expectedCeil === 'sky' ? 'sky' : expectedCeil;
      const ceilOk = supCeil === gridCeil || (typeof supCeil === 'number' && typeof gridCeil === 'number' && Math.abs(supCeil - gridCeil) < 1e-6);
      if (!ceilOk) {
        // Known, already-flagged difference (docs/backlog.md ME-10 row): the
        // tower's only `tag:'grate'` cell borders `ceilH:'sky'` on both
        // neighbours, so levelMesh.js's upper/lintel rule (needs BOTH
        // neighbours numeric-ceilH) never emits a blocking face there - the
        // mesh ceiling probe sees straight through to the sky while the grid
        // still reports the closed grate's own ceilH. Not a colliders.js/
        // World.js bug (frozen per 27.17), reported not failed.
        if (sec.dynamic) knownGrateCeilDiffs++;
        else ceilMismatches.push({ c, r, ceilH: sup.ceilH, expectedCeil });
      }
    }
  }
  console.log(`  (supportAt vs floorAt/ceilAt: ${checked} walkable cells checked, ${terrainAboveFloor.length} terrain-above-floor reported, ${knownGrateCeilDiffs} known grate/sky ceilH diffs reported)`);
  ok('supportAt.floorH matches world.floorAt on every walkable cell (terrain-above-floor excepted)', floorMismatches.length === 0,
    JSON.stringify(floorMismatches.slice(0, 5)));
  ok('supportAt.ceilH matches world.ceilAt on every walkable cell (known grate/sky diff excepted)', ceilMismatches.length === 0,
    JSON.stringify(ceilMismatches.slice(0, 5)));
}

// ---------------------------------------------------------------------------
// 4b. 27.18b barrier quads: block parity with the grid, tri count, no warn
// ---------------------------------------------------------------------------

{
  const grateCh = tower.tagMap.get('grate');
  const sector = tower.level.legend[grateCh];
  const saved = sector.ceilH;
  const opts = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(toRad(50)) };
  const o = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  // Walk a 0.3 m circle along the grate row from x0 to x1 in 0.02 m steps; returns the x it stops at (or the end x).
  function walkX(w, st, x0, x1, footZ) {
    const y = st.origin.y + 10.5, dir = Math.sign(x1 - x0), step = 0.02;
    let x = st.origin.x + x0;
    const end = st.origin.x + x1;
    for (let i = 0; i < 400 && (end - x) * dir > 1e-9; i++) {
      w.collideCircle(x, y, dir * step, 0, 0.3, footZ, true, opts, o);
      const moved = o.x - x;
      x = o.x;
      if (Math.abs(moved - dir * step) > 1e-6) break;
    }
    return x - st.origin.x;
  }
  const footZ = tower.origin.z + sector.floorH + 0.001;
  const anim = (w, t) => w.animateSector('grate', t);
  // Grid reference: grid physics blocks per cell via isSectorPassable, so the circle stops at the cell edge +- radius when impassable.
  const gridStop = (fromEast, end, fz = footZ) => (isSectorPassable(sector, fz, true, opts) ? end : (fromEast ? 19.3 : 17.7));
  anim(world, 0);
  const fromE = walkX(world, tower, 20.5, 17.5, footZ), gE = gridStop(true, 17.5);
  ok('closed grate (mesh) blocks from the east within 0.05 m of the grid (19.30)', Math.abs(fromE - gE) <= 0.05 && Math.abs(fromE - 19.3) <= 0.05, `mesh ${fromE} grid ${gE}`);
  const fromW = walkX(world, tower, 17.5, 20.5, tower.origin.z + 3.3), gW = gridStop(false, 20.5, tower.origin.z + 3.3);
  ok('closed grate (mesh) blocks from the west within 0.05 m of the grid', Math.abs(fromW - gW) <= 0.05 && fromW < 18 && Math.abs(fromW - 17.7) <= 0.05, `mesh ${fromW} grid ${gW}`);
  let allOk = true, detail = '';
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    anim(world, t);
    const m = walkX(world, tower, 20.5, 17.5, footZ), g = gridStop(true, 17.5);
    const same = Math.abs(m - g) <= 0.05 && (t < 1 || m <= 17.51);
    if (!same) { allOk = false; detail += ` t=${t}: mesh ${m} grid ${g};`; }
    const gc = world.colliders.find((c) => c.id === 'tower:grate');
    const triN = gc.bvh.triCount;
    ok(`grate tri count at t=${t} = 10 + 2 x barrier edges (16)`, triN === 16, `tris ${triN}`);
  }
  ok('open (t=1) passes; closed..mid-anim blocks equal the grid at footZ = floorH (+-0.05 m)', allOk, detail);
  anim(world, 0);

  // refit == fresh rebuild + barriers is covered in section 2; 10000 refits heap growth:
  for (let i = 0; i < 5000; i++) { sector.ceilH = sector.floorH + (i % 97) / 97 * 2.4; refitDynCollider(world, tower, 'grate'); }
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 10000; i++) { sector.ceilH = sector.floorH + (i % 89) / 89 * 2.4; refitDynCollider(world, tower, 'grate'); }
  global.gc();
  const grew = process.memoryUsage().heapUsed - before;
  sector.ceilH = saved; refitDynCollider(world, tower, 'grate');
  ok('10000 refits with barriers: no significant heap growth', grew < 64 * 1024, `grew ${grew} bytes`);

  const warns = [];
  const w0 = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); };
  World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
  console.warn = w0;
  ok('no sentinel warning logged on world_m1 load', !warns.some((m) => /sentinel/.test(m)), warns.join(' | '));
}

// ---------------------------------------------------------------------------
// 5. Save round trip mid-grate-animation: 200 seeded probes bit-equal
// ---------------------------------------------------------------------------

{
  world.animateSector('grate', 0.37); // mid-animation - World.animateSector refits the mesh collider itself when physicsMode === 'mesh'

  const state = serialize(world);
  const world2 = deserialize(state, assets, { physics: 'mesh' });
  const tower2 = world2.structures.find((s) => s.id === 'tower');

  ok('round trip: same collider ids/order', world2.colliders.map((c) => c.id).join(',') === world.colliders.map((c) => c.id).join(','));
  const g1 = world.colliders.find((c) => c.id === 'tower:grate');
  const g2 = world2.colliders.find((c) => c.id === 'tower:grate');
  ok('round trip: grate ceilH restored to the saved t (bit-equal sector.ceilH)',
    tower.level.legend[tower.tagMap.get('grate')].ceilH === tower2.level.legend[tower2.tagMap.get('grate')].ceilH);
  ok('round trip: grate collider triangle multiset bit-equal (1e-9)', multisetMatch(g1.bvh, g2.bvh).ok);

  const opts = { height: 1.7, stepUpMax: 0.45, walkCos: Math.cos(toRad(50)) };
  const out1 = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  const out2 = { x: 0, y: 0, blockedX: false, blockedY: false, nx: 0, ny: 0, overflow: false };
  let seed = 11;
  function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  let circleMismatches = 0, supportMismatches = 0;
  for (let i = 0; i < 200; i++) {
    const x = tower.origin.x + 1 + rng() * (tower.level.width - 2);
    const y = tower.origin.y + 1 + rng() * (tower.level.height - 2);
    const dx = (rng() * 2 - 1) * 0.2, dy = (rng() * 2 - 1) * 0.2;
    const z = tower.origin.z + rng() * 8;
    const grounded = rng() > 0.5;

    world.collideCircle(x, y, dx, dy, 0.3, z, grounded, opts, out1);
    world2.collideCircle(x, y, dx, dy, 0.3, z, grounded, opts, out2);
    if (out1.x !== out2.x || out1.y !== out2.y || out1.blockedX !== out2.blockedX || out1.blockedY !== out2.blockedY
      || out1.nx !== out2.nx || out1.ny !== out2.ny || out1.overflow !== out2.overflow) circleMismatches++;

    const s1 = world.supportAt(x, y, z, grounded, opts);
    const s1copy = { floorH: s1.floorH, ceilH: s1.ceilH, solid: s1.solid, terrain: s1.terrain, slope: s1.slope, nx: s1.nx, ny: s1.ny, nz: s1.nz };
    const s2 = world2.supportAt(x, y, z, grounded, opts);
    if (s1copy.floorH !== s2.floorH || s1copy.ceilH !== s2.ceilH || s1copy.solid !== s2.solid || s1copy.terrain !== s2.terrain
      || s1copy.slope !== s2.slope || s1copy.nx !== s2.nx || s1copy.ny !== s2.ny || s1copy.nz !== s2.nz) supportMismatches++;
  }
  ok('round trip: 200 seeded collideCircle probes bit-equal', circleMismatches === 0, `${circleMismatches} mismatches`);
  ok('round trip: 200 seeded supportAt probes bit-equal', supportMismatches === 0, `${supportMismatches} mismatches`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
