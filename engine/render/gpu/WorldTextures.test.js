// engine/render/gpu/WorldTextures.test.js (US-030a). Headless Node ESM, no
// framework. Run: node engine/render/gpu/WorldTextures.test.js
import { AssetRegistry } from '../../core/assets.js';
import { World } from '../../world/World.js';
import { buildWorldTextures, planFrameUpdate, makeFrameUpdatePlan, MAX_STRUCTS } from './WorldTextures.js';
import paletteMod from '../../../design/palette.js';
import towerDef from '../../../design/levels/tower.js';
import testRoomDef from '../../../design/levels/test_room.js';
import terrainDef from '../../../design/levels/overworld_far.js';
import worldMod from '../../../design/levels/world_m1.js';
// US-011 (7.5 item 1): World.load throws on an unregistered props[].model.
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
// US-016: the `farTower` entity + `ferrumLights` horizon billboard world_m1.js references.
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; towerDef; testRoomDef; terrainDef; worldMod;
lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod;
farTowerMod; ferrumLightsMod;
const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const world = World.load(assets.world('world_m1'), assets, {});
const atlas = buildWorldTextures(world);

// --- layout sanity -----------------------------------------------------------
let expectWidth = 0, expectHeight = 0;
for (const s of world.structures) { expectWidth = Math.max(expectWidth, s.packed.w); expectHeight += s.packed.h; }
ok('atlas.width == max placed structure width', atlas.width === expectWidth);
ok('atlas.height == sum of placed structure heights', atlas.height === expectHeight);
ok('structCount == world.structures.length', atlas.structCount === world.structures.length);
ok('never more than MAX_STRUCTS rows in uStruct', atlas.structCount <= MAX_STRUCTS);

// --- every placed structure's cells round-trip into the atlas ---------------
let allMatch = true;
for (let i = 0; i < world.structures.length; i++) {
  const s = world.structures[i];
  const p = s.packed;
  const yOff = atlas.yOffsets[i];
  for (let cy = 0; cy < p.h && allMatch; cy++) {
    for (let cx = 0; cx < p.w && allMatch; cx++) {
      const si = cy * p.w + cx;
      const di = (yOff + cy) * atlas.width + cx;
      for (let k = 0; k < 4; k++) {
        if (atlas.GEOM[di * 4 + k] !== p.geom[si * 4 + k]) allMatch = false;
        if (atlas.MATS[di * 4 + k] !== p.mats[si * 4 + k]) allMatch = false;
      }
      if (atlas.FLAGS[di * 2] !== p.flags[si]) allMatch = false;
      if (atlas.FLAGS[di * 2 + 1] !== p.relief[si]) allMatch = false;
    }
  }
}
ok('every placed structure cell (geom/mats/flags/relief) round-trips into the atlas', allMatch);

// --- uStruct rows -------------------------------------------------------------
let uStructOk = true;
for (let i = 0; i < world.structures.length; i++) {
  const s = world.structures[i];
  const o = i * 8;
  if (atlas.uStruct[o] !== s.origin.x) uStructOk = false;
  if (atlas.uStruct[o + 1] !== s.origin.y) uStructOk = false;
  if (atlas.uStruct[o + 2] !== s.origin.z) uStructOk = false;
  if (atlas.uStruct[o + 3] !== s.packed.w) uStructOk = false;
  if (atlas.uStruct[o + 4] !== s.packed.h) uStructOk = false;
  if (atlas.uStruct[o + 5] !== atlas.yOffsets[i]) uStructOk = false;
  if (atlas.uStruct[o + 6] !== s.structSeq) uStructOk = false;
}
ok('uStruct rows match origin/w/h/yOff/structSeq per placed structure', uStructOk);

// --- planFrameUpdate: no change -> no rebuild, no dirty rows -----------------
// Architect review 1 item 3: planFrameUpdate now writes into a caller-owned
// `out` (count + preallocated Int32Array ranges) instead of returning a
// fresh object/array every frame - tests allocate one `out` per call, which
// is fine (test-only paths may allocate).
const plan0 = planFrameUpdate(world, atlas, makeFrameUpdatePlan());
ok('no world/packed change: rebuildNeeded is false', plan0.rebuildNeeded === false);
ok('no world/packed change: no dirty ranges', plan0.count === 0);

// --- planFrameUpdate: animateSector bump -> dirty range covers touched rows --
const tower = world.structures.find((s) => s.id === 'tower');
if (tower && tower.level.legend['G']) {
  world.animateSector('grate', 0.5);
  const plan1 = planFrameUpdate(world, atlas, makeFrameUpdatePlan());
  ok('animateSector bump: rebuildNeeded stays false (same structures)', plan1.rebuildNeeded === false);
  ok('animateSector bump: at least one dirty range reported', plan1.count >= 1);
  // Re-verify the atlas now matches the just-updated packed layout in the dirty range.
  let dirtyMatches = true;
  for (let k = 0; k < plan1.count; k++) {
    const y0 = plan1.ranges[k * 2], y1 = plan1.ranges[k * 2 + 1];
    for (let gy = y0; gy <= y1 && dirtyMatches; gy++) {
      // Find which structure this global row belongs to.
      let si = -1;
      for (let i = 0; i < world.structures.length; i++) {
        const yOff = atlas.yOffsets[i], h = world.structures[i].packed.h;
        if (gy >= yOff && gy < yOff + h) { si = i; break; }
      }
      if (si < 0) { dirtyMatches = false; break; }
      const p = world.structures[si].packed;
      const cy = gy - atlas.yOffsets[si];
      for (let cx = 0; cx < p.w; cx++) {
        const glI = gy * atlas.width + cx, pI = cy * p.w + cx;
        if (atlas.GEOM[glI * 4 + 1] !== p.geom[pI * 4 + 1]) dirtyMatches = false;
      }
    }
  }
  ok('dirty range content matches the updated packed layout', dirtyMatches);
  world.animateSector('grate', 0); // restore
} else {
  ok('(skipped: no animated "grate" tag on this content pack - not a failure)', true);
}

// --- US-007 ARCH CHANGES item 3: planFrameUpdate refreshes uStruct[i*8+7]
// (packUStruct's maxH slot) for every structure whose packed.version
// advanced, independent of the dirty-row texSubImage2D path (today's real
// trigger is updateAnimatedSector - e.g. a grate's ceilH/topH change moving
// the structure's sun-DDA escape height - but the refresh itself only
// depends on `version` having moved on, not on how it moved; a direct
// version bump exercises the same planFrameUpdate code path deterministically).
{
  const tower2 = world.structures.find((s) => s.id === 'tower');
  ok('(setup) tower structure present for the maxH-refresh check', !!tower2);
  if (tower2) {
    const before = atlas.uStruct[tower2.structSeq * 8 + 7];
    ok('before mutation: uStruct maxH slot matches packed.maxH', before === tower2.packed.maxH, `${before} vs ${tower2.packed.maxH}`);
    tower2.packed.maxH = before + 37; // simulate updateAnimatedSector moving the escape height
    tower2.packed.version++; // simulate the version bump updateAnimatedSector performs
    ok('uStruct maxH slot is STALE right after the packed mutation (not yet refreshed)',
      atlas.uStruct[tower2.structSeq * 8 + 7] === before);
    planFrameUpdate(world, atlas, makeFrameUpdatePlan());
    ok('planFrameUpdate refreshes uStruct[i*8+7] to the new packed.maxH',
      atlas.uStruct[tower2.structSeq * 8 + 7] === before + 37, `${atlas.uStruct[tower2.structSeq * 8 + 7]} vs ${before + 37}`);
    tower2.packed.maxH = before; // restore
    tower2.packed.version++; // and re-bump so the restore is also picked up (leave versions/atlas consistent for the next block)
    planFrameUpdate(world, atlas, makeFrameUpdatePlan());
  }
}

// --- rebuildNeeded fires when a new structure is placed ----------------------
world.placeStructure(assets.level('test_room'), { x: -50, y: -50, z: 0 }, 'wt_probe');
const plan2 = planFrameUpdate(world, atlas, makeFrameUpdatePlan());
ok('placing a structure bumps renderVersion -> rebuildNeeded', plan2.rebuildNeeded === true);

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
