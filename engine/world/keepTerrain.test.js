// UNDER-00b (arch 38.75): legend `keepTerrain` -> no carve, terrain support gated by footZ, ground nav walkable, validateUnder.
import assert from 'node:assert/strict';
import { AssetRegistry, World } from '../index.js';
import { validateUnder } from './validateUnder.js';

let checks = 0; const ok = (c, m) => { assert.ok(c, m); checks++; };
const base = { floorH: 0, ceilH: 2.5, topH: 2.8, wallMat: 'stone', floorMat: 'floor', ceilMat: 'stone', solid: false };
const rows = ['######', '#....#', '#....#', '#....#', '#....#', '######'];
function def(keep) {
  return { name: 'under', version: 1, cellSize: 1, size: { w: 6, h: 6 }, rows,
    legend: { '#': { ...base, solid: true, floorH: 2.8 }, '.': { ...base, ...(keep ? { keepTerrain: true } : {}) } },
    sun: { azimuthDeg: 30, elevationDeg: 45 }, start: { x: 2.5, y: 2.5, facingDeg: 0 }, props: [], interactables: [], triggers: [] };
}
// sloped stub terrain: z = slope * x, plane normal
const mkTerrain = (z0) => {
  const t = { groundAt: (x) => z0 + 0.1 * x, groundTypeAt: () => 0, floorMatFor: () => 'grass',
    groundNormalAt: (x, y, o) => { o.x = -0.0995; o.y = 0; o.z = 0.995; return o; },
    groundAtBuf(io) { io[3] = z0 + 0.1 * io[0]; }, groundNormalAtBuf(io) { io[4] = -0.0995; io[5] = 0; io[6] = 0.995; } };
  return t;
};
const mk = (keep, z0) => {
  const w = World.load({ name: 'w', structures: [{ id: 'u', level: 'under', origin: { x: 10, y: 20, z: 0 } }] },
    new AssetRegistry({ palette: { rgb: {} }, levels: { under: def(keep) } }), { physics: 'mesh' });
  w.terrain = mkTerrain(z0);
  return w;
};
const opts = { height: 1.6, stepUpMax: 0.5, walkCos: 0.7 };

// (a) carve mask / keepMask
const off = mk(false, 6), on = mk(true, 6);
ok(off.structures[0].carveMask === null && off.structures[0].keepMask === null, 'no flag: masks null (byte-identical)');
const st = on.structures[0];
ok(st.carveMask && st.carveMask[0] === 1 && st.carveMask[7] === 0, 'keepTerrain cells = 0 in carveMask, walls stay carved');
ok(st.keepMask[7] === 1 && st.keepMask[0] === 0, 'keepMask marks flagged cells');

// (b) support: terrain at (12.5, 22.5) is 6 + 1.25 = 7.25
const x = 12.5, y = 22.5, g = on.terrain.groundAt(x);
const inside = on.supportAt(x, y, 0, true, opts);
ok(inside.floorH < 0.1 && !inside.terrain, `inside the room support = room floor, not terrain (got ${inside.floorH})`);
const above = on.supportAt(x, y, g + 0.2, false, opts);
ok(above.terrain && Math.abs(above.floorH - g) < 1e-9, 'feet above the surface: terrain supports');
const edge = on.supportAt(x, y, g - 0.5, false, opts);
ok(edge.terrain, 'within 0.6 m below the surface: terrain still supports');
const deep = on.supportAt(x, y, g - 0.7, false, opts);
ok(!deep.terrain, 'more than 0.6 m below: no terrain');
// Out twin parity
const io = new Float64Array(10);
for (const z of [0, g - 0.7, g - 0.5, g + 0.2]) {
  io[0] = x; io[1] = y; io[2] = z; on.supportAtOut(false, opts, io);
  const s = on.supportAt(x, y, z, false, opts);
  ok(io[3] === s.floorH && (io[7] === 1) === !!s.terrain, `supportAtOut == supportAt at footZ ${z.toFixed(2)}`);
}
// unflagged structure: terrain never supports inside the bbox (unchanged)
const o1 = off.supportAt(x, y, g + 5, false, opts);
ok(!o1.terrain, 'no flag: structure still occludes terrain across its bbox');
// outside the bbox unchanged
ok(on.supportAt(30, 30, 20, false, opts).terrain === off.supportAt(30, 30, 20, false, opts).terrain, 'outside bbox identical');

// (d) validateUnder
ok(validateUnder(mk(true, 6)).length === 0, 'terrain 6+ above a 2.8 m room: ok');
const bad = validateUnder(mk(true, 1.5));
ok(bad.length > 0 && /u cell \(\d+,\d+\)/.test(bad[0]), `terrain too low: error names the cell (${bad[0]})`);
ok(validateUnder(off).length === 0, 'no flag: nothing to lint');
console.log(`keepTerrain.test: ${checks} checks OK`);
