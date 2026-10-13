// ED-MESH-1g: async mesh selection with a mock frame.readSurface: right structure, stale dropped, sky clears.
import { makeOk } from '../../engine/test/assert.js';
import { makeFrame } from '../../engine/index.js';
import { makePickGuard } from './pickGuard.js';
import { resolveMeshClick } from './meshClick.js';
import { unprojectCell } from './ray.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

// camera at origin looking +y; ray through the centre cell is (0,1,0)
const cam = { x: 0, y: 0, z: 0, yawDeg: 0, pitchDeg: 0, fov: 60 };
const ray = unprojectCell(cam, 9, 5, 8, 16, 4, 2, 'mesh');
// a small triangle facing the ray, centred on the ray point at distance d (the quad sits in a plane around it)
const mk = (id, d) => {
  const cx = ray.ox + ray.dx * d, cy = ray.oy + ray.dy * d, cz = ray.oz + ray.dz * d;
  const pos = new Float32Array([cx-1,cy-1,cz-1, cx+1,cy-1,cz-1, cx,cy+1,cz+1]);
  return { id, kind: 'mesh', bbox: { x0:cx-1, x1:cx+1, y0:cy-1, y1:cy+1, z0:cz-1, z1:cz+1 }, frame: makeFrame(0,0,0,0), scale: 1, mesh: { pos } };
};
const MESH = 9;
let surf = { kind: MESH, face: 0, mat: 0, planeId: 12345 /* arbitrary: ids must NOT come from here */, depth: 5 };
let gate = null, reads = 0;
const world = { structures: [mk('a', 5), mk('b', 20)], forEachEntity() {} };
const ctx = { cam, cols: 9, rows: 5, pxCellW: 8, pxCellH: 16, world, assets: null, fb: null, voxelPool: null, renderer: 'mesh',
  readSurface: async () => { reads++; if (gate) await gate; return surf; } };
const guard = makePickGuard(() => world);

const r1 = await resolveMeshClick(guard, 4, 2, ctx);
ok('click resolves to a structure id (not GI objectId)', r1.action === 'mesh' && r1.structureId === 'a', JSON.stringify(r1));
ok('one readSurface per click', reads === 1);

surf = { ...surf, depth: 20 };
const r2 = await resolveMeshClick(guard, 4, 2, ctx);
ok('farther depth picks the other structure', r2.action === 'mesh' && r2.structureId === 'b', JSON.stringify(r2));

// stale: camera move (bump) while the read is pending
let release; gate = new Promise((r) => { release = r; });
let p = resolveMeshClick(guard, 4, 2, ctx); guard.bump(); release();
ok('camera move before read resolves -> dropped', (await p).action === 'stale');
// stale: newer click supersedes
gate = new Promise((r) => { release = r; });
const pa = resolveMeshClick(guard, 4, 2, ctx), pb = resolveMeshClick(guard, 4, 2, ctx); release();
const [ra, rb] = [await pa, await pb];
ok('older click dropped, newest kept', ra.action === 'stale' && rb.action === 'mesh');
gate = null;

surf = { kind: 0, face: 0, mat: 0, planeId: 0, depth: Infinity };
ok('empty-sky click -> clear selection', (await resolveMeshClick(guard, 0, 0, ctx)).action === 'clear');

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
console.log('ALL PASS');
