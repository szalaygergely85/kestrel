// engine/mesh/gltf.test.js (ME-13a, docs/backlog.md, docs/architecture.md
// 27.2/27.3/27.4/27.13). Plain Node ESM, no framework.
// Run: node engine/mesh/gltf.test.js
//
// Every fixture below is built IN THIS FILE as a minimal valid GLB
// container (JSON chunk + BIN chunk) - no third-party binary file is
// committed, per the story's explicit requirement.
import { loadGltf, KIND_MESH, meshPlaneIdBase } from './gltf.js';
import { validateMesh, flatKind, flatFace, flatMat, AO_NONE } from './MeshData.js';
import { unpackNormalOct } from '../voxel/octNormal.js';
import { FACE_U, FACE_N, FACE_PACKED } from '../render/GBuffer.js';
import { makeOk } from '../test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function approxEqual(a, b, eps = 1e-5) { return Math.abs(a - b) <= eps; }

// ---------------------------------------------------------------------------
// GLB fixture builder.
// ---------------------------------------------------------------------------

function pad4(buf, fill = 0x00) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

/**
 * Builds a minimal valid .glb ArrayBuffer from a glTF JSON object (without
 * `buffers[0].byteLength`/binary chunk length filled in - those are
 * computed here) and a single binary blob (all accessors point into it).
 * @param {Object} json
 * @param {Buffer} bin
 * @returns {ArrayBuffer}
 */
function buildGlb(json, bin) {
  json = JSON.parse(JSON.stringify(json)); // deep clone, own binLength below
  json.buffers = [{ byteLength: bin.length }];
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), 'utf-8'), 0x20); // pad with spaces (valid JSON whitespace)
  const binBuf = pad4(bin);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // magic 'glTF'
  header.writeUInt32LE(2, 4); // version
  const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuf.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  const full = Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength);
}

/** Packs an array of [x,y,z] triples into a little-endian Float32 Buffer. */
function f32Buf(rows, comps) {
  const buf = Buffer.alloc(rows.length * comps * 4);
  let o = 0;
  for (const row of rows) for (let c = 0; c < comps; c++) { buf.writeFloatLE(row[c], o); o += 4; }
  return buf;
}

function u16Buf(indices) {
  const buf = Buffer.alloc(indices.length * 2);
  for (let i = 0; i < indices.length; i++) buf.writeUInt16LE(indices[i], i * 2);
  return buf;
}

/**
 * One mesh, one primitive, one node, default scene. `positions`: array of
 * [x,y,z] (glTF-space, Y-up). `indices`: optional triangle index list.
 * `node`: optional {translation, rotation, scale, matrix} override.
 * `material`: optional material name.
 */
function simpleGlb({ positions, indices, uvs, material, node, extra }) {
  const posBuf = f32Buf(positions, 3);
  const chunks = [{ buf: posBuf, target: 34962 }];
  const bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: posBuf.length }];
  const accessors = [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }];
  let offset = posBuf.length;

  let uvAccessor;
  if (uvs) {
    const uvBuf = f32Buf(uvs, 2);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: uvBuf.length });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: uvs.length, type: 'VEC2' });
    uvAccessor = accessors.length - 1;
    chunks.push({ buf: uvBuf });
    offset += uvBuf.length;
  }

  let idxAccessor;
  if (indices) {
    const idxBuf = u16Buf(indices);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: idxBuf.length });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: indices.length, type: 'SCALAR' });
    idxAccessor = accessors.length - 1;
    chunks.push({ buf: idxBuf });
    offset += idxBuf.length;
  }

  const bin = Buffer.concat(chunks.map((c) => c.buf));

  const primitive = { attributes: { POSITION: 0 } };
  if (uvAccessor !== undefined) primitive.attributes.TEXCOORD_0 = uvAccessor;
  if (idxAccessor !== undefined) primitive.indices = idxAccessor;
  if (material !== undefined) primitive.material = 0;

  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, ...(node || {}) }],
    meshes: [{ primitives: [primitive] }],
    bufferViews,
    accessors,
    ...(material !== undefined ? { materials: [{ name: material }] } : {}),
    ...(extra || {}),
  };
  return buildGlb(json, bin);
}

// ---------------------------------------------------------------------------
// 1. Round-trip parse: a single triangle.
// ---------------------------------------------------------------------------
{
  // glTF space (x,y,z), Y-up: a triangle in the XZ-ish... use simple axis-
  // aligned points so the expected world conversion is easy to check by
  // hand: axisConvert(x,y,z) = (x, -z, y).
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const glb = simpleGlb({ positions, indices: [0, 1, 2] });
  const mesh = loadGltf(glb, 'test:tri');
  ok('triangle: validates', validateMesh(mesh).errors.length === 0, JSON.stringify(validateMesh(mesh).errors));
  ok('triangle: triCount == 1', mesh.triCount === 1);
  ok('triangle: vertex count == 3', mesh.pos.length === 9);
  // axisConvert(0,0,0)=(0,0,0); axisConvert(1,0,0)=(1,0,0); axisConvert(0,1,0)=(0,0,1)
  const expected = [[0, 0, 0], [1, 0, 0], [0, 0, 1]];
  let posOk = true;
  for (let v = 0; v < 3; v++) {
    for (let c = 0; c < 3; c++) if (!approxEqual(mesh.pos[v * 3 + c], expected[v][c])) posOk = false;
  }
  ok('triangle: axis-converted positions match', posOk, JSON.stringify(Array.from(mesh.pos)));
  // bbox should tightly contain [0,0,0]..[1,0,1]
  ok('triangle: bbox matches', approxEqual(mesh.bbox[0], 0) && approxEqual(mesh.bbox[3], 1)
    && approxEqual(mesh.bbox[1], 0) && approxEqual(mesh.bbox[4], 0)
    && approxEqual(mesh.bbox[2], 0) && approxEqual(mesh.bbox[5], 1), JSON.stringify(Array.from(mesh.bbox)));
  ok('triangle: kind == KIND_MESH', flatKind(mesh.flat[1]) === KIND_MESH);
}

// ---------------------------------------------------------------------------
// 1b. Non-indexed primitive (no `indices`).
// ---------------------------------------------------------------------------
{
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const glb = simpleGlb({ positions });
  const mesh = loadGltf(glb, 'test:tri-noidx');
  ok('non-indexed: validates', validateMesh(mesh).errors.length === 0);
  ok('non-indexed: triCount == 1', mesh.triCount === 1);
}

// ---------------------------------------------------------------------------
// 2. Node-transform baking: translation + rotation produce correctly
// transformed world-space vertices.
// ---------------------------------------------------------------------------
{
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  // Translate by (5, 0, 0) in glTF space -> axis-converted (5, 0, 0).
  const glb = simpleGlb({ positions, indices: [0, 1, 2], node: { translation: [5, 0, 0] } });
  const mesh = loadGltf(glb, 'test:translated');
  const expected = [[5, 0, 0], [6, 0, 0], [5, 0, 1]];
  let ok1 = true;
  for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) if (!approxEqual(mesh.pos[v * 3 + c], expected[v][c])) ok1 = false;
  ok('translated node: positions shifted correctly', ok1, JSON.stringify(Array.from(mesh.pos)));
}
{
  // 90 deg rotation about glTF Y axis: quaternion (0, sin(45deg), 0, cos(45deg)).
  const s = Math.sin(Math.PI / 4), c = Math.cos(Math.PI / 4);
  const positions = [[1, 0, 0], [0, 0, 0], [0, 0, 1]]; // triangle lying flat, glTF space
  const glb = simpleGlb({ positions, indices: [0, 1, 2], node: { rotation: [0, s, 0, c] } });
  const mesh = loadGltf(glb, 'test:rotated');
  // Rotating (1,0,0) by +90 deg about Y (glTF, right-handed: x'=x*cos+z*sin, z'=-x*sin+z*cos)
  // -> (0,0,-1); axisConvert(0,0,-1) = (0, 1, 0).
  ok('rotated node: first vertex rotated correctly', approxEqual(mesh.pos[0], 0, 1e-4) && approxEqual(mesh.pos[1], 1, 1e-4) && approxEqual(mesh.pos[2], 0, 1e-4),
    JSON.stringify([mesh.pos[0], mesh.pos[1], mesh.pos[2]]));
}

// ---------------------------------------------------------------------------
// 2b. Mirrored node (negative-determinant world transform, e.g. Blender's
// `scale: [-1, 1, 1]`): winding must be flipped to compensate, so the
// resulting face normal still reads as a correctly-oriented outward face
// (matches the un-mirrored case), not inside-out.
// ---------------------------------------------------------------------------
{
  const positions = [[0, 0, 0], [1, 0, 0], [0, 0, 1]];
  const indices = [0, 1, 2];
  const plainGlb = simpleGlb({ positions, indices });
  const plainMesh = loadGltf(plainGlb, 'test:mirror-plain');
  const nPlain = [0, 0, 0]; unpackNormalOct(plainMesh.nrm[0], nPlain);

  const mirroredGlb = simpleGlb({ positions, indices, node: { scale: [-1, 1, 1] } });
  const mirroredMesh = loadGltf(mirroredGlb, 'test:mirror-flip');
  ok('mirrored node: validates', validateMesh(mirroredMesh).errors.length === 0, JSON.stringify(validateMesh(mirroredMesh).errors));
  const nMirrored = [0, 0, 0]; unpackNormalOct(mirroredMesh.nrm[0], nMirrored);
  ok('mirrored node: winding compensated (normal matches un-mirrored, not flipped)',
    approxEqual(nMirrored[0], nPlain[0], 1e-4) && approxEqual(nMirrored[1], nPlain[1], 1e-4) && approxEqual(nMirrored[2], nPlain[2], 1e-4),
    JSON.stringify({ nPlain, nMirrored }));
  // Sanity: without the fix the mirrored normal would be the NEGATION of nPlain.
  const looksNegated = approxEqual(nMirrored[0], -nPlain[0], 1e-4) && approxEqual(nMirrored[1], -nPlain[1], 1e-4) && approxEqual(nMirrored[2], -nPlain[2], 1e-4);
  ok('mirrored node: normal is not simply negated', !looksNegated, JSON.stringify({ nPlain, nMirrored }));
}

// ---------------------------------------------------------------------------
// 3. Smoothing groups: two coplanar triangles sharing an edge get smooth
// (averaged, non-flat-matching) normals; two triangles at a sharp angle
// (a right-angle fold) do not.
// ---------------------------------------------------------------------------
{
  // Two coplanar triangles forming a unit square in the z=0 glTF plane
  // (XY), sharing the edge (1,0,0)-(0,1,0). Both face normals point +Z in
  // glTF space -> both should get the SAME face normal already (trivial
  // smooth case: flat == smooth here since both triangles already agree).
  // Use a case where the GEOMETRIC face normals of the two triangles are
  // slightly different (a very slight bend under 5 deg) so the test can
  // tell "smoothed" (average, != either input) from "flat" (== its own).
  // Triangle A: (0,0,0),(1,0,0),(0,1,0) - flat in XY (normal +Z).
  // Triangle B: (1,0,0),(1,1,0.02),(0,1,0) - almost coplanar, shares edge (1,0,0)-(0,1,0).
  const positions = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], // triangle A: 0,1,2
    [1, 0, 0], [1, 1, 0.02], [0, 1, 0], // triangle B: 3,4,5 (shares verts 1 and 2's positions)
  ];
  const indices = [0, 1, 2, 3, 4, 5];
  const glb = simpleGlb({ positions, indices });
  const mesh = loadGltf(glb, 'test:smooth');
  ok('smooth case: validates', validateMesh(mesh).errors.length === 0, JSON.stringify(validateMesh(mesh).errors));
  // Both triangles' flat[0] (planeId base) must carry the SAME groupId (one smoothing group).
  ok('smooth case: same smoothing group', mesh.flat[0] === mesh.flat[FLAT_STRIDE_TEST(3)]);
  // The normal at shared vertex (1,0,0) (triangle A's vertex 1, index 1) and
  // triangle B's vertex (1,0,0) (its vertex 0, global vertex index 3) must
  // be equal (both look up the same averaged group normal) and must NOT
  // equal either triangle's own flat face normal exactly (since 0.02 offset
  // creates a measurable but <5deg difference) - i.e. genuinely averaged.
  const nA = [0, 0, 0]; unpackNormalOct(mesh.nrm[1], nA);
  const nB = [0, 0, 0]; unpackNormalOct(mesh.nrm[3], nB);
  ok('smooth case: shared-vertex normals match across triangles', approxEqual(nA[0], nB[0], 1e-3) && approxEqual(nA[1], nB[1], 1e-3) && approxEqual(nA[2], nB[2], 1e-3),
    JSON.stringify({ nA, nB }));
}

// Local helper (defined after use via hoisting is not available for const,
// so declare as a function - FLAT_STRIDE_TEST mirrors MeshData.FLAT_STRIDE (2)).
function FLAT_STRIDE_TEST(vertexIndex) { return vertexIndex * 2; }

{
  // Sharp angle: triangle A flat in XY (normal +Z), triangle B a right-
  // angle fold sharing the same edge but facing +Y (near 90 deg from A) ->
  // must NOT be merged into the same smoothing group.
  const positions = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], // triangle A: flat, normal ~+Z
    [1, 0, 0], [0, 1, 0], [0, 1, 1], // triangle B: folds up along the shared edge, normal ~+X-ish (not within 5 deg of +Z)
  ];
  const indices = [0, 1, 2, 3, 4, 5];
  const glb = simpleGlb({ positions, indices });
  const mesh = loadGltf(glb, 'test:sharp');
  const g0 = mesh.flat[0], g1 = mesh.flat[FLAT_STRIDE_TEST(3)];
  ok('sharp angle: different smoothing groups', g0 !== g1, JSON.stringify({ g0, g1 }));
  // The shared-vertex normal should equal each triangle's OWN flat face
  // normal exactly (no averaging across the sharp edge).
  const n0 = [0, 0, 0]; unpackNormalOct(mesh.nrm[1], n0); // triangle A, vertex (1,0,0)
  const n1 = [0, 0, 0]; unpackNormalOct(mesh.nrm[3], n1); // triangle B, vertex (1,0,0)
  ok('sharp angle: normals differ (not merged)', !(approxEqual(n0[0], n1[0], 1e-3) && approxEqual(n0[1], n1[1], 1e-3) && approxEqual(n0[2], n1[2], 1e-3)),
    JSON.stringify({ n0, n1 }));
}

// ---------------------------------------------------------------------------
// 4. Material name capture.
// ---------------------------------------------------------------------------
{
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const glb = simpleGlb({ positions, indices: [0, 1, 2], material: 'ruin_stone' });
  const mesh = loadGltf(glb, 'test:mat');
  ok('material name captured in matKeys', mesh.matKeys.includes('ruin_stone'), JSON.stringify(mesh.matKeys));
  ok('matsResolved is false (ME-13b resolves)', mesh.matsResolved === false);
  const matIdx = flatMat(mesh.flat[1]);
  ok('flat[1] mat bits index matKeys correctly', mesh.matKeys[matIdx] === 'ruin_stone');
}
{
  // No material at all -> 'default'.
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const glb = simpleGlb({ positions, indices: [0, 1, 2] });
  const mesh = loadGltf(glb, 'test:nomat');
  ok('no material -> matKeys == ["default"]', mesh.matKeys.length === 1 && mesh.matKeys[0] === 'default');
}

// ---------------------------------------------------------------------------
// 5. Dominant-axis face + default planar uv.
// ---------------------------------------------------------------------------
{
  // Flat-up triangle (normal ~+Z after axis convert since source is in the XY glTF plane facing +Z... use a square facing straight up post-conversion: glTF normal +Y maps to world +Z).
  const positions = [[0, 0, 0], [1, 0, 0], [0, 0, 1]]; // glTF XZ plane, winds to normal -Y or +Y depending on winding
  const glb = simpleGlb({ positions, indices: [0, 1, 2] });
  const mesh = loadGltf(glb, 'test:face');
  const face = flatFace(mesh.flat[1]);
  ok('face is a dominant axis (not FACE_PACKED) for an axis-aligned triangle', face !== FACE_PACKED, `face=${face}`);
}

// ---------------------------------------------------------------------------
// 6. Ranges: one per primitive/node (two separate nodes/meshes).
// ---------------------------------------------------------------------------
{
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
    nodes: [{ mesh: 0, name: 'wallA' }, { mesh: 1, name: 'wallB', translation: [2, 0, 0] }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] },
      { primitives: [{ attributes: { POSITION: 2 }, indices: 3 }] },
    ],
  };
  const posA = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const posB = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const idxA = [0, 1, 2], idxB = [0, 1, 2];
  const posABuf = f32Buf(posA, 3), idxABuf = u16Buf(idxA);
  const posBBuf = f32Buf(posB, 3), idxBBuf = u16Buf(idxB);
  let off = 0;
  const bufferViews = [];
  const chunks = [];
  for (const b of [posABuf, idxABuf, posBBuf, idxBBuf]) {
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length });
    chunks.push(b);
    off += b.length;
  }
  json.bufferViews = bufferViews;
  json.accessors = [
    { bufferView: 0, componentType: 5126, count: posA.length, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: idxA.length, type: 'SCALAR' },
    { bufferView: 2, componentType: 5126, count: posB.length, type: 'VEC3' },
    { bufferView: 3, componentType: 5123, count: idxB.length, type: 'SCALAR' },
  ];
  const bin = Buffer.concat(chunks);
  const glb = buildGlb(json, bin);
  const mesh = loadGltf(glb, 'test:ranges');
  ok('two nodes -> two ranges', mesh.ranges.length === 2, JSON.stringify(mesh.ranges));
  ok('ranges cover all triangles', mesh.ranges[0].count + mesh.ranges[1].count === mesh.triCount);
  ok('range part names include node names', mesh.ranges[0].part.includes('wallA') && mesh.ranges[1].part.includes('wallB'));
}

// ---------------------------------------------------------------------------
// 7. Validator rejects unsupported features.
// ---------------------------------------------------------------------------
function expectThrow(name, fn) {
  try {
    fn();
    ok(name, false, 'expected a throw, got none');
  } catch (e) {
    ok(name, e instanceof Error && e.message.length > 0, e && e.message);
  }
}

expectThrow('rejects a mesh with a "skins" array', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const glb = simpleGlb({ positions, indices: [0, 1, 2], extra: { skins: [{ joints: [0] }] } });
  loadGltf(glb, 'test:skin');
});

expectThrow('rejects a mesh with an "animations" array', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const glb = simpleGlb({
    positions, indices: [0, 1, 2],
    extra: { animations: [{ channels: [], samplers: [] }] },
  });
  loadGltf(glb, 'test:anim');
});

expectThrow('rejects a primitive with morph targets', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const posBuf = f32Buf(positions, 3);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 0 }] }] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBuf.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }],
  };
  loadGltf(buildGlb(json, posBuf), 'test:morph');
});

expectThrow('rejects a non-TRIANGLES primitive mode', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const posBuf = f32Buf(positions, 3);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }], // LINES
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBuf.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }],
  };
  loadGltf(buildGlb(json, posBuf), 'test:lines');
});

expectThrow('rejects a node with a "skin" property', () => {
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const posBuf = f32Buf(positions, 3);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0, skin: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: posBuf.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }],
    skins: [{ joints: [0] }],
  };
  loadGltf(buildGlb(json, posBuf), 'test:nodeskin');
});

expectThrow('rejects an external (non-data-URI) buffer with no opts.buffers override', () => {
  // A plain .gltf JSON (not GLB) referencing an external .bin.
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' }],
    buffers: [{ uri: 'mesh.bin', byteLength: 36 }],
  };
  loadGltf(JSON.stringify(json), 'test:extbin');
});

// ---------------------------------------------------------------------------
// 8. Separate .gltf + externally-supplied buffer bytes (opts.buffers) works.
// ---------------------------------------------------------------------------
{
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const posBuf = f32Buf(positions, 3);
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length },
      { buffer: 0, byteOffset: posBuf.length, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    buffers: [{ uri: 'mesh.bin', byteLength: posBuf.length + 6 }],
  };
  const idxBuf = u16Buf([0, 1, 2]);
  const bin = Buffer.concat([posBuf, idxBuf]);
  const mesh = loadGltf(JSON.stringify(json), 'test:gltfplain', { buffers: [new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)] });
  ok('plain .gltf + opts.buffers parses', validateMesh(mesh).errors.length === 0 && mesh.triCount === 1);
}

// ---------------------------------------------------------------------------
// 9. Data-URI embedded buffer (no GLB container at all).
// ---------------------------------------------------------------------------
{
  const positions = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const posBuf = f32Buf(positions, 3);
  const idxBuf = u16Buf([0, 1, 2]);
  const bin = Buffer.concat([posBuf, idxBuf]);
  const dataUri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length },
      { buffer: 0, byteOffset: posBuf.length, byteLength: idxBuf.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    buffers: [{ uri: dataUri, byteLength: bin.length }],
  };
  const mesh = loadGltf(JSON.stringify(json), 'test:datauri');
  ok('data-URI buffer parses without a GLB container', validateMesh(mesh).errors.length === 0 && mesh.triCount === 1);
}

// ---------------------------------------------------------------------------
// 10. meshPlaneIdBase tag/format sanity.
// ---------------------------------------------------------------------------
{
  const base = meshPlaneIdBase(5);
  ok('meshPlaneIdBase: top nibble is 0xE', (base >>> 28) === 0xE);
  ok('meshPlaneIdBase: groupId round-trips in the low 20 bits', (base & 0xfffff) === 5);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
