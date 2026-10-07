// engine/render/MaskAtlas.test.js - ALPHA-01b (docs/architecture.md 37.17 items 2, 10). Run: node engine/render/MaskAtlas.test.js
import { MaskAtlas, buildMaskAtlas, cutoffByte } from './MaskAtlas.js';
import { AssetRegistry } from '../core/assets.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const T = MaskAtlas.texel;

// texel() table (repeat wrap, clamp to w-1, f32 rounding)
ok('texel 0 -> 0', T(0, 4) === 0);
ok('texel 0.25 -> 1', T(0.25, 4) === 1);
ok('texel 0.999 -> 3', T(0.999, 4) === 3);
ok('texel u=1.0 wraps to 0', T(1.0, 4) === 0);
ok('texel u=-0.25 wraps to 3', T(-0.25, 4) === 3);
ok('texel u=2.5 wraps to 2', T(2.5, 4) === 2);
ok('texel u=-1e-9 (fround -> -1e-9 f32) clamps into w-1', T(-1e-9, 4) === 3);
ok('texel clamp: tu*w rounding to w stays w-1', T(1 - 1e-8, 256) <= 255 && T(Math.fround(1 - 6e-8), 256) === 255);
{
  const f = 0.1 + 0.2; // f64 0.30000000000000004; fround -> 0.30000001192...
  ok('texel f32 rounding case (0.1+0.2, w 10) -> 3', T(f, 10) === 3 && Math.fround(f) !== f);
  // a value just under 0.3 in f64 that rounds UP to the f32 0.3 -> texel 3, not 2 (the exact twin rule is on the f32 value)
  const under = 0.3 - 1e-12;
  ok('texel uses the f32 value (0.3 - 1e-12, w 10) -> 3', T(under, 10) === 3, String(T(under, 10)));
}
ok('cutoffByte 0.2 -> 51, 0.5 -> 128', cutoffByte(0.2) === 51 && cutoffByte(0.5) === 128);

// packing
{
  const a = new MaskAtlas();
  const b4 = new Uint8Array(16).map((_, i) => i + 1);
  a.add('t/a', 4, 4, b4);
  a.add('t/b', 2, 2, new Uint8Array([9, 8, 7, 6]));
  ok('atlas rect a at 0,0; b right of it', JSON.stringify(a.rect('t/a')) === '{"x0":0,"y0":0,"w":4,"h":4}' && a.rect('t/b').x0 === 4 && a.rect('t/b').y0 === 0);
  ok('atlas H = tallest shelf member', a.H === 4 && a.data.length === a.W * 4);
  ok('sample reads a texel (u 0.3 v 0.6 -> col 1 row 2 -> 10)', a.sample(0, 0, 4, 4, 0.3, 0.6) === 10);
  ok('sample second mask (u .75 v .75 -> 6)', a.sample(4, 0, 2, 2, 0.75, 0.75) === 6);
  ok('version bumps per add', a.version === 2);
  let threw = false; try { a.add('t/a', 4, 4, b4); } catch (e) { threw = /duplicate/.test(e.message); }
  ok('duplicate id throws', threw);
}
{
  const small = new MaskAtlas({ maxW: 8, maxH: 8 });
  small.add('x/1', 8, 4, new Uint8Array(32));
  small.add('x/2', 8, 4, new Uint8Array(32));
  let threw = false; try { small.add('x/3', 4, 4, new Uint8Array(16)); } catch (e) { threw = /full/.test(e.message); }
  ok('a full atlas throws', threw);
}
// deterministic by sorted id, via AssetRegistry kind 'mask'
{
  const mk = (ids) => {
    const masks = {};
    for (const id of ids) masks[id] = { id, w: 2, h: 2, cutoffDefault: 0.5, data: new Uint8Array([id.length, 1, 2, 3]) };
    const reg = new AssetRegistry({ palette: { util: {} }, masks });
    return buildMaskAtlas(reg);
  };
  const a = mk(['q/zeta', 'q/alpha', 'q/mid']), b = mk(['q/mid', 'q/zeta', 'q/alpha']);
  ok('packing is deterministic (insertion order irrelevant)', Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0 && JSON.stringify([...a.rects]) === JSON.stringify([...b.rects]));
  ok('sorted: alpha first', a.rect('q/alpha').x0 === 0 && a.rect('q/mid').x0 === 2 && a.rect('q/zeta').x0 === 4);
  const reg = new AssetRegistry({ palette: { util: {} }, masks: { 'q/m': { id: 'q/m', w: 1, h: 1, data: new Uint8Array(1) } } });
  ok("registry kind 'mask': mask/has/keys", reg.mask('q/m').w === 1 && reg.has('mask', 'q/m') && reg.keys('mask').join() === 'q/m');
  let threw = false; try { reg.mask('nope'); } catch (e) { threw = /unknown mask/.test(e.message); }
  ok('unknown mask throws', threw);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
