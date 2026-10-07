// WG-1c1: WGSL_MODULES list + summarizeCompilation + present WGSL string rules (38.5). node engine/render/gpu/wgsl/index.test.js
import assert from 'node:assert';
import { WGSL_MODULES, summarizeCompilation } from './index.js';
import { PRESENT_BLOCK, PRESENT_WGSL, PRESENT_TEXTURES } from './present.wgsl.js';

assert.ok(WGSL_MODULES.length >= 1 && WGSL_MODULES.every((m) => m.name && typeof m.code === 'string' && m.code.length > 0));
assert.strictEqual(new Set(WGSL_MODULES.map((m) => m.name)).size, WGSL_MODULES.length, 'unique module names');
assert.ok(WGSL_MODULES.some((m) => m.name === 'present'));

// summarizeCompilation
const s = summarizeCompilation('x', [{ type: 'warning', message: 'w' }, { type: 'error', message: 'bad', lineNum: 3, linePos: 7 }, { type: 'error', message: 'worse' }, { type: 'info', message: 'i' }]);
assert.deepStrictEqual(s, { name: 'x', errors: 2, warnings: 1, firstError: '3:7 bad' });
assert.deepStrictEqual(summarizeCompilation('y', []), { name: 'y', errors: 0, warnings: 0, firstError: null });
assert.strictEqual(summarizeCompilation('z', undefined).errors, 0);

// present WGSL string rules (38.5): no raw %, no round/dpdx/fwidth/frag_depth, entry points + bindings per 38.8a
for (const m of WGSL_MODULES) {
  assert.ok(!/[^%]%[^%]/.test(m.code.replace(/%%/g, '')) || m.name === 'common', `${m.name}: raw %`);
  assert.ok(!/\bround\s*\(|dpdx|dpdy|fwidth|frag_depth/.test(m.code), `${m.name}: forbidden builtin`);
}
assert.ok(/fn vs_main/.test(PRESENT_WGSL) && /fn fs_main/.test(PRESENT_WGSL));
assert.ok(/@group\(0\) @binding\(3\) var uAtlasSampler: sampler/.test(PRESENT_WGSL), 'sampler at binding textures.length + 0');
assert.strictEqual(PRESENT_TEXTURES.length, 3);
assert.deepStrictEqual(PRESENT_TEXTURES, ['float', 'float', 'filtered']);
assert.ok(/const GLYPH_COUNT: f32 = 95\.0;/.test(PRESENT_WGSL), 'constant interpolated from glyphAtlas');
assert.ok(!/1\.0 - /.test(PRESENT_WGSL.split('fn fs_main')[1].split('let atlasUv')[0]), 'no GL row flip');
assert.strictEqual(PRESENT_BLOCK.sizeBytes, 32);
assert.deepStrictEqual([PRESENT_BLOCK.field('grid').word, PRESENT_BLOCK.field('size').word, PRESENT_BLOCK.field('layer').word], [0, 2, 4]);
console.log('wgsl/index.test.js: all checks passed.');
