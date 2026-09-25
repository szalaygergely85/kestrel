// US-016 Node tests for `packTerrainTextures` (docs/architecture.md 14.4
// item 3). No `gl`, no `design/` import - a self-contained stub recipe.
import assert from 'node:assert';
import { Terrain } from '../../world/Terrain.js';
import { packTerrainTextures, packNearTextures, TLOOK_WIDTH } from './TerrainTextures.js';

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
      grass: { id: 0, colors: ['grassDark', 'grass', 'grassLight'], glyphs: { near: '",', mid: ',.', far: '.', close: '*' }, albedo: 0.85 },
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
      bake(x0, y0, cell2, bw, bh) {
        const n = bw * bh;
        const height = new Float32Array(n), type = new Uint8Array(n);
        return { x0, y0, w: bw, h: bh, cell: cell2, height, type };
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

// US-026a (23.4): texel 7 is the close-band glyph set.
const closeOff = grassRow + 7 * 4;
check('grass close-band glyph count == 1', packed.tlook[closeOff + 1] === 1);
check('grass close-band glyph is glyphIdx for "*"', (packed.tlook[closeOff] & 0xff) === '*'.charCodeAt(0) - 32);
// forest has no glyphs.close -> defaults to a single space (glyphIdx 0).
const forestRow = 1 * TLOOK_WIDTH * 4;
const forestCloseOff = forestRow + 7 * 4;
check('forest (no glyphs.close): defaults to a single space glyph', packed.tlook[forestCloseOff + 1] === 1 && (packed.tlook[forestCloseOff] & 0xff) === 0);

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

// ---- US-026a S5: FEAT packing (TLOOK texels 8-11) --------------------------
{
  const paletteF = {
    rgb: {
      ...palette.rgb,
      gold: [255, 200, 0], strawLight: [230, 210, 120],
      rock: [90, 90, 90], stoneLight: [160, 160, 160],
    },
  };
  function makeRecipeWithFeatures() {
    const r = makeRecipe();
    r.nearLOD = {
      handover: [130, 170], step: { min: 0.5, k: 0.012 }, bands: { close: 40 },
      features: [
        { id: 'wildflower', on: 'grass', bands: ['close'], chance: 0.025, glyphs: '*,', colors: ['gold', 'strawLight'] },
        { id: 'pebble', on: 'grass', bands: ['close'], chance: 0.012, glyphs: 'o.', colors: ['rock', 'stoneLight'] },
        { id: 'tallGrass', on: 'grass', bands: ['close'], chance: 0.06, glyphs: '"', colors: ['grassLight'] },
        { id: 'reed', on: 'grass', bands: ['close', 'near'], chance: 0.2, glyphs: '|!', colors: ['grass'] },
      ],
    };
    return r;
  }
  const tF = new Terrain(makeRecipeWithFeatures());
  tF.bakeFarSync();
  const packedF = packTerrainTextures(tF, paletteF);
  const gRow = 0 * TLOOK_WIDTH * 4; // grass row
  const slot0 = gRow + 8 * 4, slot0Col = gRow + 9 * 4;
  const slot1 = gRow + 10 * 4, slot1Col = gRow + 11 * 4;
  check('grass feature slot 0: chance == 0.025 (wildflower)', Math.abs(packedF.tlook[slot0] - 0.025) < 1e-6);
  check('grass feature slot 0: code0 is glyphIdx for "*"', packedF.tlook[slot0 + 1] === '*'.charCodeAt(0) - 32);
  check('grass feature slot 0: code1 is glyphIdx for ","', packedF.tlook[slot0 + 2] === ','.charCodeAt(0) - 32);
  check('grass feature slot 0: fi == 0 (first in the flat list)', packedF.tlook[slot0 + 3] === 0);
  check('grass feature slot 0 colour == gold / 255', Math.abs(packedF.tlook[slot0Col] - 255 / 255) < 1e-6);
  check('grass feature slot 1: chance == 0.012 (pebble)', Math.abs(packedF.tlook[slot1] - 0.012) < 1e-6);
  check('grass feature slot 1: fi == 1 (second in the flat list)', packedF.tlook[slot1 + 3] === 1);
  check('grass feature slot 1 colour == rock / 255', Math.abs(packedF.tlook[slot1Col] - 90 / 255) < 1e-6);
  // US-026a S5: a type with MORE than 2 close-band features (grass has 4 in
  // the real recipe: wildflower/pebble/tallGrass/reed) - slots 2/3 pack too
  // (MAX_FEATURES_PER_TYPE == 4), `fi` keeps counting up the SAME flat list.
  const slot2 = gRow + 12 * 4, slot3 = gRow + 14 * 4;
  check('grass feature slot 2: chance == 0.06 (tallGrass)', Math.abs(packedF.tlook[slot2] - 0.06) < 1e-6);
  check('grass feature slot 2: fi == 2 (third in the flat list)', packedF.tlook[slot2 + 3] === 2);
  check('grass feature slot 3: chance == 0.2 (reed)', Math.abs(packedF.tlook[slot3] - 0.2) < 1e-6);
  check('grass feature slot 3: fi == 3 (fourth in the flat list)', packedF.tlook[slot3 + 3] === 3);
  // forest has no features targeting it -> both slots chance == 0 (never fires).
  const fRow = 1 * TLOOK_WIDTH * 4;
  check('forest feature slot 0: chance == 0 (no feature)', packedF.tlook[fRow + 8 * 4] === 0);
  check('forest feature slot 1: chance == 0 (no feature)', packedF.tlook[fRow + 10 * 4] === 0);
}

// recipe with no nearLOD at all -> every feature slot is chance == 0 (already
// covered by the plain `packed` fixture above, spot-checked here explicitly).
{
  const gRow = 0 * TLOOK_WIDTH * 4;
  check('no nearLOD.features: grass feature slot 0 chance == 0', packed.tlook[gRow + 8 * 4] === 0);
  check('no nearLOD.features: grass feature slot 1 chance == 0', packed.tlook[gRow + 10 * 4] === 0);
}

// ---- US-026a S5: packNearTextures -------------------------------------------
{
  const tN = new Terrain(makeRecipe());
  let threw = false;
  try { packNearTextures(tN); } catch (e) { threw = true; }
  check('packNearTextures: not nearReady throws', threw);

  tN.bakeFarSync();
  tN.bakeNearBand(0, 0);
  const packedN = packNearTextures(tN);
  check('packNearTextures: width/height match near.w/h', packedN.width === tN.near.w && packedN.height === tN.near.h);
  check('packNearTextures: x0/y0/cell match near band', packedN.x0 === tN.near.x0 && packedN.y0 === tN.near.y0 && packedN.cell === tN.near.cell);
  check('packNearTextures: nearH is near.hDraw', packedN.nearH === tN.near.hDraw);
  check('packNearTextures: nearType is near.type', packedN.nearType === tN.near.type);
}

console.log(`TerrainTextures.test.js: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
