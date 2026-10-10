// GLTF-HAND-01 (38.32 risk 3): where does static loadGltf put glTF's left/up/front markers in OUR axes?
// glTF spec: up +Y, front +Z, model LEFT = +X. Ours: x east, y north, z up, hero faces north (+y), hero's left = west (-x).
// Run: node tools/gltf-handedness-check.mjs
import { loadGltf } from '../engine/index.js';

export const MARKERS = { left: [1, 0, 0], up: [0, 1, 0], front: [0, 0, 1] }; // glTF coordinates

/** Tiny GLB: one triangle whose 3 vertices are the markers (a distinct vertex index each). */
export function buildFixtureGlb() {
  const pos = new Float32Array([...MARKERS.left, ...MARKERS.up, ...MARKERS.front]);
  const binLen = pos.byteLength;
  const json = {
    asset: { version: '2.0' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binLen }],
    buffers: [{ byteLength: binLen }],
  };
  let js = JSON.stringify(json);
  while (js.length % 4) js += ' ';
  const jb = new TextEncoder().encode(js);
  const total = 12 + 8 + jb.length + 8 + binLen;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  const o = 20 + jb.length;
  dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004e4942, true);
  out.set(new Uint8Array(pos.buffer), o + 8);
  return out;
}

/** Match each marker to the loaded vertex nearest its expected axis-converted position class; returns {name: [x,y,z]}. */
export function checkHandedness() {
  const mesh = loadGltf(buildFixtureGlb(), 'gltf:hand/fixture');
  const pts = [];
  for (let v = 0; v < mesh.triCount * 3; v++) pts.push([mesh.pos[v * 3], mesh.pos[v * 3 + 1], mesh.pos[v * 3 + 2]].map((n) => Math.round(n * 1e4) / 1e4 + 0));
  // order-based names (vertex 0 = left, 1 = up, 2 = front); winding flip only happens for mirrored nodes (none here)
  const byOrder = { left: pts[0], up: pts[1], front: pts[2] };
  const dir = (p) => { const ax = p.findIndex((n) => n !== 0); return `${p[ax] > 0 ? '+' : '-'}${'xyz'[ax]}`; };
  const ours = { left: dir(byOrder.left), up: dir(byOrder.up), front: dir(byOrder.front) };
  // Proper rotation <=> (left x up) points the way front does in OUR right-handed (x east, y north, z up) frame, mirrored from glTF:
  // glTF is right-handed: right(-X) x up(+Y) = +Z? (-X)x(+Y) = -Z; so left x up = +X x +Y = +Z = front. Same test in ours.
  const vec = (s) => { const v = [0, 0, 0]; v['xyz'.indexOf(s[1])] = s[0] === '+' ? 1 : -1; return v; };
  const L = vec(ours.left), U = vec(ours.up), F = vec(ours.front);
  const cr = [L[1] * U[2] - L[2] * U[1], L[2] * U[0] - L[0] * U[2], L[0] * U[1] - L[1] * U[0]];
  const dot = cr[0] * F[0] + cr[1] * F[1] + cr[2] * F[2];
  const verdict = dot > 0 ? 'CORRECT' : 'MIRRORED';
  const frontNote = ours.front === '+y' ? 'hero faces north' : `model front lands on ${ours.front} (hero faces ${{ '-y': 'SOUTH', '+x': 'east', '-x': 'west' }[ours.front] || '?'}; a 180 deg yaw at placement/import is needed to face north)`;
  return { verdict, ours, found: byOrder, frontNote, dot };
}

if (process.argv[1] && process.argv[1].endsWith('gltf-handedness-check.mjs')) {
  const r = checkHandedness();
  console.log('glTF markers: left=+X(1,0,0) up=+Y(0,1,0) front=+Z(0,0,1)');
  for (const k of ['left', 'up', 'front']) console.log(`  ${k.padEnd(5)} -> ours (${r.found[k].join(', ')})  = ${r.ours[k]}`);
  console.log(`handedness (left x up . front, glTF = +1): ${r.dot > 0 ? '+1' : '-1'}`);
  console.log(r.verdict + ' - ' + r.frontNote);
}
