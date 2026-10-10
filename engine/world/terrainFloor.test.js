// GS-01a: legend `terrainFloor` flag -> no level floor quad, World carveMask, raster carve lookup.
import assert from 'node:assert/strict';
import { AssetRegistry, World } from '../index.js';
import { loadLevel } from './Level.js';
import { buildLevelMesh } from '../mesh/levelMesh.js';
import { insideStructFoot } from '../mesh/rasterJS.js';
import { KIND_FLOOR, KIND_WALL } from '../render/GBuffer.js';
import { flatKind } from '../mesh/MeshData.js';

const base = { floorH: 0, ceilH: 'sky', wallMat: 'stone', floorMat: 'floor', ceilMat: 'sky', solid: false };
const rows = ['..,,', '..,,', '....'];
function def(flag, zone) {
  return { name: 'tf', version: 1, cellSize: 1, size: { w: 4, h: 3 }, rows,
    legend: { '.': { ...base }, ',': { ...base, floorMat: 'grass', zone, ...(flag ? { terrainFloor: true } : {}) } },
    sun: { azimuthDeg: 30, elevationDeg: 45 }, start: { x: 1.5, y: 1.5, facingDeg: 0 }, props: [], interactables: [], triggers: [] };
}
const count = (set, kind) => { let n = 0; const m = set.base; for (let t = 0; t < m.triCount; t += 2) if (flatKind(m.flat[t * 6 + 1]) === kind) n++; return n; };
let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };

// AC1: flagged outside cells emit no floor quad (4 cells); unflagged -> all 12.
const plain = buildLevelMesh(loadLevel(def(false, 'outside')));
const flagged = buildLevelMesh(loadLevel(def(true, 'outside')));
ok(count(plain, KIND_FLOOR) === 12, 'unflagged: 12 floors');
ok(count(flagged, KIND_FLOOR) === 8, 'flagged: 4 floors dropped');
ok(count(flagged, KIND_WALL) === count(plain, KIND_WALL), 'walls unchanged');
// flag is ignored without zone outside
ok(count(buildLevelMesh(loadLevel(def(true, 'inside'))), KIND_FLOOR) === 12, 'zone != outside: flag ignored');

// AC2: World carveMask + raster lookup.
const mk = (d) => World.load({ name: 'w', structures: [{ id: 't', level: 'tf', origin: { x: 10, y: 20, z: 0 } }] },
  new AssetRegistry({ palette: { rgb: {} }, levels: { tf: d } }));
const w0 = mk(def(false, 'outside')).structures[0];
ok(w0.carveMask === null, 'no flag -> carveMask null');
const st = mk(def(true, 'outside')).structures[0];
ok(st.carveMask instanceof Uint8Array && st.carveMask.length === 12, 'carveMask w*h');
ok(st.carveMask[0] === 1 && st.carveMask[2] === 0 && st.carveMask[7] === 0, 'flagged cells = 0');
const foot = Float64Array.from([st.bbox.x0, st.bbox.y0, st.bbox.x1, st.bbox.y1]);
const masks = [st.carveMask];
ok(insideStructFoot(foot, 1, 10.5, 20.5, masks), 'plain cell carved');
ok(!insideStructFoot(foot, 1, 12.5, 20.5, masks), 'flagged cell not carved');
ok(!insideStructFoot(foot, 1, 5, 5, masks), 'outside bbox not carved');
ok(insideStructFoot(foot, 1, 12.5, 20.5, null) && insideStructFoot(foot, 1, 12.5, 20.5, [null]), 'no mask -> whole bbox');
console.log(`terrainFloor.test: ${checks} checks OK`);
