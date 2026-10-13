// SWIM-04b: underwater look JS twin. Run: node engine/render/underwater.test.js  (node --expose-gc: also checks 0 alloc)
import { makeUnderState, underFogK, underShade, underwaterPass, updateUnderState } from './underwater.js';
import { fogShapeCtx } from './fogShape.js';
import { CellBuffer } from './CellBuffer.js';
import { GBuffer } from './GBuffer.js';
import { readFileSync } from 'node:fs';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

const U = makeUnderState(); U.on = 1; U.waterZ = -58;
const out = { fg: [0, 0, 0], bg: [0, 0, 0], glyph: 0 };
const G = (ch) => ch.charCodeAt(0) - 32;

// f ramp: s*(2-s), s = min(1, L/12)
ok('f(0) = 0', underFogK(0, U) === 0);
ok('f(6) = 0.75', near(underFogK(6, U), 0.75));
ok('f(12) = 1, f(100) = 1', underFogK(12, U) === 1 && underFogK(100, U) === 1);
ok('f off = 0', underFogK(6, { on: 0, fogM: 12 }) === 0);

// fog mix: L = 6 (f .75) toward tint*lightK / tint*0.35; floor cell, no caustic (causticK 0 via L>=10 below), nz low
const fg = [200, 100, 50], bg = [10, 20, 30];
U.causticK = 0;
underShade(fg, bg, G('#'), 6, -61, 0.3, 0.3, 1, 0, U, out);
ok('fog fg mix', near(out.fg[0], 200 + (20 * 0.8 - 200) * 0.75) && near(out.fg[1], 100 + (90 * 0.8 - 100) * 0.75));
ok('fog bg mix', near(out.bg[2], 30 + (120 * 0.35 - 30) * 0.75));
ok('no swap below swapAt? f=.75 >= .5 swaps', out.glyph !== G('#'));
underShade(fg, bg, G('#'), 2, -61, 0.3, 0.3, 1, 0, U, out); // f = 1/6*(11/6) = 0.3056 < 0.5
ok('glyph kept below swapAt', out.glyph === G('#'));
// swap boundary: s*(2-s) = .5 -> L = 12*(1 - sqrt(.5)) = 3.5147
underShade(fg, bg, G('#'), 3.52, -61, 0.3, 0.3, 1, 0, U, out); const a = out.glyph;
underShade(fg, bg, G('#'), 3.51, -61, 0.3, 0.3, 1, 0, U, out);
ok('swap flips at swapAt', a !== G('#') && out.glyph === G('#'));
ok('swap glyph from bubble ramp', ' .:o'.includes(String.fromCharCode(a + 32)));

// ceiling: sky (Pz = Infinity) and Pz >= waterZ - 0.02 use the ceiling colour + ~-= glyphs; deterministic
underShade(fg, bg, G('#'), 1e9, Infinity, 3, 4, 1, 1, U, out);
const c1 = out.glyph, c1fg = out.fg.slice();
ok('sky ceiling glyph in ~-=', '~-='.includes(String.fromCharCode(c1 + 32)));
underShade(fg, bg, G('#'), 1e9, Infinity, 3, 4, 1, 1, U, out);
ok('ceiling deterministic', out.glyph === c1 && out.fg[0] === c1fg[0]);
underShade(fg, bg, G('#'), 1, -58.01, 3, 4, 1, 1, U, out);
ok('Pz >= waterZ - 0.02 is ceiling', '~-='.includes(String.fromCharCode(out.glyph + 32)));
underShade(fg, bg, G('#'), 1, -58.1, 3, 4, 1, 1, U, out);
ok('Pz below -> not ceiling', out.glyph === G('#'));

// caustics: determinism, only nz > 0.6, L < 10, Pz < waterZ; ~ or *
U.causticK = 0.35;
let hits = 0, total = 0, det = true;
for (let i = 0; i < 400; i++) {
  const px = i * 0.7 + 0.1;
  underShade(fg, bg, G('#'), 2, -61, px, 1, 1, 3, U, out); const g1 = out.glyph, r1 = out.fg[0];
  underShade(fg, bg, G('#'), 2, -61, px, 1, 1, 3, U, out);
  if (out.glyph !== g1 || out.fg[0] !== r1) det = false;
  total++; if (g1 === G('*') || g1 === G('~')) hits++;
}
ok('caustic deterministic', det);
ok('caustic rate ~ causticK', hits / total > 0.25 && hits / total < 0.45, hits / total);
let wrong = 0;
for (let i = 0; i < 200; i++) {
  underShade(fg, bg, G('#'), 2, -61, i * 0.7 + 0.1, 1, 0.3, 3, U, out); if (out.glyph !== G('#')) wrong++; // steep
  underShade(fg, bg, G('#'), 11, -61, i * 0.7 + 0.1, 1, 1, 3, U, out); if (out.glyph === G('*')) wrong++; // far
}
ok('no caustics on steep / far cells', wrong === 0, wrong);
ok('caustic glyph changes with time', (() => { let d = 0; for (let t = 0; t < 20; t++) { underShade(fg, bg, G('#'), 2, -61, 5.1, 1, 1, t / 3, U, out); if (out.glyph !== G('#')) d++; } return d > 0 && d < 20; })());

// off = exact copy
const Uoff = makeUnderState(); // on 0
underShade(fg, bg, G('#'), 5, -61, 1, 1, 1, 0, Uoff, out);
ok('off: copy', out.fg[0] === 200 && out.bg[2] === 30 && out.glyph === G('#'));

// pass: on = 0 leaves the cell buffer byte-identical; on = 1 changes it
{
  const C = 8, R = 6, rt = new CellBuffer(C, R), gb = new GBuffer(C, R), depth = new Float32Array(C * R).fill(5);
  for (let i = 0; i < C * R; i++) { rt.glyphIdx[i] = G('#'); rt.fg[i * 4] = 200; rt.bg[i * 4 + 2] = 30; gb.kind[i] = 4; }
  gb.kind[0] = 0;
  Object.assign(fogShapeCtx, { mode: 0, terms: { cols: C, dirX: 1, dirY: 0, planeX: 0, planeY: 0.66, horizonRow: R / 2, planeDistY: 4 } });
  const snap = () => Buffer.concat([Buffer.from(rt.glyphIdx), Buffer.from(rt.fg), Buffer.from(rt.bg)]);
  const before = snap();
  underwaterPass(rt, gb, depth, 0, 0, -56.4, 0, Uoff);
  ok('pass off: byte-identical', before.equals(snap()));
  underwaterPass(rt, gb, depth, 0, 0, -56.4, 0, U);
  ok('pass on: changes cells', !before.equals(snap()));
  if (globalThis.gc) {
    for (let i = 0; i < 50; i++) underwaterPass(rt, gb, depth, 0, 0, -56.4, i, U);
    gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) underwaterPass(rt, gb, depth, 0, 0, -56.4, i * 0.1, U);
    gc(); const grew = process.memoryUsage().heapUsed - h0;
    ok('0 alloc (2000 passes)', grew < 200000, grew);
  }
}

// state hysteresis with a stub world
{
  const surf = { z: -58 }, world = { water: {}, waterAt(x, y, o) { o.surfaceZ = surf.z; o.depth = 5; o.look = null; return true; } };
  const S = makeUnderState();
  updateUnderState(world, 0, 0, -59, S); ok('eye below -> on', S.on === 1 && S.waterZ === -58);
  updateUnderState(world, 0, 0, -58.02, S); ok('inside band stays on', S.on === 1);
  updateUnderState(world, 0, 0, -57.9, S); ok('above +0.05 -> off', S.on === 0);
  updateUnderState(world, 0, 0, -58.02, S); ok('inside band stays off', S.on === 0);
  world.waterAt = (x, y, o) => { o.surfaceZ = -58; o.depth = 0.2; o.look = null; return true; };
  updateUnderState(world, 0, 0, -58.5, S); ok('depth < 0.3 -> off', S.on === 0);
  world.waterAt = () => false; S.on = 1; updateUnderState(world, 0, 0, -59, S); ok('no water -> off', S.on === 0);
}

// SWIM-04c: both twins skip the water surface composite when submerged (JS: compositor.js `submerged`; GPU: WaterCompositeU.underOn, written by passWater)
{
  const rd = (u) => readFileSync(new URL(u, import.meta.url), 'utf8');
  const comp = rd('./compositor.js'), wgsl = rd('./gpu/wgsl/waterComposite.wgsl.js'), pw = rd('./gpu/wg/passWater.js');
  ok('JS twin: submerged gates meshWater', /const submerged = .*updateUnderState/.test(comp) && /const meshWater = !submerged &&/.test(comp));
  ok('JS twin: submerged runs sky + under before edgePass (GPU order shade-under-edge)', comp.indexOf('underDone = true') > 0 && comp.indexOf('underDone = true') < comp.indexOf('if (fb.detailPass) edgePass('));
  ok('GPU twin: edge waterOn off when submerged', /E_WATER_ON\] = wOn && !\(U && U\.on\)/.test(rd('./gpu/wg/passShade.js')));
  ok('GPU twin: composite returns early on underOn', /wu\.underOn > 0\.5\) \{ return o; \}/.test(wgsl));
  ok('GPU twin: passWater writes underOn from fb.under.on', /cu\[C_UNDER_ON\] = fb && fb\.under && fb\.under\.on \? 1 : 0/.test(pw));
}

console.log(`underwater: ${pass} passed, ${fail} failed`);
if (fail) { for (const m of failures) console.log('FAIL ' + m); process.exit(1); }
