// node tools/voxel-skeleton.test.mjs - OB-191 skeleton warrior + archer (design/models/voxel_skeleton.js): valid materials
// (existing palette entries only), rig (parents earlier, boxes <= 48, every part owns voxels, model self-check clean),
// size (~1.8 m), the clip set + timing (die / sink = beastView, windup / attack and draw / shoot = kinds.json, rise 1.2 s
// from the pile to idle key 0), ground contact by full 3D FK (standing keys: a sole on the ground, torso / skull above it;
// pile keys: every bone resting on the ground, nothing under it; sink fully under), the archer's nocked arrow (hidden
// outside draw keys 1-4, nock on the string at the drawing hand) and LOD0 tris <= 3500 (goblin / bear beast budget).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/models/voxel_skeleton.js';
import { validateVoxelModel, packVoxelModel, buildVoxelMesh } from '../engine/index.js';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };

const A = globalThis.ASSETS, P = A.palette, DP = A.detailPass, FX = A.skeletonFx;
const IDS = ['skeleton', 'skeletonArcher'];
const KINDS = JSON.parse(readFileSync(new URL('../content/beasts/kinds.json', import.meta.url), 'utf8'));
const D2R = Math.PI / 180;
const BASE = ['body', 'chest', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'legL2', 'legR2'];
const DIE = [90, 110, 120, 80, 100], SINK = [500, 100];
const sum = (a) => a.reduce((s, v) => s + v, 0);

function rotM(rx, ry, rz) {
  const cx = Math.cos(rx * D2R), sx = Math.sin(rx * D2R), cy = Math.cos(ry * D2R), sy = Math.sin(ry * D2R), cz = Math.cos(rz * D2R), sz = Math.sin(rz * D2R);
  return [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx], [-sy, cy * sx, cy * cx]];
}
const app = (M, v) => [0, 1, 2].map((i) => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
const mul = (X, Y) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => X[i][0] * Y[0][j] + X[i][1] * Y[1][j] + X[i][2] * Y[2][j]));
function owned(D) {           // part -> [[x, y, z], ...] (first box wins, part insertion order)
  const names = Object.keys(D.parts), out = { _none: [] }; names.forEach((k) => { out[k] = []; });
  D.layers.forEach((l, z) => l.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] !== '.') {
    const own = names.find((k) => { const b = D.parts[k].box; return x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]; });
    out[own || '_none'].push([x, y, z]);
  } }));
  return out;
}
const OWN = {}; for (const id of IDS) OWN[id] = owned(A.models[id].voxel);
function xforms(D, f) {       // full 3D FK through the parent chain (engine rule: pivot c, pos t in the parent frame)
  const T = {};
  for (const n of Object.keys(D.parts)) {
    const p = D.parts[n], st = f[n] || {}, r = st.rot || [0, 0, 0], t = st.pos || [0, 0, 0], c = p.pivot, R = rotM(r[0], r[1], r[2]), Rc = app(R, c);
    const lo = [c[0] - Rc[0] + t[0], c[1] - Rc[1] + t[1], c[2] - Rc[2] + t[2]];
    if (p.parent) { const Q = T[p.parent], o = app(Q.R, lo); T[n] = { R: mul(Q.R, R), o: [o[0] + Q.o[0], o[1] + Q.o[1], o[2] + Q.o[2]] }; }
    else T[n] = { R, o: lo };
  }
  return T;
}
const pt = (T, n, p) => { const v = app(T[n].R, p); return [v[0] + T[n].o[0], v[1] + T[n].o[1], v[2] + T[n].o[2]]; };
function zRange(id, part, T) {   // [min, max] world z (voxels over the anchor plane) of the part's voxel corners
  let lo = 1e9, hi = -1e9;
  const m = T[part], g = A.models[id].voxel.anchor[2] || 0;
  for (const v of OWN[id][part]) for (let c = 0; c < 8; c++) {
    const w = m.R[2][0] * (v[0] + (c & 1)) + m.R[2][1] * (v[1] + ((c >> 1) & 1)) + m.R[2][2] * (v[2] + ((c >> 2) & 1)) + m.o[2];
    if (w < lo) lo = w; if (w > hi) hi = w;
  }
  return [lo - g, hi - g];
}
const solid = (id) => Object.keys(A.models[id].voxel.parts).filter((n) => n !== 'arrow');

test('ASSETS.models.skeleton / skeletonArcher + ASSETS.skeletonFx exist; model self-check clean', () => {
  for (const id of IDS) assert.ok(A.models[id] && A.models[id].voxel, id);
  assert.ok(FX); assert.deepStrictEqual(FX.models, { warrior: 'skeleton', archer: 'skeletonArcher' });
  assert.deepStrictEqual(FX.selfCheck, [], 'selfCheck: ' + FX.selfCheck.slice(0, 5).join(' ; '));
});

test('validateVoxelModel: no errors / warnings against palette + detail-pass materials; every voxel owned', () => {
  const keys = Object.keys(P.materials).filter((k) => DP.materials[k]);
  for (const id of IDS) {
    const D = A.models[id].voxel, r = validateVoxelModel(D, { materialKeys: keys });
    assert.deepStrictEqual(r.errors, [], id + ' errors');
    assert.deepStrictEqual(r.warnings, [], id + ' warnings');
    assert.strictEqual(D.meshOnly, true);
    assert.strictEqual(OWN[id]._none.length, 0, id + ' unowned voxels');
    for (const m of Object.values(D.mats)) assert.ok(P.materials[m] && DP.materials[m], id + ' material ' + m + ' exists in palette + detail-pass');
  }
});

test('rig: part order, parents earlier, boxes sx+sy+sz <= 48, every part owns voxels; archer = + bow + arrow (root)', () => {
  assert.deepStrictEqual(Object.keys(A.models.skeleton.voxel.parts), BASE);
  assert.deepStrictEqual(Object.keys(A.models.skeletonArcher.voxel.parts), [...BASE, 'strU', 'strD', 'limbU', 'limbD', 'arrow']);
  for (const id of IDS) {
    const D = A.models[id].voxel, names = Object.keys(D.parts);
    for (const [k, p] of Object.entries(D.parts)) {
      if (p.parent) assert.ok(names.indexOf(p.parent) < names.indexOf(k), id + ' ' + k + ' parent order');
      const b = p.box; assert.ok(b[3] - b[0] + b[4] - b[1] + b[5] - b[2] <= 48, id + ' ' + k + ' box size');
      assert.ok(OWN[id][k].length > 0, id + ' ' + k + ' owns voxels');
    }
  }
  assert.strictEqual(A.models.skeletonArcher.voxel.parts.arrow.parent, undefined);
});

test('size: ~1.8 m to the crown, hips ~0.85 m, shoulders ~1.45 m', () => {
  for (const id of IDS) {
    const D = A.models[id].voxel, top = Math.max(...OWN[id].head.map((v) => v[2])) + 1;
    console.log(`  ${id}: crown ${(top * D.cellM).toFixed(2)} m, hip ${(D.parts.legL.pivot[2] * D.cellM).toFixed(2)} m, shoulder ${(D.parts.armL.pivot[2] * D.cellM).toFixed(2)} m`);
    assert.ok(top * D.cellM >= 1.7 && top * D.cellM <= 1.9, 'height');
    assert.ok(Math.abs(D.parts.legL.pivot[2] * D.cellM - 0.85) <= 0.07, 'hip height');
    assert.ok(Math.abs(D.parts.armL.pivot[2] * D.cellM - 1.45) <= 0.07, 'shoulder height');
  }
});

test('clips: set, every frame keys every part (rot + pos), |rot| <= 180, timing = beastView / kinds.json, rise / die / sink chain', () => {
  const NEED = ['idle', 'walk', 'run', 'alert', 'windup', 'attack', 'hurt', 'flinch', 'die', 'dead', 'sink', 'rise', 'charge'];
  for (const id of IDS) {
    const D = A.models[id].voxel, an = D.animations, parts = Object.keys(D.parts).sort();
    const need = id === 'skeletonArcher' ? [...NEED, 'draw', 'shoot'] : NEED;
    for (const k of need) assert.ok(an[k], id + ' has ' + k);
    for (const [k, c] of Object.entries(an)) {
      assert.strictEqual(c.frames.length, c.durations.length, id + ' ' + k + ' durations');
      for (const d of c.durations) assert.strictEqual(d % 10, 0, id + ' ' + k + ' duration ' + d);
      c.frames.forEach((f, i) => {
        assert.deepStrictEqual(Object.keys(f).sort(), parts, id + ' ' + k + ' key ' + i);
        for (const p of parts) {
          assert.ok(Array.isArray(f[p].rot) && Array.isArray(f[p].pos), id + ' ' + k + ' ' + p + ' rot + pos');
          for (const v of f[p].rot) assert.ok(Math.abs(v) <= 180, id + ' ' + k + ' ' + p + ' rot');
        }
      });
    }
    assert.deepStrictEqual(an.die.durations, DIE, id + ' die = DIE_DURATIONS');
    assert.deepStrictEqual(an.sink.durations, SINK, id + ' sink = SINK_DURATIONS');
    assert.ok(an.idle.loop && an.walk.loop && an.run.loop && an.dead.loop && !an.die.loop && !an.sink.loop && !an.rise.loop && !an.alert.loop, id + ' loop flags');
    assert.deepStrictEqual(an.dead.frames[0], an.die.frames[4], id + ' dead = last die key');
    assert.deepStrictEqual(an.sink.frames[0], an.die.frames[4], id + ' sink starts at the pile');
    assert.deepStrictEqual(an.rise.frames[0], an.dead.frames[0], id + ' rise starts at the pile');
    assert.deepStrictEqual(an.rise.frames[an.rise.frames.length - 1], an.idle.frames[0], id + ' rise ends at idle key 0');
    assert.ok(Math.abs(sum(an.rise.durations) - 1200) <= 100, id + ' rise ~1.2 s');
    assert.strictEqual(an.charge, an.run, id + ' charge alias = run');
  }
  const W = A.models.skeleton.voxel.animations, KW = KINDS.skeleton_warrior.attacks[0];
  assert.strictEqual(sum(W.windup.durations), Math.round(KW.windupSec * 1000), 'warrior windup = windupSec');
  assert.strictEqual(sum(W.attack.durations), Math.round(KW.activeSec * 1000), 'warrior attack = activeSec');
  assert.strictEqual(W.attack.events.hit, FX.attack.hitKey);
  assert.strictEqual(sum(W.attack.durations.slice(0, W.attack.events.hit)), FX.attack.hitMs, 'hitMs');
  const R = A.models.skeletonArcher.voxel.animations, KA = KINDS.skeleton_archer.attacks[0];
  assert.strictEqual(sum(R.draw.durations), Math.round(KA.windupSec * 1000), 'archer draw = windupSec');
  assert.strictEqual(sum(R.shoot.durations), Math.round(KA.activeSec * 1000), 'archer shoot = activeSec');
  assert.ok(R.windup === R.draw && R.attack === R.shoot, 'archer aliases windup = draw, attack = shoot');
  assert.strictEqual(R.shoot.events.release, 0);
});

test('ground: standing keys have a sole on the ground and torso / skull above it; walk / run never sink', () => {
  for (const id of IDS) {
    const an = A.models[id].voxel.animations;
    const standing = ['idle', 'walk', 'run', 'alert', 'windup', 'attack', 'hurt', 'flinch', ...(id === 'skeletonArcher' ? ['draw', 'shoot'] : [])];
    for (const k of standing) an[k].frames.forEach((f, i) => {
      const T = xforms(A.models[id].voxel, f), sole = Math.min(zRange(id, 'legL2', T)[0], zRange(id, 'legR2', T)[0]);
      assert.ok(sole >= -0.05 && sole <= 1.5, id + ' ' + k + ' key ' + i + ' sole ' + sole.toFixed(2));
      for (const p of ['body', 'chest', 'head']) assert.ok(zRange(id, p, T)[0] >= 4, id + ' ' + k + ' key ' + i + ' ' + p + ' low');
    });
    // rise keys 2.. and die keys 0..2 never put a bone under the ground
    for (const [k, from, to] of [['rise', 2, 6], ['die', 0, 2]]) for (let i = from; i <= to; i++) {
      const T = xforms(A.models[id].voxel, an[k].frames[i]);
      for (const p of solid(id)) assert.ok(zRange(id, p, T)[0] >= -0.3, id + ' ' + k + ' key ' + i + ' ' + p + ' under the ground');
    }
  }
});

test('death: the bone pile rests every bone on the ground (low, nothing under it); sink ends fully under', () => {
  for (const id of IDS) {
    const an = A.models[id].voxel.animations;
    for (const f of [an.die.frames[3], an.die.frames[4], an.rise.frames[1]]) {
      const T = xforms(A.models[id].voxel, f);
      for (const p of solid(id)) {
        const [lo, hi] = zRange(id, p, T);
        assert.ok(lo >= -0.05, id + ' pile: ' + p + ' under the ground ' + lo.toFixed(2));
        const gear = /^(fore|str|limb)/.test(p);   // forearms carry the shield / sword / bow (laid flat, but long)
        assert.ok(hi <= (gear ? 26 : 16), id + ' pile: ' + p + ' sticks up ' + hi.toFixed(2));
      }
      assert.ok(zRange(id, 'body', T)[0] <= 0.05, id + ' pelvis on the ground');
    }
    const T = xforms(A.models[id].voxel, an.sink.frames[1]);
    for (const p of solid(id)) assert.ok(zRange(id, p, T)[1] < 0, id + ' sink: ' + p + ' under');
  }
});

test('archer: arrow hidden except draw keys 1-4; there the nock sits on the drawn string at the right hand', () => {
  const D = A.models.skeletonArcher.voxel, an = D.animations;
  for (const [k, c] of Object.entries(an)) c.frames.forEach((f, i) => {
    const shown = k === 'draw' && i >= 1 || k === 'windup' && i >= 1;
    if (!shown) assert.ok(f.arrow.pos[2] <= -100, 'arrow hidden in ' + k + ' key ' + i);
  });
  for (let i = 1; i <= 4; i++) {
    const f = an.draw.frames[i], T = xforms(D, f);
    assert.ok(f.arrow.pos[2] > -100, 'arrow shown in draw key ' + i);
    const nock = pt(T, 'arrow', D.parts.arrow.pivot), sU = pt(T, 'strU', [5.5, 15, 16.5]), sD = pt(T, 'strD', [5.5, 15, 16.5]);
    const hand = pt(T, 'foreR', D.mounts.handR.at);
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(dist(sU, sD) <= 0.6, 'draw key ' + i + ': string halves meet (' + dist(sU, sD).toFixed(2) + ')');
    assert.ok(dist(nock, sU) <= 0.6, 'draw key ' + i + ': nock on the string (' + dist(nock, sU).toFixed(2) + ')');
    assert.ok(dist(hand, nock) <= 3.5, 'draw key ' + i + ': right hand at the nock (' + dist(hand, nock).toFixed(2) + ')');
    const tU = pt(T, 'strU', D.parts.strU.pivot), lU = pt(T, 'limbU', D.parts.strU.pivot);
    assert.ok(dist(tU, lU) <= 0.05, 'draw key ' + i + ': string rides on the upper limb tip');
  }
  const full = an.draw.frames[4];
  assert.ok(Math.abs(full.limbU.rot[0]) > 10 && Math.abs(full.limbD.rot[0]) > 10, 'full draw bends both limbs');
});

test('engine mesher: LOD0 tris <= 3500 (goblin / bear beast budget); every clip packs', () => {
  for (const id of IDS) {
    const D = A.models[id].voxel, ids = [];
    const PM = packVoxelModel(D, (k) => { let i = ids.indexOf(k); if (i < 0) { ids.push(k); i = ids.length - 1; } return i + 1; });
    const tris = buildVoxelMesh(PM, { id, partNames: Object.keys(D.parts) }).triCount;
    console.log(`  LOD0 ${id} ${tris} tris`);
    assert.ok(tris <= 3500, id + ' tris ' + tris + ' > 3500');
    for (const k of Object.keys(D.animations)) assert.ok(PM.clipIndex[k] !== undefined, id + ' packed clip ' + k);
  }
});

console.log(`${passed} passed`);
