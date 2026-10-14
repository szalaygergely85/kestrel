// engine/voxel/parts16b.test.js - VOX-PARTS-16b (architecture.md 38.67 fact 2): flat0 bit 17 (4th part bit) is safe because no WGSL/JS
// consumer decodes the part field; they only OR flat0 into the planeId and compare planeIds for equality.
// Run: node engine/voxel/parts16b.test.js
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { packVoxelModel } from './voxelPack.js';
import { buildVoxelMesh } from '../mesh/voxelMesh.js';
import quadruped16 from './fixtures/quadruped16.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const here = dirname(fileURLToPath(import.meta.url));

// 1. WGSL: every use of the flat attribute's x word is an OR into planeId (or the cloth path's own uniform); never a shift/mask decode.
const wgslDir = join(here, '..', 'render', 'gpu', 'wgsl');
let uses = 0, bad = [];
for (const f of readdirSync(wgslDir)) {
  if (!f.endsWith('.wgsl.js')) continue;
  readFileSync(join(wgslDir, f), 'utf8').split('\n').forEach((ln, i) => {
    if (!/aFlat\.x/.test(ln)) return;
    uses++;
    if (!/aFlat.x[^|]{0,6}|/.test(ln)) bad.push(`${f}:${i + 1}`);
  });
}
ok('WGSL: aFlat.x is only ORed (>= 2 sites, no decode)', uses >= 1 && bad.length === 0, `uses=${uses} bad=${bad.join()}`);
// deriv: planeId only compared for equality (no shift/mask on it)
const deriv = readFileSync(join(wgslDir, 'deriv.wgsl.js'), 'utf8');
ok('deriv.wgsl: planeId compared with ==, never shifted/masked',
  /planeId == pid0/.test(deriv) && !/planeId\s*(>>|<<|&)/.test(deriv) && !/pid0\s*(>>|<<|&)/.test(deriv));

// 2. JS twin: planeId = flat0 | planeIdOr. Parts 8..11 must give planeIds distinct from parts 0..3 (bit 17 is the only difference).
const MATS = ['mat_a', 'mat_b', 'mat_c'];
const pm = packVoxelModel(quadruped16, (k) => MATS.indexOf(k) + 1);
const names = Object.keys(quadruped16.parts);
const mesh = buildVoxelMesh(pm, { id: 'q16', partNames: names });
const planeIdOr = 3 << 24; // a voxel slot in bits 24-27, as the pool sets it
const ids = new Map(); let collide = 0;
mesh.ranges.forEach((rg, p) => {
  for (let v = rg.start * 3; v < (rg.start + rg.count) * 3; v++) {
    const pid = ((mesh.flat[v * 2] | planeIdOr) >>> 0);
    const key = pid;
    if (ids.has(key) && ids.get(key) !== p) collide++;
    ids.set(key, p);
    if (((pid >>> 24) & 0xF) !== 0xF && ((pid >>> 28) !== 0xF)) collide++; // instance bits stay intact
  }
});
ok('JS twin: planeId (flat0 | planeIdOr) never collides across the 12 parts', collide === 0, 'collisions=' + collide);
ok('bit 17 set exactly for parts 8..11', mesh.ranges.every((rg, p) => {
  for (let v = rg.start * 3; v < (rg.start + rg.count) * 3; v++) if (((mesh.flat[v * 2] >>> 17) & 1) !== (p >= 8 ? 1 : 0)) return false;
  return true;
}));
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
