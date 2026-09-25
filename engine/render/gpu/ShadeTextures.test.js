// engine/render/gpu/ShadeTextures.test.js (US-029 tech notes item 10).
// Packs the REAL content pack (design/detail-pass.js) and unpacks every
// slot, deep-equalling it against `table.records[i].v2`/`table.sets`; also
// checks the pack-time asserts fire on an oversized synthetic set.
// Run: node engine/render/gpu/ShadeTextures.test.js
import { bindShading, bindLevel } from '../MaterialTable.js';
// US-027b: test_room moved to content/levels/test_room.level.json.
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import paletteModule from '../../../design/palette.js';
import detailPassModule from '../../../design/detail-pass.js';
import { loadLevel } from '../../world/Level.js';
import {
  packMaterialTable, unpackSetEntry, unpackMatF, unpackMatI,
  MAT_F_WIDTH, MAT_I_WIDTH, SET_I_WIDTH,
} from './ShadeTextures.js';

const palette = paletteModule.default || paletteModule;
const detailPass = detailPassModule.default || detailPassModule;
const { bundle } = await loadTestAssets();
const testRoomDef = bundle.levels.test_room;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
function closeEnough(a, b, eps = 1e-4) { return Math.abs(a - b) <= eps; }

const level = loadLevel(testRoomDef);
const table = bindShading(palette, detailPass, 16 / 9);
bindLevel(table, level);

ok('bindShading: allV2 present', typeof table.allV2 === 'boolean');

const packed = packMaterialTable(table);
ok('pack: dims.nMat matches records.length', packed.dims.nMat === table.records.length);
ok('pack: dims.nSet matches sets.length', packed.dims.nSet === table.sets.length);

// --- round-trip every set's glyph codes -----------------------------------
for (let s = 0; s < table.sets.length; s++) {
  const S = table.sets[s];
  const entries = [];
  if (!S.oriented) {
    for (let li = 0; li < S.levels; li++) entries.push({ codes: S.codes.subarray(li * S.maxAlt, li * S.maxAlt + S.altCount[li]), altCount: S.altCount[li] });
  } else {
    for (let li = 0; li < S.nDark; li++) entries.push({ codes: S.darkCodes.subarray(li * S.maxAlt, li * S.maxAlt + S.darkAltCount[li]), altCount: S.darkAltCount[li] });
    for (let c = 0; c < 4; c++) {
      const fam = S.fam[c];
      for (let li = 0; li < fam.altCount.length; li++) entries.push({ codes: fam.codes.subarray(li * S.maxAlt, li * S.maxAlt + fam.altCount[li]), altCount: fam.altCount[li] });
    }
  }
  for (let e = 0; e < entries.length; e++) {
    const got = unpackSetEntry(packed.setI, null, s, e, SET_I_WIDTH);
    const want = entries[e];
    ok(`set ${s} entry ${e}: altCount`, got.altCount === want.altCount, `${got.altCount} vs ${want.altCount}`);
    let codesOk = got.codes.length === want.codes.length;
    if (codesOk) for (let k = 0; k < want.codes.length; k++) if (got.codes[k] !== want.codes[k]) codesOk = false;
    ok(`set ${s} entry ${e}: codes`, codesOk, `[${Array.from(got.codes)}] vs [${Array.from(want.codes)}]`);
  }
  // thresholds
  for (let k = 0; k < S.levels; k++) {
    const t = packed.setF[s * 32 + k];
    ok(`set ${s} threshold ${k}`, closeEnough(t, S.thresholds[k]), `${t} vs ${S.thresholds[k]}`);
  }
}

// --- round-trip a representative material (tones + grid + face ids) ------
let checkedOne = false;
for (let id = 1; id < table.records.length; id++) {
  const rec = table.records[id];
  if (!rec || !rec.v2) continue;
  const v2 = rec.v2;
  const [albedo, bgK, detail, jitter] = unpackMatF(packed.matF, id, 0, MAT_F_WIDTH);
  ok(`mat ${id} (${rec.key}) albedo`, closeEnough(albedo, v2.albedo));
  ok(`mat ${id} (${rec.key}) detail`, closeEnough(detail, v2.detail));
  ok(`mat ${id} (${rec.key}) jitter`, closeEnough(jitter, v2.jitter));
  const [seed, flags, nTones] = unpackMatI(packed.matI, id, 0, MAT_I_WIDTH);
  ok(`mat ${id} (${rec.key}) seed`, seed === (v2.seed | 0));
  ok(`mat ${id} (${rec.key}) nTones`, nTones === v2.toneRGB.length / 3);
  ok(`mat ${id} (${rec.key}) HAS_GRID flag`, !!(flags & 1) === !!v2.grid);
  const [near] = unpackMatI(packed.matI, id, 1, MAT_I_WIDTH);
  ok(`mat ${id} (${rec.key}) face.near set id`, near === v2.face.near);
  checkedOne = true;
}
ok('at least one v2 material checked', checkedOne);

// --- pack-time asserts fire on an oversized synthetic set ------------------
function expectThrow(name, fn) {
  try { fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, true); }
}
expectThrow('assert: > MAX_TONES tones throws', () => {
  const badTable = {
    records: [null, { key: 'bad', v2: {
      albedo: 1, bgK: 0, detail: 1, jitter: 0, emissive: 0,
      toneRGB: new Float32Array(5 * 3), toneW: new Float32Array(5).fill(1), toneTotal: 5,
      grid: null, face: { near: 0, mid: 0, far: 0 }, bevel: null, band: null, overlay: null, speckle: null, lod: null,
      bevelGate: 0, bandGate: 0, overlayGate: 0, speckleGate: 0, seed: 1,
    } }],
    sets: [{ oriented: false, levels: 1, maxAlt: 1, thresholds: new Float64Array(1), codes: new Uint8Array(1), altCount: new Uint8Array([1]) }],
    faceK: new Float32Array(7), gainLUT: new Float32Array(256), fog: { fgRGB: [0, 0, 0], bgRGB: [0, 0, 0], start: 1, full: 2, stipple0: 0, stipple1: 1, sparse: 1, sparseCodes: new Uint8Array(2), sparseAlt: 1, hazeCodes: new Uint8Array(2), hazeAlt: 1 },
    ao: { r: 0, k: 0 }, shading: { cutoff: 0, lift: 0, gamma: 1, fgMin: 0, fgMaxGain: 1, tint: 0, overbright: 0, overbrightMax: 0, cellAspect: 1 },
    DP: null,
  };
  packMaterialTable(badTable);
});

console.log(`\n[ShadeTextures.test.js] ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('  FAIL: ' + f); process.exit(1); }
