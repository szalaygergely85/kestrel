// GL2-STRIDE-SAFETY: writeTexture rect.stride must not leak UNPACK_* state (fake gl, no real GL).
//   node engine/render/gpu/device/GpuDeviceGL2.stride.test.js
import { GpuDeviceGL2 } from './GpuDeviceGL2.js';
import { makeOk } from '../../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function makeGL(throwOnTex) {
  const calls = [];
  const consts = {};
  let n = 1;
  const gl = new Proxy({}, {
    get(_t, p) {
      if (typeof p !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(p)) { if (!(p in consts)) consts[p] = n++; return consts[p]; }
      return (...a) => { calls.push([p, ...a]); if (throwOnTex && p === 'texSubImage2D') throw new Error('boom'); };
    },
  });
  return { gl, calls };
}
function dev(gl) { const d = Object.create(GpuDeviceGL2.prototype); d.gl = gl; return d; }
const names = (c) => c.map((x) => x[0]);

for (const format of ['rgba8', 'r32f']) {
  const data = format === 'rgba8' ? new Uint8Array(64) : new Float32Array(64);
  const tex = { handle: {}, width: 8, height: 8, format };

  // (2) no stride -> no pixelStorei at all
  let { gl, calls } = makeGL();
  dev(gl).writeTexture(tex, data, { x: 1, y: 2, w: 3, h: 2 }, 5);
  ok(!names(calls).includes('pixelStorei'), `${format}: no stride -> no pixelStorei`);
  const t = calls.find((c) => c[0] === 'texSubImage2D');
  ok(t && t[3] === 1 && t[4] === 2 && t[5] === 3 && t[6] === 2 && t[10] === 5, `${format}: dataOffset (elements) + rect passed through`);
  ok(t && t[9] === data, `${format}: data view passed as is`);

  // (1)(4) stride -> ROW_LENGTH set then restored to 0, around the upload
  ({ gl, calls } = makeGL());
  dev(gl).writeTexture(tex, data, { x: 0, y: 0, w: 3, h: 2, stride: 8 }, 9);
  const ps = calls.filter((c) => c[0] === 'pixelStorei');
  const order = names(calls);
  ok(ps.length === 2 && ps[0][1] === gl.UNPACK_ROW_LENGTH && ps[0][2] === 8 && ps[1][2] === 0, `${format}: ROW_LENGTH set to stride then 0`);
  ok(order.indexOf('pixelStorei') < order.indexOf('texSubImage2D') && order.lastIndexOf('pixelStorei') > order.indexOf('texSubImage2D'), `${format}: set before, reset after upload`);
  ok(!ps.some((c) => c[1] === gl.UNPACK_ALIGNMENT || c[1] === gl.UNPACK_SKIP_PIXELS || c[1] === gl.UNPACK_SKIP_ROWS), `${format}: only ROW_LENGTH touched (4-byte texels -> default alignment 4 ok)`);
  ok(calls.find((c) => c[0] === 'texSubImage2D')[10] === 9, `${format}: srcOffset in elements`);

  // (1) restored even when texSubImage2D throws
  ({ gl, calls } = makeGL(true));
  let threw = false;
  try { dev(gl).writeTexture(tex, data, { x: 0, y: 0, w: 3, h: 2, stride: 8 }); } catch { threw = true; }
  const ps2 = calls.filter((c) => c[0] === 'pixelStorei');
  ok(threw && ps2.length === 2 && ps2[1][2] === 0, `${format}: ROW_LENGTH restored after throw`);
}

console.log(`GpuDeviceGL2.stride: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
