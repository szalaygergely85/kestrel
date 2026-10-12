// node tools/voxel-tortoise.test.mjs - SLATE-D1 Slate, the ancient tortoise (design/models/voxel_tortoise.js): shell,
// neck, head, jaw, 4 legs (8 = engine max). Valid materials, size (~1.2 m shell), the clip set + frame counts, talk jaw
// sync data, never upright, four feet planted (x/y) and ground-snapped (FK, pitch-only) in every key except the walk
// steps, head / jaw / neck never under the ground, withdraw / emerge chain, tris <= 3500 (bear beast budget).
import assert from 'node:assert';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_tortoise.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const DEF = A.models.tortoise && A.models.tortoise.voxel, FX = A.tortoiseFx;
const LIMBS = ['legFL', 'legFR', 'legBL', 'legBR'], D2R = Math.PI / 180;

function owned(D) {           // part -> [[x, y, z], ...] (first box wins, part insertion order)
  const names = Object.keys(D.parts), out = {}; names.forEach((k) => { out[k] = []; }); out._none = [];
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    const own = names.find((k) => { const b = D.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    out[own || '_none'].push([x, y, z]);
  } }));
  return out;
}
const OWN = DEF ? owned(DEF) : {};
// pitch-only FK (same convention as the model's ground solve): rotate (y, z) about the pivot by rx, then add pos
function xf(p, part, f) {
  const pv = DEF.parts[part].pivot, st = f[part] || {}, a = ((st.rot && st.rot[0]) || 0) * D2R, pos = st.pos || [0, 0, 0];
  const dy = p[0] - pv[1], dz = p[1] - pv[2];
  return [pv[1] + dy * Math.cos(a) - dz * Math.sin(a) + (pos[1] || 0), pv[2] + dy * Math.sin(a) + dz * Math.cos(a) + (pos[2] || 0)];
}
function minZ(part, f) {      // lowest world z (voxels) of a part's cells, through its parent chain
  let m = 1e9;
  for (const [, y, z] of OWN[part]) for (const cy of [0, 1]) for (const cz of [0, 1]) {
    let p = [y + cy, z + cz], k = part;
    while (k) { p = xf(p, k, f); k = DEF.parts[k].parent; }
    if (p[1] < m) m = p[1];
  }
  return m;
}

test('ASSETS.models.tortoise + ASSETS.tortoiseFx exist', () => { assert.ok(DEF); assert.ok(FX); assert.strictEqual(FX.model, 'tortoise'); assert.strictEqual(FX.character, 'Slate'); });

test('validateVoxelModel: no errors / warnings against palette + detail-pass materials; every voxel owned', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  const r = validateVoxelModel(DEF, { materialKeys: keys });
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(DEF.meshOnly, true);
  assert.strictEqual(OWN._none.length, 0, 'unowned voxels ' + JSON.stringify(OWN._none.slice(0, 5)));
});

test('rig: shell, neck, head, jaw, 4 legs (<= 8 parts), parents earlier, box sx+sy+sz <= 48, no empty part', () => {
  assert.deepStrictEqual(Object.keys(DEF.parts), ['shell', 'neck', 'head', 'jaw', ...LIMBS]);
  assert.ok(Object.keys(DEF.parts).length <= 8);
  const names = Object.keys(DEF.parts);
  for (const [k, p] of Object.entries(DEF.parts)) {
    if (p.parent) assert.ok(names.indexOf(p.parent) < names.indexOf(k), k + ' parent order');
    const b = p.box; assert.ok(b[3] - b[0] + b[4] - b[1] + b[5] - b[2] <= 48, k + ' box size');
    assert.ok(OWN[k].length > 0, k + ' owns voxels');
  }
  assert.strictEqual(DEF.parts.jaw.parent, 'head');
  assert.strictEqual(DEF.parts.head.parent, 'neck');
});

test('size: shell ~1.2 m long, dome 0.7-0.95 m high, plastron off the ground, moss + lichen on the shell', () => {
  const sh = OWN.shell.filter((v) => v[2] >= 6);
  const len = (Math.max(...sh.map((v) => v[1])) - Math.min(...sh.map((v) => v[1]))) * DEF.cellM;   // without the skirt row
  const top = (Math.max(...OWN.shell.map((v) => v[2])) + 1) * DEF.cellM;
  console.log(`  shell ${len.toFixed(2)} m long (+ skirt), dome top ${top.toFixed(2)} m, ${OWN.shell.length} shell voxels`);
  assert.ok(len >= 1.1 && len <= 1.3, 'shell length');
  assert.ok(top >= 0.7 && top <= 0.95, 'dome height');
  assert.ok(Math.min(...OWN.shell.map((v) => v[2])) >= 4, 'plastron off the ground');
  const chars = new Set(OWN.shell.map(([x, y, z]) => DEF.layers[z][y][x]));
  for (const c of ['V', 'L', 'g', 'A']) assert.ok(chars.has(c), 'shell has ' + DEF.mats[c]);
});

// clips: [frames, total ms, loop]
const SPEC = { idle: [8, 4800, true], walk: [4, 2000, true], withdraw: [4, 1200, false], emerge: [5, 1800, false],
               talk: [12, 2000, true], listen: [5, 3000, true], slowNod: [5, 1800, false], lookUp: [6, 3600, false] };
test('clips: exact set, frame counts, total ms, loop, durations multiples of 50, every part keyed, clipFor valid', () => {
  assert.deepStrictEqual(Object.keys(DEF.animations).sort(), Object.keys(SPEC).sort());
  const parts = Object.keys(DEF.parts).sort();
  for (const [k, [n, ms, loop]] of Object.entries(SPEC)) {
    const c = DEF.animations[k];
    assert.strictEqual(c.frames.length, n, k + ' frames'); assert.strictEqual(c.durations.length, n, k + ' durations');
    assert.strictEqual(c.durations.reduce((a, b) => a + b, 0), ms, k + ' total ms');
    assert.strictEqual(!!c.loop, loop, k + ' loop');
    for (const d of c.durations) assert.strictEqual(d % 50, 0, k + ' duration ' + d);
    c.frames.forEach((f, i) => assert.deepStrictEqual(Object.keys(f).sort(), parts, k + ' key ' + i));
  }
  for (const k of Object.values(FX.clipFor.state)) assert.ok(DEF.animations[k], 'clipFor ' + k);
  for (const [a, b] of Object.entries(FX.clipFor.once)) { assert.ok(!DEF.animations[a].loop, a + ' once'); assert.ok(DEF.animations[b], b); }
  for (const [k, ks] of Object.entries(FX.blink.keys)) for (const i of ks) assert.ok(DEF.animations[k].frames[i], 'blink key ' + k + ' ' + i);
});

test('talk: jaw sync data (jaw 0..jawMaxDeg, pause key closed at pauseAtMs, wide words >= 14 deg)', () => {
  const c = DEF.animations.talk, T = FX.talk;
  assert.strictEqual(T.jawPart, 'jaw');
  const jaws = c.frames.map((f) => f.jaw.rot[0]);
  assert.ok(Math.max(...jaws) >= 14 && Math.max(...jaws) <= T.jawMaxDeg, 'jaw peak ' + Math.max(...jaws));
  assert.strictEqual(jaws[T.pauseKey], 0, 'pause key closed');
  assert.strictEqual(c.durations.slice(0, T.pauseKey).reduce((a, b) => a + b, 0), T.pauseAtMs, 'pauseAtMs');
  for (const [k, cl] of Object.entries(DEF.animations)) for (const f of cl.frames) assert.ok(f.jaw.rot[0] >= 0 && f.jaw.rot[0] <= T.jawMaxDeg, k + ' jaw range');
});

const STEPPING = { walk: 2 };   // min feet on the ground per key (else all four)
test('owner rule 0.2: never upright, feet planted in x/y, ground-snapped, four down except walk steps', () => {
  for (const [k, c] of Object.entries(DEF.animations)) c.frames.forEach((f, i) => {
    assert.ok(f.shell.rot[0] >= -8, k + ' shell rx ' + f.shell.rot[0]);
    let down = 0;
    for (const l of LIMBS) {
      assert.strictEqual(f[l].pos[0], -f.shell.pos[0] || 0, k + ' ' + l + ' x planted');
      assert.strictEqual(f[l].pos[1], -f.shell.pos[1] || 0, k + ' ' + l + ' y planted');
      const m = minZ(l, f);
      assert.ok(m >= -0.03, k + ' key ' + i + ' ' + l + ' sinks ' + m.toFixed(2));
      assert.ok(m <= 1.5, k + ' key ' + i + ' ' + l + ' lift ' + m.toFixed(2) + ' (slow steps <= 1.5 cells)');
      if (m < 0.05) down++;
    }
    assert.ok(down >= (STEPPING[k] || 4), k + ' key ' + i + ': ' + down + ' feet down');
  });
});

test('rest pose exact; head, jaw + neck never under the ground; withdraw -> emerge chain', () => {
  const f = DEF.animations.idle.frames[0];
  for (const l of LIMBS) assert.deepStrictEqual(f[l].pos, [0, 0, 0], l);
  for (const [k, c] of Object.entries(DEF.animations)) c.frames.forEach((fr, i) => {
    for (const p of ['head', 'jaw', 'neck', 'shell']) { const m = minZ(p, fr); assert.ok(m >= -0.6, k + ' key ' + i + ' ' + p + ' under ground ' + m.toFixed(2)); }
  });
  const W = DEF.animations.withdraw, wl = W.frames[W.frames.length - 1];
  assert.ok(wl.neck.pos[1] >= 5, 'neck pulled into the shell ' + wl.neck.pos[1]);
  assert.ok(wl.shell.pos[2] <= -2.5, 'shell sinks ' + wl.shell.pos[2]);
  assert.deepStrictEqual(DEF.animations.emerge.frames[0], wl, 'emerge starts withdrawn');
  for (const k of ['emerge', 'slowNod', 'lookUp']) assert.deepStrictEqual(DEF.animations[k].frames[DEF.animations[k].frames.length - 1], f, k + ' ends at rest');
  assert.ok(Math.min(...DEF.animations.lookUp.frames.map((fr) => fr.neck.rot[0])) <= -20, 'lookUp raises the neck high');
});

test('engine mesher: LOD0 tris <= 3500 (bear beast budget); every clip packs', () => {
  const ids = [];
  const PM = packVoxelModel(DEF, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
  const tris = buildVoxelMesh(PM, { id: 'tortoise', partNames: Object.keys(DEF.parts) }).triCount;
  console.log(`  LOD0 tortoise ${tris} tris`);
  assert.ok(tris <= 3500, 'tris ' + tris + ' > 3500');
  for (const k of Object.keys(SPEC)) assert.ok(PM.clipIndex[k] !== undefined, 'packed clip ' + k);
});

console.log(`${passed} passed`);
