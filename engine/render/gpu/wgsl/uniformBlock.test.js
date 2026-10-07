// node engine/render/gpu/wgsl/uniformBlock.test.js
import { defineUniformBlock, createUniformRing, alignUp } from './uniformBlock.js';
import { makeOk } from '../../../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const throws = (f) => { try { f(); return false; } catch { return true; } };

// scalar packing + vec2 alignment
{
  const b = defineUniformBlock('A', [{ name: 'a', type: 'f32' }, { name: 'b', type: 'vec2' }, { name: 'c', type: 'f32' }]);
  ok('f32 at 0', b.field('a').offset === 0);
  ok('vec2 aligned to 8', b.field('b').offset === 8);
  ok('f32 after vec2 at 16', b.field('c').offset === 16);
  ok('size rounded to 32', b.sizeBytes === 32 && b.sizeWords === 8, String(b.sizeBytes));
}
// vec3 padding: align 16, size 12, next f32 packs at +12; next vec3 skips
{
  const b = defineUniformBlock('B', [{ name: 'p', type: 'f32' }, { name: 'v', type: 'vec3' }, { name: 's', type: 'f32' }, { name: 'w', type: 'vec3' }, { name: 'z', type: 'vec4' }]);
  ok('vec3 after f32 at 16', b.field('v').offset === 16);
  ok('f32 packs after vec3 at 28', b.field('s').offset === 28);
  ok('next vec3 at 32', b.field('w').offset === 32);
  ok('vec4 after vec3 at 48 (vec3 ends 44)', b.field('z').offset === 48);
  ok('vec3 word count 3', b.field('v').words === 3);
  ok('size 64', b.sizeBytes === 64);
}
// mat4 + arrays
{
  const b = defineUniformBlock('C', [{ name: 'k', type: 'f32' }, { name: 'm', type: 'mat4' }, { name: 'ms', type: 'mat4', count: 3 }, { name: 'v4', type: 'vec4', count: 5 }, { name: 'tail', type: 'u32' }]);
  ok('mat4 at 16', b.field('m').offset === 16);
  ok('mat4[3] at 80, 48 words', b.field('ms').offset === 80 && b.field('ms').words === 48);
  ok('vec4[5] at 272', b.field('v4').offset === 272 && b.field('v4').word === 68);
  ok('tail at 352', b.field('tail').offset === 352);
  ok('size 368', b.sizeBytes === 368, String(b.sizeBytes));
}
// WGSL text
{
  const b = defineUniformBlock('Cell', [{ name: 'view', type: 'mat4' }, { name: 'lights', type: 'vec4', count: 8 }, { name: 'n', type: 'i32' }, { name: 'pos', type: 'vec3' }, { name: 'uv', type: 'vec2' }]);
  ok('wgsl struct text', b.wgsl === 'struct Cell {\n  view: mat4x4f,\n  lights: array<vec4f, 8>,\n  n: i32,\n  pos: vec3f,\n  uv: vec2f,\n};', b.wgsl);
}
// errors
ok('array of f32 rejected', throws(() => defineUniformBlock('E', [{ name: 'a', type: 'f32', count: 4 }])));
ok('array of vec3 rejected', throws(() => defineUniformBlock('E', [{ name: 'a', type: 'vec3', count: 2 }])));
ok('duplicate field rejected', throws(() => defineUniformBlock('E', [{ name: 'a', type: 'f32' }, { name: 'a', type: 'f32' }])));
ok('unknown type rejected', throws(() => defineUniformBlock('E', [{ name: 'a', type: /** @type {any} */ ('vec5') }])));
// views
{
  const b = defineUniformBlock('V', [{ name: 'a', type: 'f32' }, { name: 'i', type: 'i32' }]);
  const buf = new ArrayBuffer(512);
  const v = b.createViews(buf, 256);
  v.f32[b.field('a').word] = 1.5; v.i32[b.field('i').word] = -7;
  ok('views alias the buffer at the offset', new Float32Array(buf)[64] === 1.5 && new Int32Array(buf)[65] === -7);
}
// ring
{
  ok('alignUp', alignUp(1, 256) === 256 && alignUp(256, 256) === 256 && alignUp(0, 256) === 0);
  const r = createUniformRing(3);
  const o0 = r.alloc(100), o1 = r.alloc(256), o2 = r.alloc(4);
  ok('slots 256-aligned', o0 === 0 && o1 === 256 && o2 === 512);
  ok('used bytes', r.usedBytes === 768 && r.usedSlots === 3);
  ok('overflow throws', throws(() => r.alloc(4)));
  ok('oversize block throws', throws(() => { r.reset(); r.alloc(257); }));
  r.reset();
  ok('reset empties', r.usedSlots === 0 && r.alloc(16) === 0);
  ok('word index', r.word(512) === 128);
  ok('ring views span buffer', r.f32.length === 3 * 64 && r.u32.buffer === r.buffer);
  ok('non-256 slot rejected', throws(() => createUniformRing(2, 100)));
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); } else console.log('ALL PASS');
