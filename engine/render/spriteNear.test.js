// BUG-FIRE-001: pure CPU/GLSL near-sprite checks.
import assert from 'node:assert/strict';
import { CellBuffer } from './CellBuffer.js';
import { DepthBuffer } from './DepthBuffer.js';
import { drawSprites, lastSpriteDepth, SPR_STRIDE, SPRITE_NEAR_DEPTH } from './sprites.js';
import { SPRITES_WGSL } from './gpu/wgsl/sprites.wgsl.js';
import { spritesFragSrc } from './gpu/wgsl/spritesFrag.glslref.js';

let checks = 0;
function ok(condition, message) { checks++; assert.ok(condition, message); }
const cells = new CellBuffer(1, 1), depth = new DepthBuffer(1, 1);
const spr = new Float32Array(2 * SPR_STRIDE);
const atlas = { width: 2, data: new Uint8Array([10, 0, 0, 1, 11, 0, 1, 1]), pal: new Float32Array([200, 120, 60, 255]) };
const pool = { count: 1, spr, atlas };
const fb = { rt: cells, depth };
function row(slot, distance, emissive, visible = 1) {
  const o = slot * SPR_STRIDE;
  spr.set([0, 0, 1, 1, 1, distance, 0, visible, emissive ? 1 : 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], o);
}
for (const emissive of [false, true]) {
  for (const distance of [0.1, 0.599, 0.6, 0.601, 5]) {
    cells.clear('#102030'); depth.depth[0] = 10;
    row(0, distance, emissive);
    drawSprites(fb, pool);
    const drawn = distance >= 0.6;
    ok(Number.isFinite(lastSpriteDepth()[0]) === drawn, `${emissive ? 'emissive' : 'lit'} at ${distance} m`);
    ok(cells.glyphIdx[0] === (drawn ? (emissive ? 11 : 10) : 0), 'culled sprite leaves the surface glyph intact');
    ok(cells.bg[0] === 16 && cells.bg[1] === 32 && cells.bg[2] === 48, 'background is preserved');
  }
}
cells.clear('#000000'); depth.depth[0] = 10;
pool.count = 2; row(0, 0.599, true); row(1, 2, false);
drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === 2 && cells.glyphIdx[0] === 10, 'culled near fire does not occlude a farther sprite');
pool.count = 1; row(0, 0.6, true, 0); drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === SPRITE_NEAR_DEPTH, 'emissive sprite at cutoff remains visible in darkness');
row(0, 0.6, false, 0); drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === Infinity, 'lit sprite still obeys the visibility flag');
row(0, 2, true); depth.depth[0] = 1; drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === Infinity, 'far sprites retain scene-depth occlusion');
// HAND-FIRE-WRAP-01: nearOk (T3.w = 1) sprites draw inside the near cutoff but still obey the depth buffer (hand voxels)
function rowNear(slot, distance) { row(slot, distance, true); spr[slot * SPR_STRIDE + 15] = 1; }
pool.count = 1; cells.clear('#102030'); depth.depth[0] = 10; rowNear(0, 0.3); drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === Math.fround(0.3), 'nearOk sprite draws at 0.3 m (inside the near cull)');
depth.depth[0] = 0.2; drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === Infinity, 'nearOk sprite behind a nearer hand voxel (depth 0.2) is hidden');
depth.depth[0] = 0.4; drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === Math.fround(0.3), 'nearOk sprite in front of the hand voxel (depth 0.4) is visible');
row(0, 0.3, true); drawSprites(fb, pool);
ok(lastSpriteDepth()[0] === Infinity, 'an ordinary sprite at 0.3 m is still culled');
for (const depthUint of [false, true]) {
  const shader = spritesFragSrc({ depthUint });
  ok(shader.includes(`const float SPRITE_NEAR_DEPTH = ${SPRITE_NEAR_DEPTH};`), 'GPU uses identical f32 cutoff');
  ok(shader.indexOf('if (p.y < SPRITE_NEAR_DEPTH && texelFetch(uSpr, ivec2(3, s), 0).w < 0.5) continue;') < shader.indexOf('bool emissive ='), 'GPU culls before either texel lighting path');
}
ok(SPRITES_WGSL.includes('if (p.y < SPRITE_NEAR_DEPTH && textureLoad(uSpr, vec2i(3, s), 0).w < 0.5) { continue; }'), 'WGSL near cull honours nearOk (T3.w) like the GLSL ref');
ok(SPRITES_WGSL.indexOf('textureLoad(uSpr, vec2i(3, s), 0).w < 0.5') < SPRITES_WGSL.indexOf('let emissive'), 'WGSL culls before the lighting path');

console.log(`sprite near cutoff: ${checks} checks. ALL PASS`);
