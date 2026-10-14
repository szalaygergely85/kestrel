// node tools/gait-b.test.mjs - ANIM-B-01b (D-101 option B): wolf + fox + (B-01c) deer + goat knee rigs (architecture.md 38.67 item 2).
// Box split per leg (upper keeps its name, lower `<name>2`), voxel identity vs the pre-split boxes, legRig passes validateVoxelModel
// (fore pair then hind pair), meshOnly, legRig.gaits == tools/gait-configs.mjs, legacy clips leave the lower parts unkeyed.
// Planted feet (<= 12 mm) + shipped == generated are covered by tools/gait-a.test.mjs (it walks every CONFIGS entry).
import assert from 'node:assert';
import { validateVoxelModel } from '../engine/index.js';
import { CONFIGS, defOf } from './gait-configs.mjs';
import { plantedError } from './gait-lib.mjs';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`ok - ${name}`); } catch (e) { console.error(`not ok - ${name}\n${e.stack}`); process.exitCode = 1; } };
// pre-split leg boxes (voxel_wolf.js v1 / voxel_wildlife.js v1.58)
const OLD = {
  wolf: { body: [0, 8, 8, 10, 27, 22], head: [0, 0, 11, 10, 8, 22], jaw: [2, 0, 9, 8, 8, 11], legFL: [2, 9, 0, 4, 15, 8], legFR: [6, 9, 0, 8, 15, 8], legBL: [2, 21, 0, 4, 27, 8], legBR: [6, 21, 0, 8, 27, 8], tail: [2, 27, 4, 8, 33, 15] },
  deer: { body: [2, 12, 11, 10, 30, 21], head: [4, 0, 12, 8, 12, 33], ears: [1, 6, 25, 11, 10, 30], tail: [4, 30, 14, 8, 32, 19], legFL: [2, 12, 0, 6, 17, 11], legFR: [6, 12, 0, 10, 17, 11], legBL: [2, 23, 0, 6, 29, 11], legBR: [6, 23, 0, 10, 29, 11] },
  goat: { body: [2, 10, 10, 14, 32, 23], head: [3, 0, 14, 13, 14, 31], jaw: [5, 0, 6, 11, 7, 14], ears: [0, 4, 19, 16, 8, 24], legFL: [2, 11, 0, 7, 16, 10], legFR: [9, 11, 0, 14, 16, 10], legBL: [2, 24, 0, 7, 30, 10], legBR: [9, 24, 0, 14, 30, 10] },
  fox: { body: [1, 11, 9, 9, 27, 17], head: [1, 0, 10, 9, 11, 17], ears: [1, 4, 17, 9, 8, 21], tail: [1, 27, 2, 9, 44, 17], legFL: [1, 9, 0, 5, 16, 9], legFR: [5, 9, 0, 9, 16, 9], legBL: [1, 20, 0, 5, 28, 9], legBR: [5, 20, 0, 9, 28, 9] }
};
const owners = (def, boxes) => {            // first box claims a voxel (engine rule): "x,y,z" -> [part, char]
  const m = new Map();
  for (const [n, b] of boxes) for (let z = b[2]; z < b[5]; z++) for (let y = b[1]; y < b[4]; y++) {
    const row = def.layers[z][y]; for (let x = b[0]; x < b[3]; x++) { const k = x + ',' + y + ',' + z; if (!m.has(k) && row[x] !== '.') m.set(k, [n, row[x]]); }
  }
  return m;
};
for (const key of ['wolf', 'fox', 'deer', 'goat']) {
  const def = defOf({ model: key }), names = Object.keys(def.parts), cfgs = CONFIGS.filter((c) => c.model === key);
  test(`${key}: validates incl. legRig (fore pair then hind pair)`, () => {
    const v = validateVoxelModel(def, {}); assert.deepStrictEqual(v.errors, []);
    assert.deepStrictEqual(def.legRig.legs.map((l) => l.upper), ['legFL', 'legFR', 'legBL', 'legBR']);
  });
  test(`${key}: 12 parts, meshOnly, first 8 unchanged, lower = <upper>2 appended with parent = upper`, () => {
    assert.strictEqual(names.length, 12); assert.strictEqual(def.meshOnly, true);
    assert.deepStrictEqual(names.slice(0, 8), Object.keys(OLD[key]));   // the first 8 keep names + order
    for (const u of ['legFL', 'legFR', 'legBL', 'legBR']) { assert.strictEqual(def.parts[u + '2'].parent, u); assert.ok(names.indexOf(u + '2') >= 8); }
  });
  test(`${key}: voxel identity (same cells + materials; owners only split upper / lower of the same leg)`, () => {
    const o = owners(def, Object.entries(OLD[key])), n = owners(def, names.map((x) => [x, def.parts[x].box]));
    assert.strictEqual(o.size, n.size);
    for (const [k, [p, ch]] of o) { const w = n.get(k); assert.ok(w && w[1] === ch && (w[0] === p || w[0] === p + '2'), k); }
  });
  test(`${key}: legRig.gaits (tunedMps, duty, phase, liftM) == tools/gait-configs.mjs; hind legs bend back`, () => {
    for (const c of cfgs) {
      const g = def.legRig.gaits[c.clip], ph = ['FL', 'FR', 'HL', 'HR'].map((k) => ({ lateral: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, diagonal: { HL: 0.5, FL: 0, HR: 0, FR: 0.5 }, gallop: { FL: 0, FR: 0.1, HL: 0.5, HR: 0.6 } })[c.gait][k]);
      assert.ok(g, c.clip); assert.strictEqual(g.tunedMps, c.G.v); assert.strictEqual(g.duty, c.G.beta); assert.deepStrictEqual(g.phase, ph); assert.strictEqual(g.liftM, c.G.liftM);
    }
    assert.deepStrictEqual(def.legRig.legs.map((l) => l.bend), ['front', 'front', 'back', 'back']);
  });
  test(`${key}: other clips leave the lower parts unkeyed (rigid = posed as before)`, () => {
    const gen = new Set(cfgs.map((c) => c.clip));
    for (const [cn, c] of Object.entries(def.animations)) if (!gen.has(cn) && !(key === 'wolf' && cn === 'charge') && !(key === 'deer' && cn === 'gallop'))
      for (const f of c.frames) for (const u of ['legFL2', 'legFR2', 'legBL2', 'legBR2']) assert.ok(!f[u] || (f[u].rot || [0, 0, 0]).every((v) => v === 0), cn + ' ' + u);
  });
}

// ---- ANIM-B-01d: biped knee rigs (heron: ankle bends back; goblin: forward knee). 10 parts, split boxes, planted feet <= 12 mm ----
const OLDB = {
  heron: { legL: [1, 18, 0, 6, 27, 21], legR: [7, 18, 0, 12, 27, 21] },
  goblin: { legL: [7, 7, 0, 11, 14, 9], legR: [11, 7, 0, 15, 14, 9] }
};
for (const key of ['heron', 'goblin', 'goblinTorch']) {
  const def = defOf({ model: key }), names = Object.keys(def.parts), cfgs = CONFIGS.filter((c) => c.model === key), base = key === 'goblinTorch' ? 'goblin' : key;
  test(`${key}: validates incl. legRig (2 legs, ${base === 'heron' ? 'bend back' : 'bend front'}); 10 parts, legL2 / legR2 appended with parent = upper`, () => {
    assert.deepStrictEqual(validateVoxelModel(def, {}).errors, []);
    assert.strictEqual(names.length, 10); assert.deepStrictEqual(names.slice(8), ['legL2', 'legR2']);
    assert.deepStrictEqual(def.legRig.legs.map((l) => l.bend), base === 'heron' ? ['back', 'back'] : ['front', 'front']);
    assert.strictEqual(def.parts.legL2.parent, 'legL'); assert.strictEqual(def.parts.legR2.parent, 'legR');
  });
  test(`${key}: voxel identity (leg cells only change owner upper -> lower; the boxes tile the old leg box)`, () => {
    const o = owners(def, Object.entries(OLDB[base]));
    const n = new Map(), seq = names.filter((x) => x === 'legL' || x === 'legR' || x === 'legL2' || x === 'legR2');
    for (const [k, v] of owners(def, seq.map((x) => [x, def.parts[x].box]))) n.set(k, v);
    assert.strictEqual(o.size, n.size);
    for (const [k, [p, ch]] of o) { const w = n.get(k); assert.ok(w && w[1] === ch && (w[0] === p || w[0] === p + '2'), k); }
  });
  test(`${key}: legRig.gaits == tools/gait-configs.mjs (biped phase 0 / 0.5)`, () => {
    for (const c of key === 'goblinTorch' ? CONFIGS.filter((x) => x.model === 'goblin') : cfgs) {
      const g = def.legRig.gaits[c.clip];
      assert.ok(g, c.clip); assert.strictEqual(g.tunedMps, c.G.v); assert.strictEqual(g.duty, c.G.beta); assert.deepStrictEqual(g.phase, [0, 0.5]); assert.strictEqual(g.liftM, c.G.liftM);
    }
  });
}
for (const cfg of CONFIGS.filter((c) => c.gait === 'biped' && c.model !== 'goblinTorch')) {
  const def = defOf(cfg);
  test(`${cfg.id}: planted feet <= 12 mm (keys + interpolated) on the shipped clip`, () => {
    const k = plantedError(def, cfg, def.animations[cfg.clip], 1) * 1000, i = plantedError(def, cfg, def.animations[cfg.clip], 4) * 1000;
    console.log(`   ${cfg.id}: keys ${k.toFixed(2)} mm, interpolated ${i.toFixed(2)} mm, tuned ${cfg.G.v} m/s`);
    assert.ok(k <= 12 && i <= 12, `${k} / ${i}`);
  });
}
test('goblinTorch: walk + carryTorch legs/body = the generated goblin.walk; run legs = goblin.run', () => {
  const t = defOf({ model: 'goblinTorch' }), g = defOf({ model: 'goblin' });
  const legs = ['body', 'legL', 'legL2', 'legR', 'legR2'];
  for (const [a, b] of [['walk', 'walk'], ['carryTorch', 'walk'], ['run', 'run']]) for (const m of [t, g]) {
    if (m === t && a === 'walk') { /* torch walk == carryTorch */ }
    const ref = g.animations[b].frames;
    m.animations[a === 'walk' && m === t ? 'carryTorch' : a].frames.forEach((f, i) => legs.forEach((n) => assert.deepStrictEqual(f[n].rot, ref[i][n].rot, `${a} ${n} ${i}`)));
  }
});
console.log(`${passed} passed`);
