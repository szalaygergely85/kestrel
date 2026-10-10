// tools/export/fbxWrite.js (CHARGEN-10, docs/architecture.md 38.29 item 6): RiggedModel -> binary FBX 7.4 (7400), static mesh.
// Browser-safe (no fs, no zlib: arrays are written uncompressed), deterministic (fixed header ids, no timestamps).
//
//   exportFbx(model, {rgbOf, colorMode?, name?}) -> {fbx: Uint8Array, png: Uint8Array}
//     colorMode 'white' (default, like exportGlb): the vertex colour layer is 1,1,1,1; 'rgb': the sRGB palette colour.
//     The palette texture is NOT embedded: the material's Texture node points at "palette.png" (write `png` next to the .fbx).
//
// Scene: Y-up, centimetres (GlobalSettings UnitScaleFactor 1 = cm), right-handed, the character faces +Z. Axes as the .glb,
// (X,Y,Z)_fbx = (-x, z, -y) from authoring, x100. One Model "Body" (Mesh) = one Geometry of quads + one Material (white
// Lambert) + one Texture (DiffuseColor) on the 16x16 palette. Normal, UV and Color layers are per polygon vertex (UV and Color
// IndexToDirect over the materials). FBX cannot express nearest-neighbour: set Point filtering in the importer.
// CHARGEN-11 (opts.skeleton:true) adds 22 LimbNode Models + NodeAttributes, a rigid Skin with one Cluster per bone and a BindPose;
// without it the bytes are unchanged. CHARGEN-12 the animation stacks (not in this file yet).
// Container: header "Kaydara FBX Binary  \0\x1a\0" + u32 version; 32-bit node records {endOffset,numProps,propsLen,nameLen};
// a 13-byte null record closes every child list and the file; footer as Blender's encode_bin (footer id, 4 zero bytes, pad to
// 16 (a full 16 when already aligned), version, 120 zero bytes, magic).
import { paletteTexture, texelUv } from './png.js';

const TEXTURE_FILE = 'palette.png';
const HEADER = 'Kaydara FBX Binary  \0\x1a\0';
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const enc = new TextEncoder();

// ---- node model: {name, props:[[type,value]], kids:[]}
const I = (v) => ['I', v], L = (v) => ['L', v], D = (v) => ['D', v], S = (v) => ['S', v], R = (v) => ['R', v], C = (v) => ['C', v];
const N = (name, props = [], kids = []) => ({ name, props, kids });
// Properties70 entry: "name","type","label","flags", values...
const P = (name, type, label, flags, ...vals) => N('P', [S(name), S(type), S(label), S(flags), ...vals.map((v) => (typeof v === 'string' ? S(v) : D(v)))]);

function propSize(p) {
  const [t, v] = p;
  switch (t) {
    case 'C': return 2;
    case 'I': case 'F': return 5;
    case 'D': case 'L': return 9;
    case 'S': case 'R': return 5 + v.length;
    case 'i': case 'f': return 13 + 4 * v.length;
    case 'd': case 'l': return 13 + 8 * v.length;
    default: throw new Error('fbx: bad prop type ' + t);
  }
}

function writeProp(dv, u8, o, p) {
  const [t, v] = p;
  u8[o++] = t.charCodeAt(0);
  switch (t) {
    case 'C': u8[o] = v ? 1 : 0; return o + 1;
    case 'I': dv.setInt32(o, v, true); return o + 4;
    case 'D': dv.setFloat64(o, v, true); return o + 8;
    case 'L': dv.setBigInt64(o, BigInt(v), true); return o + 8;
    case 'S': case 'R': dv.setUint32(o, v.length, true); u8.set(v, o + 4); return o + 4 + v.length;
    default: { // arrays i f d l
      const w = t === 'i' || t === 'f' ? 4 : 8;
      dv.setUint32(o, v.length, true); dv.setUint32(o + 4, 0, true); dv.setUint32(o + 8, w * v.length, true); o += 12;
      for (let i = 0; i < v.length; i++, o += w) {
        if (t === 'i') dv.setInt32(o, v[i], true); else if (t === 'f') dv.setFloat32(o, v[i], true);
        else if (t === 'd') dv.setFloat64(o, v[i], true); else dv.setBigInt64(o, BigInt(v[i]), true);
      }
      return o;
    }
  }
}

/** Encode strings, then compute record sizes (children first). */
function prep(node) {
  node.nameB = enc.encode(node.name);
  node.props = node.props.map((p) => (p[0] === 'S' && typeof p[1] === 'string' ? ['S', enc.encode(p[1])] : p));
  node.propsLen = node.props.reduce((n, p) => n + propSize(p), 0);
  node.kids.forEach(prep);
  const kidsLen = node.kids.reduce((n, k) => n + k.size, 0);
  node.size = 13 + node.nameB.length + node.propsLen + (node.kids.length ? kidsLen + 13 : 0);
  return node;
}

function writeNode(dv, u8, o, node) {
  dv.setUint32(o, o + node.size, true); dv.setUint32(o + 4, node.props.length, true); dv.setUint32(o + 8, node.propsLen, true);
  u8[o + 12] = node.nameB.length; u8.set(node.nameB, o + 13);
  let p = o + 13 + node.nameB.length;
  for (const pr of node.props) p = writeProp(dv, u8, p, pr);
  if (node.kids.length) { for (const k of node.kids) p = writeNode(dv, u8, p, k); p += 13; } // null record = zero bytes
  return p;
}

/** top-level nodes -> file bytes (header, nodes, sentinel, footer). */
export function encodeFbx(roots, version = 7400) {
  roots.forEach(prep);
  const head = HEADER.length + 4;
  const end = head + roots.reduce((n, k) => n + k.size, 0) + 13 + 16 + 4;
  let pad = ((end + 15) & ~15) - end; if (pad === 0) pad = 16;
  const out = new Uint8Array(end + pad + 4 + 120 + 16), dv = new DataView(out.buffer);
  for (let i = 0; i < HEADER.length; i++) out[i] = HEADER.charCodeAt(i);
  dv.setUint32(HEADER.length, version, true);
  let o = head;
  for (const r of roots) o = writeNode(dv, out, o, r);
  o += 13;
  out.set(FOOT_ID, o); o += 16 + 4 + pad;
  dv.setUint32(o, version, true); o += 4 + 120;
  out.set(FOOT_MAGIC, o);
  return out;
}

// 4x4 translation matrix, FBX order (column-major, translation in elements 12..14)
const tMat = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** Skeleton part (CHARGEN-11): LimbNode per bone, rigid Skin + Cluster per bone (all weights 1), BindPose. Joints use the
 *  mesh axis map (-x, z, -y) x100. A bone's Lcl Translation is its offset from the parent joint; clusters/pose are global. */
function skeletonNodes(model, mesh, GEO, MODEL) {
  const { bones } = model;
  const nb = bones.length, nq = mesh.quads;
  if (nb !== mesh.ranges.length) throw new Error(`exportFbx: ${nb} bones but ${mesh.ranges.length} mesh ranges`);
  const index = new Map(bones.map((b, i) => [b.name, i]));
  const jw = bones.map((b) => [-b.joint[0] * 100, b.joint[2] * 100, -b.joint[1] * 100]);
  const roots = bones.filter((b) => b.parent == null);
  if (roots.length !== 1) throw new Error(`exportFbx: skeleton needs exactly one root, has ${roots.length}`);
  const BONE = 2000000, ATTR = 2100000, CLUSTER = 2200000, SKIN = 2300000, POSE = 2400000;
  const objects = [], connections = [];
  bones.forEach((b, i) => {
    const pi = b.parent == null ? -1 : index.get(b.parent);
    if (b.parent != null && pi === undefined) throw new Error(`exportFbx: bone ${b.name} has unknown parent ${b.parent}`);
    const t = pi < 0 ? jw[i] : jw[i].map((v, k) => v - jw[pi][k]);
    objects.push(N('NodeAttribute', [L(ATTR + i), S(b.name + '\0\x01NodeAttribute'), S('LimbNode')], [
      N('Properties70', [], [P('Size', 'double', 'Number', '', 1)]), N('TypeFlags', [S('Skeleton')]),
    ]));
    objects.push(N('Model', [L(BONE + i), S(b.name + '\0\x01Model'), S('LimbNode')], [
      N('Version', [I(232)]),
      N('Properties70', [], [P('Lcl Translation', 'Lcl Translation', '', 'A', t[0], t[1], t[2]), P('Lcl Rotation', 'Lcl Rotation', '', 'A', 0, 0, 0), P('Lcl Scaling', 'Lcl Scaling', '', 'A', 1, 1, 1)]),
      N('Shading', [C(1)]), N('Culling', [S('CullingOff')]),
    ]));
    connections.push(N('C', [S('OO'), L(BONE + i), L(pi < 0 ? 0 : BONE + pi)]));
    connections.push(N('C', [S('OO'), L(ATTR + i), L(BONE + i)]));
  });
  objects.push(N('Deformer', [L(SKIN), S('Skin\0\x01Deformer'), S('Skin')], [
    N('Version', [I(101)]), N('Link_DeformAcuracy', [D(50)]), N('SkinningType', [S('Rigid')]),
  ]));
  connections.push(N('C', [S('OO'), L(SKIN), L(GEO)]));
  const seen = new Uint8Array(4 * nq);
  bones.forEach((b, i) => {
    const r = mesh.ranges[i], idx = [], w = [];
    for (let q = r.start; q < r.start + r.count; q++) for (let k = 0; k < 4; k++) { idx.push(4 * q + k); w.push(1); seen[4 * q + k]++; }
    objects.push(N('Deformer', [L(CLUSTER + i), S(b.name + '\0\x01SubDeformer'), S('Cluster')], [
      N('Version', [I(100)]), N('UserData', [S(''), S('')]),
      N('Indexes', [['i', idx]]), N('Weights', [['d', w]]),
      N('Transform', [['d', tMat(0, 0, 0)]]), N('TransformLink', [['d', tMat(...jw[i])]]),
    ]));
    connections.push(N('C', [S('OO'), L(CLUSTER + i), L(SKIN)]));
    connections.push(N('C', [S('OO'), L(BONE + i), L(CLUSTER + i)]));
  });
  if (seen.some((c) => c !== 1)) throw new Error('exportFbx: mesh.ranges must cover every quad exactly once');
  objects.push(N('Pose', [L(POSE), S('Pose\0\x01Pose'), S('BindPose')], [
    N('Type', [S('BindPose')]), N('Version', [I(100)]), N('NbPoseNodes', [I(nb + 1)]),
    N('PoseNode', [], [N('Node', [L(MODEL)]), N('Matrix', [['d', tMat(0, 0, 0)]])]),
    ...bones.map((b, i) => N('PoseNode', [], [N('Node', [L(BONE + i)]), N('Matrix', [['d', tMat(...jw[i])]])])),
  ]));
  return { objects, connections, nb };
}

export function exportFbx(model, opts = {}) {
  const { rgbOf, colorMode = 'white', name = 'Body', skeleton = false } = opts;
  if (typeof rgbOf !== 'function') throw new Error('exportFbx: opts.rgbOf(matKey) -> [r,g,b] is required');
  if (colorMode !== 'rgb' && colorMode !== 'white') throw new Error(`exportFbx: colorMode must be 'rgb' or 'white', got ${colorMode}`);
  const { mesh, matKeys } = model;
  const nq = mesh.quads;
  if (!nq) throw new Error('exportFbx: empty mesh');
  if (matKeys.length > 256) throw new Error(`exportFbx: ${matKeys.length} materials (max 256)`);
  const palette = matKeys.map((k) => {
    const c = rgbOf(k);
    if (!c || c.length < 3) throw new Error(`exportFbx: rgbOf("${k}") gave no colour`);
    return c;
  });
  const tex = paletteTexture(palette);

  // geometry: 4 vertices per quad; polygon corner order b, b+3, b+2, b+1 (the axis map is a reflection)
  const ORDER = [0, 3, 2, 1];
  const verts = new Array(12 * nq), pvi = new Array(4 * nq), nrm = new Array(12 * nq), uvIdx = new Array(4 * nq), colIdx = new Array(4 * nq);
  for (let q = 0; q < nq; q++) {
    const m = mesh.mat[q] - 1;
    if (!(m >= 0 && m < matKeys.length)) throw new Error(`exportFbx: quad ${q} has material ${mesh.mat[q]} outside matKeys`);
    for (let k = 0; k < 4; k++) { // vertex k
      const a = 12 * q + 3 * k, v = 3 * (4 * q + k);
      verts[v] = -mesh.pos[a] * 100; verts[v + 1] = mesh.pos[a + 2] * 100; verts[v + 2] = -mesh.pos[a + 1] * 100;
    }
    for (let j = 0; j < 4; j++) { // polygon slot j = corner ORDER[j]; normal / UV / colour layers follow the slot order
      const c = ORDER[j], s = 12 * q + 3 * c, i = 4 * q + j, d = 3 * i;
      nrm[d] = -mesh.nrm[s]; nrm[d + 1] = mesh.nrm[s + 2]; nrm[d + 2] = -mesh.nrm[s + 1];
      pvi[i] = j === 3 ? -(4 * q + c) - 1 : 4 * q + c;
      uvIdx[i] = m; colIdx[i] = colorMode === 'rgb' ? m : 0;
    }
  }
  const uvs = [];
  for (let m = 0; m < matKeys.length; m++) uvs.push(...texelUv(m));
  const colors = colorMode === 'rgb' ? palette.flatMap((c) => [c[0] / 255, c[1] / 255, c[2] / 255, 1]) : [1, 1, 1, 1];

  const GEO = 1000001, MODEL = 1000002, MAT = 1000003, TEX = 1000004;
  const layerElem = (kind) => N('LayerElement', [], [N('Type', [S(kind)]), N('TypedIndex', [I(0)])]);
  const layer = (kind, mapName, ref, data) => N(kind, [I(0)], [
    N('Version', [I(101)]), N('Name', [S(mapName)]),
    N('MappingInformationType', [S('ByPolygonVertex')]), N('ReferenceInformationType', [S(ref)]), ...data,
  ]);
  const geometry = N('Geometry', [L(GEO), S(name + '\0\x01Geometry'), S('Mesh')], [
    N('Properties70'),
    N('GeometryVersion', [I(124)]),
    N('Vertices', [['d', verts]]),
    N('PolygonVertexIndex', [['i', pvi]]),
    layer('LayerElementNormal', '', 'Direct', [N('Normals', [['d', nrm]])]),
    layer('LayerElementUV', 'UVMap', 'IndexToDirect', [N('UV', [['d', uvs]]), N('UVIndex', [['i', uvIdx]])]),
    layer('LayerElementColor', 'Col', 'IndexToDirect', [N('Colors', [['d', colors]]), N('ColorIndex', [['i', colIdx]])]),
    N('LayerElementMaterial', [I(0)], [
      N('Version', [I(101)]), N('Name', [S('')]),
      N('MappingInformationType', [S('AllSame')]), N('ReferenceInformationType', [S('IndexToDirect')]),
      N('Materials', [['i', [0]]]),
    ]),
    N('Layer', [I(0)], [N('Version', [I(100)]), layerElem('LayerElementNormal'), layerElem('LayerElementUV'), layerElem('LayerElementColor'), layerElem('LayerElementMaterial')]),
  ]);
  const objects = N('Objects', [], [
    geometry,
    N('Model', [L(MODEL), S(name + '\0\x01Model'), S('Mesh')], [
      N('Version', [I(232)]),
      N('Properties70', [], [P('Lcl Translation', 'Lcl Translation', '', 'A', 0, 0, 0), P('Lcl Rotation', 'Lcl Rotation', '', 'A', 0, 0, 0), P('Lcl Scaling', 'Lcl Scaling', '', 'A', 1, 1, 1)]),
      N('Shading', [C(1)]), N('Culling', [S('CullingOff')]),
    ]),
    N('Material', [L(MAT), S(name + '\0\x01Material'), S('')], [
      N('Version', [I(102)]), N('ShadingModel', [S('lambert')]), N('MultiLayer', [I(0)]),
      N('Properties70', [], [P('DiffuseColor', 'Color', '', 'A', 1, 1, 1), P('DiffuseFactor', 'Number', '', 'A', 1), P('SpecularFactor', 'Number', '', 'A', 0), P('Shininess', 'Number', '', 'A', 0)]),
    ]),
    N('Texture', [L(TEX), S('palette\0\x01Texture'), S('')], [
      N('Type', [S('TextureVideoClip')]), N('Version', [I(202)]), N('TextureName', [S('palette\0\x01Texture')]),
      N('Properties70', [], [P('UseMaterial', 'bool', '', '', 1)]),
      N('Media', [S('palette\0\x01Video')]), N('FileName', [S(TEXTURE_FILE)]), N('RelativeFilename', [S(TEXTURE_FILE)]),
      N('ModelUVTranslation', [D(0), D(0)]), N('ModelUVScaling', [D(1), D(1)]), N('Texture_Alpha_Source', [S('None')]), N('Cropping', [I(0), I(0), I(0), I(0)]),
    ]),
  ]);
  const connections = [
    N('C', [S('OO'), L(MODEL), L(0)]),
    N('C', [S('OO'), L(GEO), L(MODEL)]),
    N('C', [S('OO'), L(MAT), L(MODEL)]),
    N('C', [S('OP'), L(TEX), L(MAT), S('DiffuseColor')]),
  ];
  let defTypes = ['GlobalSettings', 'Model', 'Geometry', 'Material', 'Texture'], defCounts = [1, 1, 1, 1, 1];
  if (skeleton) {
    const sk = skeletonNodes(model, mesh, GEO, MODEL);
    objects.kids.push(...sk.objects);
    connections.push(...sk.connections);
    defTypes = ['GlobalSettings', 'Model', 'Geometry', 'Material', 'Texture', 'NodeAttribute', 'Deformer', 'Pose'];
    defCounts = [1, 1 + sk.nb, 1, 1, 1, sk.nb, 1 + sk.nb, 1];
  }
  const roots = [
    N('FBXHeaderExtension', [], [
      N('FBXHeaderVersion', [I(1003)]), N('FBXVersion', [I(7400)]),
      N('CreationTimeStamp', [], [N('Version', [I(1000)]), N('Year', [I(1970)]), N('Month', [I(1)]), N('Day', [I(1)]), N('Hour', [I(10)]), N('Minute', [I(0)]), N('Second', [I(0)]), N('Millisecond', [I(0)])]),
      N('Creator', [S('Kestrel chargen')]),
    ]),
    N('FileId', [R(new Uint8Array(FILE_ID))]),
    N('CreationTime', [S('1970-01-01 10:00:00:000')]),
    N('Creator', [S('Kestrel chargen')]),
    N('GlobalSettings', [], [
      N('Version', [I(1000)]),
      N('Properties70', [], [
        P('UpAxis', 'int', 'Integer', '', 1), P('UpAxisSign', 'int', 'Integer', '', 1),
        P('FrontAxis', 'int', 'Integer', '', 2), P('FrontAxisSign', 'int', 'Integer', '', 1),
        P('CoordAxis', 'int', 'Integer', '', 0), P('CoordAxisSign', 'int', 'Integer', '', 1),
        P('OriginalUpAxis', 'int', 'Integer', '', 1), P('OriginalUpAxisSign', 'int', 'Integer', '', 1),
        P('UnitScaleFactor', 'double', 'Number', '', 1), P('OriginalUnitScaleFactor', 'double', 'Number', '', 1),
      ]),
    ]),
    N('Documents', [], [N('Count', [I(1)]), N('Document', [L(1000000), S(''), S('Scene')], [N('Properties70', [], [P('SourceObject', 'object', '', ''), P('ActiveAnimStackName', 'KString', '', '', '')]), N('RootNode', [L(0)])])]),
    N('References'),
    N('Definitions', [], [
      N('Version', [I(100)]), N('Count', [I(defTypes.length)]),
      ...defTypes.map((t, i) => N('ObjectType', [S(t)], [N('Count', [I(defCounts[i])])])),
    ]),
    objects,
    N('Connections', [], connections),
    N('Takes', [], [N('Current', [S('')])]),
  ];
  return { fbx: encodeFbx(roots), png: tex.png };
}
