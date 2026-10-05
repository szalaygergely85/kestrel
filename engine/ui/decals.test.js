// DECAL-01 (architecture.md 37.6): derived wall text and shared overlay raster.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeFrame } from '../core/transform.js';
import { World } from '../world/World.js';
import { serialize, deserialize } from '../world/serialize.js';
import { createOverlay, applyOverlay, OVL_MAX_TEXTS } from './overlay.js';
import { bindDecals, drawDecals } from '../index.js';
import { CellBuffer } from '../render/CellBuffer.js';

let checks = 0;
const ok = (v, label) => { assert.ok(v, label); checks++; };
const eq = (a, b) => { assert.deepEqual(a, b); checks++; };
const throws = (fn, re) => { assert.throws(fn, re); checks++; };
const glyphs = text => Uint8Array.from(text, c => c.charCodeAt(0) - 32);
const SHADING = { fgMin: 0.32, fgGamma: 0.8, fgMaxGain: 1.2, tint: 0.5 };
function fixture(props, yawSteps = 0) {
  const level = { name: 'fixture', rows: Array(6).fill('......'), start: { x: 1.5, y: 1.5 },
    legend: { '.': { floorH: 0, ceilH: 'sky', solid: false, wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky' } }, props };
  const def = { name: 'fixtureWorld', terrain: null, sun: {}, structures: [{ id: 'room', level: 'fixture',
    origin: { x: 10, y: 20, z: 3 }, yawSteps }], entities: [] };
  const assets = { level: () => level, world: () => def, has: () => true, contentVersion: null, palette: { shading: SHADING } };
  return { level, assets, load: () => {
    if (!yawSteps) return World.load(def, assets);
    // M1 rejects rotated level placements. Supply the future rotated frame
    // through a test-only placement adapter to exercise World.load's collector.
    const place = World.prototype.placeStructure;
    World.prototype.placeStructure = function(levelDef, origin, id) {
      const s = place.call(this, levelDef, origin, id, 0);
      s.frame = makeFrame(origin.x, origin.y, origin.z, yawSteps); s.yawSteps = yawSteps;
      return s;
    };
    try { return World.load(def, assets); } finally { World.prototype.placeStructure = place; }
  } };
}
const p = (facing = 0) => ({ id: 'scrawl', model: 'decal:AB CD', facing,
  wall: facing === 0 || facing === 180 ? { x0: 1, x1: 3, y: 2, z0: 0.5, z1: 1 }
    : { y0: 1, y1: 3, x: 2, z0: 0.5, z1: 1 } });
const expected = [
  [13, 22, 11, 22, 0, -1], [12, 23, 12, 21, 1, 0],
  [11, 22, 13, 22, 0, 1], [12, 21, 12, 23, -1, 0],
];
for (let i = 0; i < 4; i++) for (const turn of [0, 1]) {
  const w = fixture([p(i * 90)], turn).load(), d = w.decals[0];
  const e = expected[i], xy = turn ? [10 - (e[1] - 20), 20 + (e[0] - 10), 10 - (e[3] - 20), 20 + (e[2] - 10), -e[5], e[4]] : e;
  eq([d.ax, d.ay, d.bx, d.by, d.nx + 0, d.ny + 0], xy.map(v => v + 0));
  eq([d.z0, d.z1, d.style, d.id], [3.5, 4, 'decal', 'room.scrawl']);
  eq(d.glyphs, glyphs('AB CD'));
  ok(!w.get('room.scrawl') && w._contentIds.size === 0, 'decal does not spawn or enter content-entity ids');
}
const invalid = [
  { facing: 45 }, { facing: undefined }, { facing: 90 },
  { model: 'decal:' }, { model: 'decal:A'.padEnd(71, 'A') }, { model: 'decal:ä' }, { model: 'decal:A\nB' },
  { wall: { x0: 2, x1: 1, y: 2, z0: 0, z1: 1 } },
  { wall: { x0: 1, x1: 2, y: 2, z0: 1, z1: 1 } },
  { wall: { x0: NaN, x1: 2, y: 2, z0: 0, z1: 1 } },
  { wall: { x0: 1, x1: Infinity, y: 2, z0: 0, z1: 1 } },
  { wall: { x0: 1, x1: 2, y: 2, z0: 0, z1: 1, x: 2 } }, { style: 3 },
];
for (const patch of invalid) throws(() => fixture([{ ...p(), ...patch }]).load(), /room\.scrawl/);
{
  const f = fixture([p()]), w = f.load(), saved = serialize(w), restored = deserialize(saved, f.assets);
  eq(restored.decals, w.decals);
  const hash = state => createHash('sha256').update(JSON.stringify(state)).digest('hex');
  eq(hash(serialize(restored)), hash(saved));
  ok(!Object.hasOwn(saved, 'decals') && saved.entities.length === 0, 'derived decals absent from save');
  w.decals[0].glyphs[0] = 90;
  eq(hash(serialize(w)), hash(saved));
  eq(fixture([]).load().decals, []);
}

const W = 400, H = 150;
const styles = { decal: { glyphs: '-|\\/', fg: [100, 160, 200] }, decalFaint: { glyphs: '~|\\/', fg: [60, 80, 100] } };
function overlay() { const ov = createOverlay(W, H); ov.renderer = 'mesh'; ov.setStyles(styles); return ov; }
const decal = { id: 'test', glyphs: glyphs('AB CD'), ax: 1, ay: 0, bx: -1, by: 0, z0: 0.5, z1: 1.5, nx: 0, ny: -1, style: 'decal' };
const world = { assets: { palette: { shading: SHADING } } };
const cam = { x: 0, y: -1.5, z: 1, yawDeg: 180, pitchDeg: 0 };
const lights = value => ({ ambient: [value, value, value], count: 0, sun: { on: false } });
const cells = ov => Array.from(ov.touched.slice(0, ov.stats.cells)).sort((a, b) => a - b);
const letters = ov => cells(ov).map(i => String.fromCharCode(ov.ovl[i * 4 + 3] + 32)).join('');
{
  const ov = overlay(), binding = bindDecals(ov, [decal]);
  eq(drawDecals(binding, ov, cam, lights(1), world), 1); ov.flush(cam);
  eq(letters(ov), 'ABCD'); eq(ov.stats.cells, 4); // Space shows through.
  const nearCells = cells(ov);
  ok(nearCells.every(i => Math.abs(ov.ovlZ[i] - 1.48) < 1e-6), 'normal lift applied to reference depth');
  const cb = new CellBuffer(W, H), depths = new Float32Array(W * H).fill(Infinity);
  depths[nearCells[0]] = 0.5; // Foreground box hides this part of the scrawl.
  applyOverlay(ov, cb, depths);
  eq(cb.glyphIdx[nearCells[0]], 0);
  eq(cb.glyphIdx[nearCells[1]], 'B'.charCodeAt(0) - 32);
  const distant = { ...cam, y: -15 };
  ov.clear(); drawDecals(binding, ov, distant, lights(1), world); ov.flush(distant);
  // This short fixture is still legible at 15 m; a real 14-letter scrawl is not.
  const small = { ...decal, glyphs: glyphs('KEEP THE LIGHT'), ax: 0.2, bx: -0.2 };
  const smallBind = bindDecals(ov, [small]);
  ov.clear(); drawDecals(smallBind, ov, distant, lights(1), world); ov.flush(distant);
  ok(ov.stats.cells > 0 && /^[\-|\\/]+$/.test(letters(ov)), '15m uses slope scratch glyphs');
  const back = { ...cam, y: 1.5 };
  ov.clear(); eq(drawDecals(binding, ov, back, lights(1), world), 0); ov.flush(back); eq(ov.stats.cells, 0);
  ov.clear(); eq(drawDecals(binding, ov, { ...cam, y: -21 }, lights(1), world), 0);
  eq(drawDecals(null, ov, cam, null, world), 0);
  eq(drawDecals(bindDecals(ov, []), ov, cam, null, null), 0);
}
{
  const ov = overlay(); const ids = ov.setTexts([glyphs('AB')]);
  ov.clear(); ov.text(ids[0], 1, 0, -1, 0, 1, 0.5, ov.styleId('decal')); ov.flush(cam);
  const i = ov.touched[0] * 4; eq(Array.from(ov.ovl.slice(i, i + 3)), [50, 80, 100]);
  ov.clear(); ov.text(0, 1, 0, -1, 0, 1, 2, ov.styleId('decal')); ov.flush(cam);
  eq(Array.from(ov.ovl.slice(i, i + 3)), [200, 255, 255]);
  ov.clear(); ov.segment(1, 0, 1, -1, 0, 1, ov.styleId('decal')); ov.flush(cam);
  const j = ov.touched[0] * 4; eq(Array.from(ov.ovl.slice(j, j + 3)), [100, 160, 200]);
  eq(ov.setTexts([glyphs('XY')])[0], 0);
  ov.clear(); ov.text(0, 1, 0, -1, 0, 1, 1, ov.styleId('decal')); ov.flush(cam); eq(letters(ov), 'XY');
  throws(() => ov.setTexts(Array.from({ length: OVL_MAX_TEXTS + 1 }, () => glyphs('A'))), /too many texts/);
  throws(() => ov.setTexts([new Uint8Array(65)]), /invalid glyphs/);
  throws(() => ov.setTexts([new Uint8Array([95])]), /invalid glyphs/);
  throws(() => bindDecals(ov, [{ ...decal, style: 'missing' }]), /unknown style/);
  // A tilted baseline projects two glyph centres into the same cell at
  // different depths. The earlier letter wins within this text op.
  ov.setTexts([glyphs('ABCDEFGHIJKLMNOP')]);
  ov.clear(); ov.text(0, 0.045, 0, -0.045, 0.4, 1, 1, ov.styleId('decal')); ov.flush(cam);
  const collisionGlyphs = cells(ov).map(i => ov.ovl[i * 4 + 3]);
  ok(collisionGlyphs[0] === 'A'.charCodeAt(0) - 32 && collisionGlyphs.length < 16, 'colliding letters preserve first glyph');
  const source = glyphs('AB'); ov.setTexts([source]); source[0] = 90;
  ov.clear(); ov.text(0, 1, 0, -1, 0, 1, 1, ov.styleId('decal')); ov.flush(cam); eq(letters(ov), 'AB');
  const max = Array.from({ length: 64 }, () => new Uint8Array(64).fill(33)); eq(ov.setTexts(max).length, 64);
}
{
  const ov = overlay(), binding = bindDecals(ov, [decal]);
  ov.clear(); drawDecals(binding, ov, cam, lights(0), world); ov.flush(cam);
  const dark = ov.ovl[ov.touched[0] * 4]; eq(dark, 32);
  ov.clear(); drawDecals(binding, ov, cam, lights(1), world); ov.flush(cam);
  eq(ov.ovl[ov.touched[0] * 4], 100); ok(dark < 100, 'light reveals the scrawl');
  const coloured = { ambient: [1, 0.5, 0.2], count: 0, sun: { on: false } };
  ov.clear(); drawDecals(binding, ov, cam, coloured, world); ov.flush(cam);
  // Independent scalar luminance of the shadeSprite rgb multiplier.
  const expectedMul = 0.2126 + 0.7152 * 0.75 + 0.0722 * 0.6;
  eq(ov.ovl[ov.touched[0] * 4], Math.round(100 * expectedMul));
}
{
  const ov = overlay(), binding = bindDecals(ov, Array.from({ length: 32 }, (_, i) => ({ ...decal, z0: 0.5 + i * 0.01, z1: 1.5 + i * 0.01 })));
  const L = lights(0.5), step = () => { ov.clear(); drawDecals(binding, ov, cam, L, world); ov.flush(cam); };
  for (let i = 0; i < 1000; i++) step();
  const refs = [ov.ovl, ov.ovlZ, ov.touched, binding.texts, binding.styles, binding.light];
  if (global.gc) {
    let growth = Infinity;
    for (let trial = 0; trial < 3; trial++) {
      global.gc(); const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 1000; i++) step();
      global.gc(); growth = Math.min(growth, process.memoryUsage().heapUsed - before);
    }
    ok(growth < 65536, '1000 frames allocate no retained frame scratch');
    console.log(`[DECAL-01] heap growth ${growth} bytes`);
  }
  eq(refs, [ov.ovl, ov.ovlZ, ov.touched, binding.texts, binding.styles, binding.light]);
  const start = performance.now(); for (let i = 0; i < 1000; i++) step();
  console.log(`[DECAL-01] 32 decals draw+flush ${(performance.now() - start) / 1000} ms/frame (0.05ms budget, warn-only Node)`);
}
console.log(`${checks} checks PASS`);
