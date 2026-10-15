// CANOPY-SHAFT-01b (38.76): splice checks for the shaft march (light pass) and colour lift (shade), plus a let-assign lint on the shaft strings
// and the full light/shade texts (WGSL `let` is immutable: assigning to one is a compile error that only WebGPU would show).
// Run: node engine/render/gpu/wgsl/lightShaft.wgsl.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIGHT_SHAFT_WGSL, SHADE_SHAFT_WGSL, SHAFT_SHIFT, SHAFT_MASK, shaftPack, shaftStepsFor } from '../../lightShaft.js';
import { CAO_SHIFT } from '../../contactAO.js';
import { LIGHT_BLOCK, LIGHT_WGSL, LIGHT_GI_WGSL } from './light.wgsl.js';
import { SHADE_BLOCK, SHADE_WGSL, SHADE_GI_WGSL } from './shade.wgsl.js';

// let-assign lint: within each fn body, a name declared with `let` must never be a bare assignment target (name = / name += ...).
function letAssign(src, label) {
  for (const m of src.matchAll(/\bfn\s+(\w+)\s*\([^)]*\)[^{]*\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) { const c = src[i++]; if (c === '{') depth++; else if (c === '}') depth--; }
    const body = src.slice(m.index + m[0].length, i).replace(/\/\/.*$/gm, '');
    const lets = new Set([...body.matchAll(/\blet\s+(\w+)/g)].map((x) => x[1]));
    const vars = new Set([...body.matchAll(/\bvar\s+(\w+)/g)].map((x) => x[1]));
    for (const n of lets) {
      if (vars.has(n)) continue; // shadowed by a var elsewhere in the fn: ambiguous, skip
      const decl = new RegExp(String.raw`\blet\s+${n}\b\s*(:\s*\w+)?\s*=`, 'g');
      const assign = new RegExp(String.raw`(^|[;{}\s])${n}\s*(=(?!=)|\+=|-=|\*=|/=|\+\+|--)`, 'm');
      assert.ok(!assign.test(body.replace(decl, '')), `${label}: fn ${m[1]} assigns to let ${n}`);
    }
  }
}
letAssign(LIGHT_SHAFT_WGSL, 'LIGHT_SHAFT_WGSL'); letAssign(SHADE_SHAFT_WGSL, 'SHADE_SHAFT_WGSL');
letAssign(LIGHT_WGSL, 'LIGHT_WGSL'); letAssign(LIGHT_GI_WGSL, 'LIGHT_GI_WGSL'); letAssign(SHADE_WGSL, 'SHADE_WGSL'); letAssign(SHADE_GI_WGSL, 'SHADE_GI_WGSL');

// uniform layout: appended at the very end of both blocks (no earlier word moves)
const ls = LIGHT_BLOCK.field('shaft'); assert.equal(ls.word + 4, LIGHT_BLOCK.sizeWords);
const ss = SHADE_BLOCK.field('shaftA'); assert.equal(ss.word, SHADE_BLOCK.field('fgT').word + 64);

// splices: march before the kind-0 early return, bits OR-ed into the final word next to (not over) cao / sunN / cloud
for (const src of [LIGHT_WGSL, LIGHT_GI_WGSL]) {
  assert.ok(src.includes('fn shaftLitQ') && src.includes('fn shaftBitsAt'));
  assert.ok(src.indexOf('shaftBitsAt(cell, kindU)') < src.indexOf('if (kindU == 0u)'), 'march runs before the sky early return');
  assert.ok(src.includes('return vec4u(bitcast<vec3u>(L), shaftBits);'));
  assert.ok(/\| caoBits \| .* \| shaftBits \| cloudBits\)/.test(src), 'shaftBits OR-ed beside caoBits / cloudBits');
  assert.ok(src.includes('u.shaft.x > 0.0 && u.shaft.z > 0.0'), 'steps 0 / off -> march skipped');
}
for (const src of [SHADE_WGSL, SHADE_GI_WGSL]) {
  assert.ok(src.includes('fn shaftW') && src.includes('fn shaftLiftC') && src.includes('su.shaftA.x > 0.0'));
  assert.equal(src.split('su.shaftA.x > 0.0').length - 1, 2, 'sky branch + scene branch');
}

// bit budget: shaft bits 20..23 collide with neither cao (1..7), sunlit (0), litCount (8..15), sunN (16..18), bit 19, cloud (24..31)
assert.equal(SHAFT_MASK, 0x00f00000); assert.equal(SHAFT_SHIFT, 20);
const others = 0xff0fff ^ 0 | 0xff000000 | 0x000fffff; // everything but 20..23
const w = (0xdeadbeef & ~SHAFT_MASK) >>> 0;
assert.equal(shaftPack(w, 9) & ~SHAFT_MASK >>> 0, w & ~SHAFT_MASK >>> 0, 'other bits untouched by shaftPack');
assert.ok(((127 << CAO_SHIFT) & SHAFT_MASK) === 0 && ((7 << 16) & SHAFT_MASK) === 0 && ((255 << 8) & SHAFT_MASK) === 0 && ((255 << 24) & SHAFT_MASK) === 0);
void others;

// preset data: high 6, ultra 10, low/medium 0 (matches SHAFT_STEPS)
const presets = JSON.parse(readFileSync(new URL('../../../../content/settings/gfx-presets.json', import.meta.url), 'utf8')).presets;
for (const name of ['low', 'medium', 'high', 'ultra']) assert.equal(presets[name].shaftSteps, shaftStepsFor(name), name);
console.log('lightShaft.wgsl: layout, splices, bits, let-assign lint, presets OK');
