// node tools/voxel-beast-clips.test.mjs - OB-153 beast combat clips (design/models/voxel_beast_clips.js) on the deer, fox,
// goat and tortoise (snapping turtle) models: appended AFTER the existing clips (names, order, data, pack indices
// untouched), every frame keys every part, timing (die = beastView DIE_DURATIONS, windup / attack = kinds.json), standing
// keys keep >= 3 feet on the ground and nothing under it (full 3D FK over the voxels), die ends on the side (turtle:
// slumped, never upside down), dead = the last die key, sink ends under the ground, engine validate + pack.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_wildlife.js';
import '../design/models/voxel_eat_clips.js';
import '../design/models/voxel_goat.js';
import '../design/models/voxel_tortoise.js';
import { validateVoxelModel, packVoxelModel } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass;
const IDS = ['deer', 'fox', 'goat', 'tortoise'];
const KIND = { deer: 'red_deer', fox: 'fox', goat: 'mountain_goat', tortoise: 'snapping_turtle' };
const ROOT = { deer: 'body', fox: 'body', goat: 'body', tortoise: 'shell' };
const NEW = ['hurt', 'flinch', 'windup', 'attack', 'die', 'dead', 'sink', 'charge'];
const BEFORE = {};
for (const id of IDS) { const an = A.models[id].voxel.animations; BEFORE[id] = { keys: Object.keys(an), json: Object.keys(an).map((k) => JSON.stringify(an[k])) }; }
await import('../design/models/voxel_beast_clips.js');
const KINDS = JSON.parse(readFileSync(new URL('../content/beasts/kinds.json', import.meta.url), 'utf8'));
const D2R = Math.PI / 180;

function rotM(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R), cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx], [-sy, cy * sx, cy * cx]];
}
const app = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const mul = (X, Y) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => X[i][0] * Y[0][j] + X[i][1] * Y[1][j] + X[i][2] * Y[2][j]));
function owned(D) {           // part -> [[x, y, z], ...] (first box wins, part insertion order)
  const names = Object.keys(D.parts), out = {}; names.forEach((k) => { out[k] = []; });
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    const own = names.find((k) => { const b = D.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    if (own) out[own].push([x, y, z]);
  } }));
  return out;
}
const OWN = {}; for (const id of IDS) OWN[id] = owned(A.models[id].voxel);
// lowest world z (voxels over the anchor plane) of a part's voxel corners, full 3D FK through the parent chain
function minZ(id, part, f) {
  const D = A.models[id].voxel, T = {};
  for (const n of Object.keys(D.parts)) {
    const p = D.parts[n], st = f[n] || {}, r = st.rot || [0, 0, 0], t = st.pos || [0, 0, 0], c = p.pivot, R = rotM(r[0], r[1], r[2]), Rc = app(R, c);
    const lo = [c[0] - Rc[0] + t[0], c[1] - Rc[1] + t[1], c[2] - Rc[2] + t[2]];
    if (p.parent) { const Q = T[p.parent], o = app(Q.R, lo); T[n] = { R: mul(Q.R, R), o: [o[0] + Q.o[0], o[1] + Q.o[1], o[2] + Q.o[2]] }; }
    else T[n] = { R, o: lo };
  }
  const m = T[part], g = D.anchor[2] || 0; let z = 1e9;
  for (const v of OWN[id][part]) for (let c = 0; c < 8; c++) {
    const w = m.R[2][0] * (v[0] + (c & 1)) + m.R[2][1] * (v[1] + ((c >> 1) & 1)) + m.R[2][2] * (v[2] + ((c >> 2) & 1)) + m.o[2];
    if (w < z) z = w;
  }
  return z - g;
}
const sum = (a) => a.reduce((s, v) => s + v, 0);
const LEGS = ['legFL', 'legFR', 'legBL', 'legBR'];

test('ASSETS.beastClipsFx: all four models extended; existing clips untouched (names, order, data)', () => {
  assert.deepStrictEqual(A.beastClipsFx.models.slice().sort(), IDS.slice().sort());
  for (const id of IDS) {
    const an = A.models[id].voxel.animations, keys = Object.keys(an), B = BEFORE[id];
    assert.deepStrictEqual(keys.slice(0, B.keys.length), B.keys, id + ' old clip order');
    B.keys.forEach((k, i) => assert.strictEqual(JSON.stringify(an[k]), B.json[i], id + ' ' + k + ' unchanged'));
    for (const k of NEW) assert.ok(an[k], id + ' has ' + k);
  }
});

test('new clips: every frame keys every part, |rot| <= 180, timing = beastView / kinds.json, hit event', () => {
  for (const id of IDS) {
    const D = A.models[id].voxel, an = D.animations, parts = Object.keys(D.parts).sort(), K = KINDS[KIND[id]].attacks[0];
    for (const k of NEW) {
      const c = an[k];
      assert.strictEqual(c.frames.length, c.durations.length, id + ' ' + k + ' durations');
      c.frames.forEach((f, i) => {
        assert.deepStrictEqual(Object.keys(f).sort(), parts, id + ' ' + k + ' key ' + i);
        for (const p of parts) for (const v of f[p].rot) assert.ok(Math.abs(v) <= 180, id + ' ' + k + ' ' + p + ' rot');
      });
    }
    assert.deepStrictEqual(an.die.durations, [90, 110, 120, 80, 100], id + ' die = beastView DIE_DURATIONS');
    assert.deepStrictEqual(an.sink.durations, [500, 100], id + ' sink = SINK_DURATIONS');
    assert.ok(!an.die.loop && !an.sink.loop && an.dead.loop && an.charge.loop, id + ' loop flags');
    assert.deepStrictEqual(an.dead.frames[0], an.die.frames[4], id + ' dead = last die key (ends still)');
    assert.deepStrictEqual(an.sink.frames[0], an.die.frames[4], id + ' sink starts at the corpse');
    assert.ok(Math.abs(sum(an.hurt.durations) - 300) <= 50, id + ' hurt ~0.3 s');
    assert.strictEqual(sum(an.windup.durations), Math.round(K.windupSec * 1000), id + ' windup = kinds.json windupSec');
    assert.strictEqual(sum(an.attack.durations), Math.round(K.activeSec * 1000), id + ' attack = kinds.json activeSec');
    assert.strictEqual(an.attack.events.hit, A.beastClipsFx.hitKey[id], id + ' hit key');
    assert.strictEqual(sum(an.attack.durations.slice(0, an.attack.events.hit)), A.beastClipsFx.hitMs[id], id + ' hitMs');
  }
});

test('owner rule 0.2: standing clips on all fours (>= 3 feet down, root never upright), nothing under the ground', () => {
  for (const id of IDS) {
    const D = A.models[id].voxel, an = D.animations, rootP = ROOT[id];
    for (const k of ['hurt', 'flinch', 'windup', 'attack', 'die']) an[k].frames.forEach((f, i) => {
      if (k === 'die' && i > 0) return;                                  // the fall: checked below
      assert.ok(Math.abs(f[rootP].rot[0]) <= 12 && Math.abs(f[rootP].rot[1]) <= 3, id + ' ' + k + ' key ' + i + ' root pitch / roll');
      let down = 0;
      for (const l of LEGS) {
        const sole = D.parts[l + '2'] ? l + '2' : l, m = minZ(id, sole, f);
        assert.ok(m >= -0.35, id + ' ' + k + ' key ' + i + ' ' + l + ' sinks ' + m.toFixed(2));
        if (m < 0.35) down++;
      }
      assert.ok(down >= 3, id + ' ' + k + ' key ' + i + ': ' + down + ' feet down');
      for (const p of Object.keys(D.parts)) if (LEGS.indexOf(p) < 0 && LEGS.indexOf(p.slice(0, -1)) < 0) {
        const m = minZ(id, p, f); assert.ok(m >= -0.3, id + ' ' + k + ' key ' + i + ' ' + p + ' under ground ' + m.toFixed(2));
      }
    });
  }
});

test('die: falls onto its side (quadrupeds) / slumps (turtle), lying body on the ground, no part under it; sink goes under', () => {
  for (const id of IDS) {
    const D = A.models[id].voxel, an = D.animations, rootP = ROOT[id], last = an.die.frames[4];
    if (id === 'tortoise') assert.ok(Math.abs(last[rootP].rot[1]) <= 12 && Math.abs(last[rootP].rot[0]) <= 5, 'turtle slumps, never upside down');
    else assert.ok(Math.abs(last[rootP].rot[1]) >= 80 && Math.abs(last[rootP].rot[1]) <= 100, id + ' lies on its side');
    for (const i of [3, 4]) {
      const f = an.die.frames[i];
      for (const p of Object.keys(D.parts)) { const m = minZ(id, p, f); assert.ok(m >= -0.1, id + ' die key ' + i + ' ' + p + ' under ground ' + m.toFixed(2)); }
      assert.ok(minZ(id, rootP, f) <= 2.5, id + ' die key ' + i + ' body down (' + minZ(id, rootP, f).toFixed(2) + ')');
    }
    const s = an.sink.frames[1];
    for (const p of Object.keys(D.parts)) assert.ok(minZ(id, p, s) < 0, id + ' sink: ' + p + ' under');
  }
});

test('engine: validateVoxelModel clean; packs with the old clip indices unchanged + the new ones', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  for (const id of IDS) {
    const D = A.models[id].voxel, r = validateVoxelModel(D, { materialKeys: keys });
    assert.deepStrictEqual(r.errors, [], id + ' errors');
    const ids = [];
    const PM = packVoxelModel(D, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
    BEFORE[id].keys.forEach((k, i) => assert.strictEqual(PM.clipIndex[k], i, id + ' ' + k + ' index'));
    for (const k of NEW) assert.ok(PM.clipIndex[k] >= BEFORE[id].keys.length, id + ' packed ' + k);
  }
});

console.log(`${passed} passed`);
