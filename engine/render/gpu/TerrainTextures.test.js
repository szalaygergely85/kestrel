// US-016 Node tests for `packTerrainTextures` (docs/architecture.md 14.4
// item 3). No `gl`, no `design/` import - a self-contained stub recipe.
import assert from 'node:assert';
import { Terrain } from '../../world/Terrain.js';
import { packTerrainTextures, TLOOK_WIDTH } from './TerrainTextures.js';

let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }

const palette = {
  rgb: {
    grassDark: [10, 40, 10], grass: [20, 80, 20], grassLight: [40, 120, 40],
    forestDark: [5, 20, 5],
  },
};

function makeRecipe() {
  const w = 8, h = 8, cell = 8;
  return {
    seed: 1, map: { w, h, cell },
    terrain: {
      grass: { id: 0, colors: ['grassDark', 'grass', 'grassLight'], glyphs: { near: '",', mid: ',.', far: '.' }, albedo: 0.85 },
      forest: { id: 1, colors: ['forestDark', 'grass', 'grassLight'], glyphs: { near: '&%@', mid: '%&', far: '%' }, albedo: 0.7, glint: undefined },
    },
    recipe: { forest: { canopy: 10 } },
    util: {
      heightAt: (x, y) => (x + y) * 0.01,
      typeAt: (x, y) => (Math.floor(x / 8) % 2),
      generate() {
        const n = w * h;
        const height = new Float32Array(n), type = new Uint8Array(n);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { height[i + j * w] = i + j; type[i + j * w] = i % 2; }
        return { height, type, w, h, cell };
      },
      gridHeight() { return 0; },
    },
  };
}

const terrain = new Terrain(makeRecipe());
terrain.bakeFarSync();
const packed = packTerrainTextures(terrain, palette);

check('width/height match the far grid', packed.width === terrain.mapW && packed.height === terrain.mapH);
check('farH is terrain.farHDraw (canopy-adjusted)', packed.farH === terrain.farHDraw);
check('farType is terrain.farType', packed.farType === terrain.farType);
check('tlookWidth == TLOOK_WIDTH', packed.tlookWidth === TLOOK_WIDTH);
check('tlookHeight == number of terrain types', packed.tlookHeight === 2);
check('typeIds sorted by id', packed.typeIds[0] === 'grass' && packed.typeIds[1] === 'forest');

// dark/mid/light colours are linear 0..1.
const grassRow = 0 * TLOOK_WIDTH * 4;
check('grass dark colour matches palette / 255', Math.abs(packed.tlook[grassRow] - 10 / 255) < 1e-6);
check('grass mid colour matches palette / 255', Math.abs(packed.tlook[grassRow + 4] - 20 / 255) < 1e-6);
check('grass light colour matches palette / 255', Math.abs(packed.tlook[grassRow + 8] - 40 / 255) < 1e-6);

// texel 3: albedo, glintFlag.
const albedoOff = grassRow + 3 * 4;
check('grass albedo == 0.85', Math.abs(packed.tlook[albedoOff] - 0.85) < 1e-6);
check('grass glintFlag == 0 (no glint declared)', packed.tlook[albedoOff + 1] === 0);

// texels 4-6: glyph codes packed 8 bits each + count.
const nearOff = grassRow + 4 * 4;
const nearCount = packed.tlook[nearOff + 1];
check('grass near-band glyph count == 2', nearCount === 2);
const c0 = packed.tlook[nearOff] & 0xff;
check('grass near-band glyph 0 is glyphIdx for "\\""', c0 === '"'.charCodeAt(0) - 32);

// unknown palette colour throws with the offending key/type named.
{
  let threw = false;
  try {
    packTerrainTextures(terrain, { rgb: {} });
  } catch (e) {
    threw = /grassDark/.test(e.message);
  }
  check('unknown palette colour throws, names the key', threw);
}

// not farReady -> throws.
{
  const fresh = new Terrain(makeRecipe());
  let threw = false;
  try { packTerrainTextures(fresh, palette); } catch (e) { threw = true; }
  check('not farReady: throws', threw);
}

console.log(`TerrainTextures.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
