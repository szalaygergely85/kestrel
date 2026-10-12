// node tools/voxel-bear-black.test.mjs - BEAR-D1 black bear (design/models/voxel_bear_black.js): a recolour of Burl's
// bear v2 (design/models/voxel_bear.js). Same occupancy / parts / pivots / non-dialogue clips, valid materials, a much
// darker coat than Burl, tan muzzle, chest blaze present, beast clips listed as missing (not invented).
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_bear.js';
import '../design/models/voxel_bear_black.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const BURL = A.models.bear.voxel, DEF = A.models.bearBlack && A.models.bearBlack.voxel, FX = A.blackBearFx;

function matLum(k) {
  const m = P.materials[k], c = m && P.rgb[m.base];
  assert.ok(c, 'rgb for material ' + k);
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}
function coatLum(D) {      // mean base luminance over every voxel (whole-body value, what reads at 20 m)
  let s = 0, n = 0;
  D.layers.forEach((l) => l.forEach((r) => { for (const c of r) if (c !== '.') { s += matLum(D.mats[c]); n++; } }));
  return s / n;
}

test('ASSETS.models.bearBlack + ASSETS.blackBearFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'bearBlack'); });

test('validateVoxelModel: no errors / warnings against palette + detail-pass materials', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
});

test('same rig as Burl: size, cellM, anchor, parts (boxes, pivots, parents), voxel occupancy', () => {
  assert.deepStrictEqual(DEF.size, BURL.size); assert.strictEqual(DEF.cellM, BURL.cellM);
  assert.deepStrictEqual(DEF.anchor, BURL.anchor); assert.deepStrictEqual(DEF.parts, BURL.parts);
  assert.strictEqual(DEF.meshOnly, true);
  DEF.layers.forEach((l, z) => l.forEach((r, y) => {
    const b = BURL.layers[z][y];
    for (let x = 0; x < r.length; x++) assert.strictEqual(r[x] === '.', b[x] === '.', `occupancy ${x},${y},${z}`);
  }));
});

test('clips: idle / walk / turn identical to Burl; no dialogue clips; BEAR-D2 fight clips exist, none missing', () => {
  assert.deepStrictEqual(Object.keys(DEF.animations).sort(),
    ['charge', 'dead', 'die', 'flinch', 'hurt', 'idle', 'swipe', 'turn', 'walk', 'windup']);
  for (const k of ['idle', 'walk', 'turn']) assert.deepStrictEqual(DEF.animations[k], BURL.animations[k], k);
  for (const k of Object.values(FX.clipFor.state)) assert.ok(DEF.animations[k], 'clipFor ' + k);
  for (const k of ['hurt', 'flinch', 'die', 'dead']) assert.ok(DEF.animations[FX.clipFor[k]], 'clipFor.' + k);
  assert.deepStrictEqual(FX.missingClips, {});
});

// BEAR-D2: frame counts, durations, loop flags, timing contracts (telegraph >= 0.8 s, swipe hit key), all on four legs
const SPEC = { charge: [6, 400, true], windup: [7, 800, false], swipe: [6, 600, false], hurt: [2, 100, false],
               flinch: [3, 250, false], die: [5, 500, false], dead: [1, 1000, true] };
test('BEAR-D2 clips: frame counts, total ms, loop, durations multiples of 50, every part keyed', () => {
  const parts = Object.keys(DEF.parts).sort();
  for (const [k, [n, ms, loop]] of Object.entries(SPEC)) {
    const c = DEF.animations[k];
    assert.strictEqual(c.frames.length, n, k + ' frames'); assert.strictEqual(c.durations.length, n, k + ' durations');
    assert.strictEqual(c.durations.reduce((a, b) => a + b, 0), ms, k + ' total ms');
    assert.strictEqual(!!c.loop, loop, k + ' loop');
    for (const d of c.durations) assert.strictEqual(d % 50, 0, k + ' duration ' + d);
    c.frames.forEach((f, i) => assert.deepStrictEqual(Object.keys(f).sort(), parts, k + ' key ' + i));
  }
  assert.strictEqual(DEF.animations.hurt.interp, 'step');
  assert.ok(FX.telegraph.ms >= 800 && FX.telegraph.clip === 'windup');
  const sw = DEF.animations.swipe, hitStart = sw.durations.slice(0, FX.swipe.hitKey).reduce((a, b) => a + b, 0);
  assert.strictEqual(hitStart, FX.swipe.hitMs[0], 'swipe hit key start');
  assert.ok(sw.frames[FX.swipe.hitKey].armR.rot[0] <= -30, 'swipe: right paw raised + forward on the hit key');
});
test('owner rule 0.2: no rear-up (body pitch never nose-up past 8 deg), paws planted outside die / dead', () => {
  for (const k of ['charge', 'windup', 'swipe', 'hurt', 'flinch']) {
    for (const f of DEF.animations[k].frames) {
      assert.ok(f.body.rot[0] >= -8, k + ' body rx ' + f.body.rot[0]);
      for (const l of ['armL', 'armR', 'legL', 'legR']) assert.strictEqual(f[l].pos[1], -f.body.pos[1] || 0, k + ' ' + l + ' planted');
    }
  }
  const d = DEF.animations.dead.frames[0];
  assert.strictEqual(d.body.rot[1], 90, 'dead lies on its side');
  assert.ok(d.body.pos[2] <= 0 && d.body.pos[2] >= -3, 'dead body z ' + d.body.pos[2]);
});

test('coat: whole-body value <= 0.6 x Burl (0.8 on interim mats), tan muzzle lighter than the coat, chest blaze present', () => {
  const lb = coatLum(DEF), lr = coatLum(BURL);
  console.log(`  mean value black ${lb.toFixed(3)} vs Burl ${lr.toFixed(3)} (final fur_bear mats: ${FX.finalMats})`);
  // interim mats (fur_wolf_dark / hair_dark) cannot go fully black; the fur_bear_* keys (NEEDS MAIN) must reach 0.6
  assert.ok(lb <= (FX.finalMats ? 0.6 : 0.8) * lr, `black ${lb} vs brown ${lr}`);
  assert.ok(matLum(DEF.mats.M) > 2 * matLum(DEF.mats.B), 'muzzle reads against the coat');
  let blaze = 0; DEF.layers.forEach((l) => l.forEach((r) => { for (const c of r) if (c === 'P') blaze++; }));
  assert.ok(blaze >= 6 && blaze <= 20, 'blaze cells ' + blaze);
});

test('engine mesher: LOD0 <= 3500 tris (same budget as Burl; BEAR-D2 adds clips only, no voxels); clips pack', () => {
  const ids = [];
  const PM = packVoxelModel(DEF, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'bearBlack', partNames: Object.keys(DEF.parts) }).triCount;
  console.log(`  LOD0 ${tris} tris`);
  assert.ok(tris <= 3500, 'tris ' + tris);
  for (const k of Object.keys(SPEC)) assert.ok(PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
