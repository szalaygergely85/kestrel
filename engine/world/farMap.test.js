// MAP-01b (arch 38.42): far grid origin + size (<= 512), data-sized terrain type table (ids 5-10 appended).
// Run: node engine/world/farMap.test.js
import { createHash } from 'node:crypto';
import { makeOk } from '../test/assert.js';
import terrainDef from '../../design/levels/overworld_far.js';
import { Terrain } from './Terrain.js';
import { validateDetailConfig } from './scatter.js';
globalThis.window = globalThis.window || globalThis;
terrainDef;
const recipe = globalThis.ASSETS.levels.overworld_far;
recipe.structures[0].bbox = { x0: 1480, y0: 1018, x1: 1504, y1: 1032 }; recipe.structures[0].ringHAt = () => 2.4;
const util = recipe.util;
let pass = 0, fail = 0;
const ok = makeOk(() => pass++, () => fail++, (m) => console.error('FAIL:', m));
const hashOf = (h, t) => createHash('sha1').update(Buffer.from(h.buffer)).update(Buffer.from(t.buffer)).digest('hex');
const DEFMAP = { ...recipe.map };

// 1. default map = 0,0,256,256 and the Terrain far bake equals the plain bake (byte-identical path)
ok('default map origin 0,0 / 256^2', recipe.map.x0 === 0 && recipe.map.y0 === 0 && recipe.map.w === 256 && recipe.map.h === 256);
let T = new Terrain(recipe); T.bakeFarSync();
const G0 = util.bake(0, 0, 8, 256, 256);
ok('default: far bake == util.bake(0,0,8,256,256)', hashOf(T.farH, T.farType) === hashOf(G0.height, G0.type));
let T2 = new Terrain(recipe); while (!T2.farReady) T2.bakeFarStep(50);
ok('default: stepped bake == sync bake', hashOf(T2.farH, T2.farType) === hashOf(T.farH, T.farType));

// 2. type table
const names = T.typeNames;
ok('ids 0-4 unchanged', names.slice(0, 5).join() === 'grass,forest,water,rock,path');
ok('ids 5-10 appended', names.slice(5, 11).join() === 'sand,snow,reeds,fen,flowers,alpine' && names.length === 11);
ok('typeName round-trip', [5, 6, 7, 8, 9, 10].every((i) => T.typeName(i) === names[i]) && T.typeName(99) === 'grass');
let det = null;
try {
  det = validateDetailConfig({ layers: [{ name: 'x', seed: 1, cellM: 4, drawM: 60, jitter: 0.5, fill: 0.5, maxSlope: 0.6, clearM: 1,
    ground: { sand: [{ mesh: 'a', weight: 1 }], fen: [{ mesh: 'b', weight: 1 }], alpine: [{ mesh: 'c', weight: 1 }] } }] });
} catch (e) { console.error(e.message); }
ok('scatter accepts new ground types', det !== null);
const pal = globalThis.ASSETS.palette;
if (pal && pal.rgb) {
  const { packTerrainTextures } = await import('../render/gpu/TerrainTextures.js');
  const P = packTerrainTextures(T, pal);
  ok('TLOOK has 11 type rows', P.tlookHeight === 11 && P.typeIds[10] === 'alpine');
}

// 3. 512^2 grid at a shifted origin: timing + origin correctness
recipe.map = { x0: 512, y0: 256, w: 512, h: 512, cell: 8 };
const U = new Terrain(recipe);
const t0 = performance.now(); U.bakeFarSync(); const ms = performance.now() - t0;
console.log(`far bake 512^2 (sync, 5-heightAt path off: cell 8 == slopeEps): ${ms.toFixed(0)} ms`);
ok('512^2 bake <= 1500 ms', ms <= 1500);
const V = new Terrain(recipe); let worst = 0, steps = 0;
while (!V.farReady) { const s = performance.now(); V.bakeFarStep(2); worst = Math.max(worst, performance.now() - s); steps++; }
console.log(`stepped @2 ms budget: ${steps} frames, worst step ${worst.toFixed(2)} ms`);
ok('stepped == sync (shifted 512^2)', hashOf(V.farH, V.farType) === hashOf(U.farH, U.farType));
ok('stepped worst step <= 4 ms', worst <= 4);
const wx = 512 + 1000.3, wy = 256 + 777.7;
ok('farHeightAt in shifted grid ~ heightAt', Math.abs(U.farHeightAt(wx, wy) - util.heightAt(wx, wy)) < 6);
ok('farHeightAt outside origin = null', U.farHeightAt(100, 100) === null && U.farHeightAt(512 + 4096 + 10, 300) === null);
const ti = Math.floor((wx - 512) / 8), tj = Math.floor((wy - 256) / 8);
ok('farType at texel = typeAt at centre', U.farType[ti + tj * 512] === util.typeAt(512 + (ti + 0.5) * 8, 256 + (tj + 0.5) * 8));
ok('grid > 512 rejected', (() => { try { recipe.map = { ...recipe.map, w: 513 }; new Terrain(recipe); return false; } catch (e) { return true; } })());

// 4. new types round-trip through the far bake (geo layer paints ids 5-10 outside keep)
recipe.map = { x0: 512, y0: 256, w: 512, h: 512, cell: 8 };
util.setGeoLayers([{ id: 't', rect: [2400, 1400, 3200, 2200], typeFn: (t, x, y) => 5 + (Math.floor(x / 40 + y / 40) % 6) }]);
const W = new Terrain(recipe); W.bakeFarSync();
const seen = new Set(W.farType);
ok('far bake carries ids 5-10', [5, 6, 7, 8, 9, 10].every((i) => seen.has(i)));
util.setGeoLayers([]);
recipe.map = DEFMAP;
console.log(`farMap.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
