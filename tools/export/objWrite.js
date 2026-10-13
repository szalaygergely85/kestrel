// tools/export/objWrite.js (CHARGEN-12, docs/architecture.md 38.29 item 6): RiggedModel -> Wavefront OBJ + MTL, rest pose.
// Browser-safe (no fs), deterministic (no timestamps).
//
//   exportObj(model, {rgbOf, name?}) -> {obj: string, mtl: string, png: Uint8Array, mtlName, pngName}
//     One `g <bone>` group per bone (skeleton order, empty bones skipped), quads as 4-vertex `f` lines. Axes as the .glb:
//     (X,Y,Z)_obj = (-x, z, -y) metres, Y-up, the character faces +Z; the axis map is a reflection so the corner order is
//     b, b+3, b+2, b+1 (counter-clockwise). vt = the palette texel centre (v flipped: OBJ v goes up), vn = the quad normal.
//     MTL: one material "Palette" with map_Kd = palette.png (write `png` next to the files; set Point filtering to keep texels crisp).
import { paletteTexture, texelUv } from './png.js';

const PNG_NAME = 'palette.png';
const num = (v) => { const s = (Math.round(v * 1e6) / 1e6).toString(); return s === '-0' ? '0' : s; };

export function exportObj(model, opts = {}) {
  const { rgbOf, name = 'Body' } = opts;
  if (typeof rgbOf !== 'function') throw new Error('exportObj: opts.rgbOf(matKey) -> [r,g,b] is required');
  const { bones, mesh, matKeys } = model;
  const nq = mesh.quads;
  if (!nq) throw new Error('exportObj: empty mesh');
  if (matKeys.length > 256) throw new Error(`exportObj: ${matKeys.length} materials (max 256)`);
  if (bones.length !== mesh.ranges.length) throw new Error(`exportObj: ${bones.length} bones but ${mesh.ranges.length} mesh ranges`);
  const palette = matKeys.map((k) => {
    const c = rgbOf(k);
    if (!c || c.length < 3) throw new Error(`exportObj: rgbOf("${k}") gave no colour`);
    return c;
  });
  const tex = paletteTexture(palette);
  const mtlName = name + '.mtl';
  const out = [`# kestrel chargen OBJ, rest pose, metres, Y-up, +Z front`, `mtllib ${mtlName}`, `o ${name}`];
  for (let q = 0; q < nq; q++) { // one v / vn per quad corner, one vt per material texel
    for (let k = 0; k < 4; k++) {
      const a = 12 * q + 3 * k;
      out.push(`v ${num(-mesh.pos[a])} ${num(mesh.pos[a + 2])} ${num(-mesh.pos[a + 1])}`);
    }
  }
  for (let q = 0; q < nq; q++) {
    const a = 12 * q;
    out.push(`vn ${num(-mesh.nrm[a])} ${num(mesh.nrm[a + 2])} ${num(-mesh.nrm[a + 1])}`);
  }
  for (let m = 0; m < matKeys.length; m++) { const [u, v] = texelUv(m); out.push(`vt ${num(u)} ${num(1 - v)}`); }
  out.push('usemtl Palette', 's off');
  bones.forEach((b, bi) => {
    const r = mesh.ranges[bi];
    if (!r.count) return;
    out.push(`g ${b.name}`);
    for (let q = r.start; q < r.start + r.count; q++) {
      const m = mesh.mat[q] - 1;
      if (!(m >= 0 && m < matKeys.length)) throw new Error(`exportObj: quad ${q} has material ${mesh.mat[q]} outside matKeys`);
      const f = [0, 3, 2, 1].map((c) => `${4 * q + c + 1}/${m + 1}/${q + 1}`);
      out.push(`f ${f.join(' ')}`);
    }
  });
  const mtl = ['# kestrel chargen MTL', 'newmtl Palette', 'Ka 1 1 1', 'Kd 1 1 1', 'Ks 0 0 0', 'd 1', 'illum 1', `map_Kd ${PNG_NAME}`].join('\n') + '\n';
  return { obj: out.join('\n') + '\n', mtl, png: tex.png, mtlName, pngName: PNG_NAME };
}
