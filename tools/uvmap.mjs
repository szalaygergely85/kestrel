// MESH-UVMAP-01: per-triangle palette keys from a glTF colour texture (design/meshes/quaternius/palette-map.json).
// classifier(img, table) -> { rank(uv0,uv1,uv2) } ; deterministic (Lab distance, ties -> first key of the table).
import { samplePng } from './png-read.mjs';

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** sRGB [r,g,b] 0..255 -> CIE Lab (D65). */
export function rgbToLab(rgb) {
  const r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Table entry for a texture name ("Rocks_Diffuse"), validated (1..6 keys, or map.maxKeys; rgb triples). */
export function textureTable(map, texName) {
  const t = map.textures && map.textures[texName];
  if (!t) throw new Error(`uvmap: palette-map has no entry for texture "${texName}" (have: ${Object.keys(map.textures || {}).join(', ')})`);
  const keys = Object.keys(t);
  const maxKeys = map.maxKeys ?? 6; // CHAR-COL-01: a map may raise the per-texture key cap (character atlases)
  if (!keys.length || keys.length > maxKeys) throw new Error(`uvmap: texture "${texName}" lists ${keys.length} keys (1..${maxKeys} allowed)`);
  for (const k of keys) if (!Array.isArray(t[k]) || t[k].length !== 3) throw new Error(`uvmap: "${texName}".${k} must be [r,g,b]`);
  return { keys, labs: keys.map((k) => rgbToLab(t[k])), maxDelta: map.maxDelta ?? 28 };
}

/** Samples `img` at the triangle's centroid UV; returns { rgb, order: key indices nearest first, d: distance to nearest }. */
export function classify(img, tab, u0, u1, u2) {
  const rgb = samplePng(img, (u0[0] + u1[0] + u2[0]) / 3, (u0[1] + u1[1] + u2[1]) / 3);
  const lab = rgbToLab(rgb);
  const ds = tab.labs.map((l, i) => [dist(l, lab), i]);
  ds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { rgb, order: ds.map((e) => e[1]), d: ds[0][0] };
}
