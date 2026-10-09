// ALPHA-01f-fix2: the instanced mesh-group path passes the mask atlas to MeshDrawCache.get (meshDraw.maskAtlas), so a
// masked mesh shared by a static placement and an instanced group has ONE cache entry with maskRanges (no ping-pong).
// Run: node engine/mesh/instancedMaskAtlas.test.js
import { DrawList, MeshDrawCache } from './DrawList.js';
import { buildMeshFromTris } from './gltf.js';
import { InstanceGroups, writeUnitInstance } from './instances.js';
import { MaskAtlas } from '../render/MaskAtlas.js';
import { frustumPlanes } from './culling.js';
import { projTerms, shearProjection } from '../render/projection.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const atlas = new MaskAtlas();
const chk = new Uint8Array(16); for (let i = 0; i < 16; i++) chk[i] = i % 2 ? 0 : 255;
atlas.add('test/Checker', 4, 4, chk);
const quad = (x0) => [
  { p0: [x0, 0, 0], p1: [x0 + 2, 0, 0], p2: [x0 + 2, 0, 2], normal: [0, -1, 0], matName: 'leaf', uv0: [0, 1], uv1: [1, 1], uv2: [1, 0] },
  { p0: [x0, 0, 0], p1: [x0 + 2, 0, 2], p2: [x0, 0, 2], normal: [0, -1, 0], matName: 'leaf', uv0: [0, 1], uv1: [1, 0], uv2: [0, 0] },
];
const mk = (masked, id) => {
  const m = buildMeshFromTris([...quad(-2), ...quad(0)], [{ part: 'bark', triStart: 0, triCount: 2 }, { part: 'leaf', triStart: 2, triCount: 2, ...(masked ? { mask: { tex: 'test/Checker', cutoff: 0.5 } } : {}) }], id);
  m.mats = { leaf: 'leaf' }; return m;
};
const idFor = () => 5;
const COLS = 120, ROWS = 60;
const terms = {}, M = new Float64Array(16), planes = new Float64Array(24);
projTerms({ x: 1, y: -3, z: 1, yawDeg: 180, pitchDeg: 0 }, { cols: COLS, rows: ROWS, pxCellW: 1, pxCellH: 1 }, terms); shearProjection(terms, M); frustumPlanes(M, planes);

function group(mesh) {
  const ig = new InstanceGroups(); const g = ig.meshGroup(mesh, 2);
  for (let i = 0; i < 2; i++) writeUnitInstance(g.ib, g.count++, i * 6, 0, 0, 0, 0xA000 | i, 0);
  return { ig, g };
}
const origWarn = console.warn; let warns = 0; console.warn = () => { warns++; };

// 1. masked mesh: static + instanced share ONE cache entry with maskRanges across 3 frames
{
  const mesh = mk(true, 'm/masked'), cache = new MeshDrawCache(), { ig } = group(mesh);
  const md = { cache, idFor, maskAtlas: atlas };
  let first = null, stable = true;
  for (let f = 1; f <= 3; f++) {
    const s = cache.get(mesh, idFor, atlas); // static path
    const l = new DrawList(); l.begin(); ig.addToDrawList(l, null, planes, f, M, ROWS, md);
    const d = cache.get(mesh, idFor, atlas);
    if (!first) first = s; if (s !== first || d !== first) stable = false;
  }
  ok('masked: one cache entry reused for 3 frames (no rebuild ping-pong)', stable);
  ok('masked: instanced draw copy has maskRanges', !!first.maskRanges && first.maskRanges[2] === -1 && first.maskRanges[7] === 4);
}
// 2. no atlas -> opaque behaviour unchanged
{
  const mesh = mk(true, 'm/noatlas'), cache = new MeshDrawCache(), { ig } = group(mesh);
  const l = new DrawList(); l.begin(); ig.addToDrawList(l, null, planes, 1, M, ROWS, { cache, idFor });
  ok('no atlas: copy has no maskRanges (opaque)', !cache.get(mesh, idFor).maskRanges && warns > 0);
}
// 3. unmasked mesh: same copy with or without atlas, no maskRanges
{
  const mesh = mk(false, 'm/plain'), cache = new MeshDrawCache(), { ig } = group(mesh);
  const l = new DrawList(); l.begin(); ig.addToDrawList(l, null, planes, 1, M, ROWS, { cache, idFor, maskAtlas: atlas });
  const a = cache.get(mesh, idFor, atlas), b = cache.get(mesh, idFor);
  ok('unmasked: one entry, no maskRanges, atlas irrelevant', a === b && !a.maskRanges);
}
console.warn = origWarn;
console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
