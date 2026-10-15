// UNDER-00b (arch 38.75): legend `keepTerrain` -> no carve, terrain support gated by footZ, ground nav walkable, validateUnder.
import assert from 'node:assert/strict';
import { AssetRegistry, World } from '../index.js';
import { validateUnder, validateUnderSite } from './validateUnder.js';
import { hasLineOfSight } from './interaction.js';

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
// (e) UNDER-00c: line of sight / ray above a room hits nothing; the room itself and rock between stay blocked
ok(hasLineOfSight(on, x, y, g + 1, x + 1, y, g + 1.5), 'sight ray above a crypt (keepTerrain) is clear');
ok(hasLineOfSight(on, x, y, g + 0.2, x + 1, y + 1, g + 0.2), 'ray just above the surface is clear');
ok(!hasLineOfSight(on, x, y, g + 1, x, y, 5), 'ray down into rock between surface and room ceiling is blocked');
ok(hasLineOfSight(on, x, y, 1, x + 1, y, 1.2), 'ray inside the room is clear');
ok(!hasLineOfSight(on, x, y, 1, x, y, g + 1), 'ray from the room up through rock is blocked');
ok(!hasLineOfSight(off, x, y, g + 1, x + 1, y, g + 1.5), 'no flag: structure bbox still blocks sight above it (unchanged)');
const seg = new Float64Array([x, y, g + 1, x + 1, y, g + 1.5]), hit = { t: 0, x: 0, y: 0, z: 0 };
ok(!on.raySegmentRay(seg, hit), 'mesh raySegment above a crypt: no hit');
const segD = new Float64Array([x, y, g + 1, x, y, g - 3]);
ok(on.raySegmentRay(segD, hit) && hit.z > g - 1.01, 'mesh raySegment into the ground above a crypt hits the terrain surface');

// (f) grid physics is rejected (note b), (g) rotated / cellSize-2 sites are rejected clearly
{ const warns = [], cw = console.warn; console.warn = (m) => warns.push(String(m));
  let gw; try { gw = World.load({ name: 'w', structures: [{ id: 'u', level: 'under', origin: { x: 10, y: 20, z: 0 } }] },
    new AssetRegistry({ palette: { rgb: {} }, levels: { under: def(true) } }), { physics: 'grid' }); } finally { console.warn = cw; }
  const gw2 = (console.warn = (m) => warns.push(String(m)), World.load({ name: 'w', structures: [{ id: 'u', level: 'under', origin: { x: 10, y: 20, z: 0 } }] }, new AssetRegistry({ palette: { rgb: {} }, levels: { under: def(true) } }), { physics: 'grid' }));
  console.warn = cw;
  ok(gw2.structures.length === 0 && !gw2.structures.some((s) => s.id === 'u'), 'second grid load: still skipped');
  ok(gw.structures.length === 0 && !gw.structures.some((s) => s.id === 'u') && warns.length === 1 && /keepTerrain.*mesh/.test(warns[0]), 'grid physics: keepTerrain site not in world.structures, ONE warn across two loads'); }
const rot = mk(true, 6); rot.structures[0].yawSteps = 1;
ok(validateUnder(rot).some((e) => /unrotated/.test(e)), 'validateUnder rejects a rotated site');
const cs2 = mk(true, 6); cs2.structures[0].level.cellSize = 2;
ok(validateUnder(cs2).some((e) => /cellSize 2/.test(e)), 'validateUnder rejects cellSize 2');
ok(validateUnderSite(def(true), { yawSteps: 0 }).length === 0 && validateUnderSite(def(false), { yawSteps: 1 }).length === 0, 'static lint: ok / unflagged ignored');
ok(validateUnderSite(def(true), { yawSteps: 2 }).length === 1, 'static lint: rotated rejected');
ok(validateUnderSite({ ...def(true), cellSize: 2 }, {}).length === 1, 'static lint: cellSize 2 rejected');
const skyDef = def(true); skyDef.legend['.'] = { ...skyDef.legend['.'], ceilH: 'sky', topH: 'sky' };
ok(validateUnderSite(skyDef, {}).length === 1, 'static lint: sky-open keepTerrain cell rejected');
console.log(`keepTerrain.test: ${checks} checks OK`);
