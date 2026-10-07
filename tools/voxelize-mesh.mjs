#!/usr/bin/env node
// EXPERIMENT (owner look test, not game content): surface-voxelize an ORIGINAL full-detail glTF into our VoxelModelDef.
//   node tools/voxelize-mesh.mjs [--out design/models/_preview_voxelized.js] [--res 24,48,96] [Name ...]
// Every triangle is point-sampled (spacing < cell/2, so no holes); each sample picks a palette key from the glTF
// colour texture (MESH-UVMAP-01 Lab classifier, design/meshes/quaternius/palette-map.json); a voxel takes the
// majority key. glTF Y-up -> model Z-up (x, -z, y). Output sets ASSETS.voxelModels.vx_<Name>_<res> (+ .preview.rgb).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPng } from './png-read.mjs';
import { textureTable, classify } from './uvmap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLTF_DIR = path.join(ROOT, 'design/meshes/quaternius/glTF');
const CHARS = 'abcdef';
export const DEFAULT_MODELS = ['DeadTree_1', 'Rock_Medium_1'];

/** Reads a glTF: { pos: Float32Array, uv: Float32Array, idx: Uint32Array, texName, texFile }. */
export function loadGltf(name, dir = GLTF_DIR) {
  const g = JSON.parse(fs.readFileSync(path.join(dir, name + '.gltf'), 'utf8'));
  const bin = fs.readFileSync(path.join(dir, g.buffers[0].uri));
  const prim = g.meshes[0].primitives[0];
  const acc = (i) => {
    const a = g.accessors[i], bv = g.bufferViews[a.bufferView], n = { VEC2: 2, VEC3: 3, VEC4: 4, SCALAR: 1 }[a.type];
    const off = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const T = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    return new T(bin.buffer.slice(off, off + a.count * n * T.BYTES_PER_ELEMENT));
  };
  const img = g.images[g.textures[g.materials[prim.material].pbrMetallicRoughness.baseColorTexture.index].source];
  return { pos: acc(prim.attributes.POSITION), uv: acc(prim.attributes.TEXCOORD_0), idx: Uint32Array.from(acc(prim.indices)), texName: img.name, texFile: path.join(dir, img.uri) };
}

/** Surface voxelization at `res` voxels on the longest side. Returns { size, vox: Map idx->key index, s }. */
export function voxelize(mesh, tab, img, res) {
  const { pos, uv, idx } = mesh;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[i + a]); mx[a] = Math.max(mx[a], pos[i + a]); }
  const ext = [mx[0] - mn[0], mx[2] - mn[2], mx[1] - mn[1]]; // model x, y (= glTF z), z (= glTF y)
  const s = res / Math.max(...ext); // voxels per metre
  const size = ext.map((e) => Math.max(1, Math.ceil(e * s - 1e-6)));
  const votes = new Map();
  const P = (v) => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], U = (v) => [uv[v * 2], uv[v * 2 + 1]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = P(idx[t]), b = P(idx[t + 1]), c = P(idx[t + 2]);
    const ua = U(idx[t]), ub = U(idx[t + 1]), uc = U(idx[t + 2]);
    const L = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
    const n = Math.max(1, Math.ceil(L * s * 2.2));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const w1 = i / n, w2 = j / n, w0 = 1 - w1 - w2;
      const x = w0 * a[0] + w1 * b[0] + w2 * c[0] - mn[0], y = w0 * a[1] + w1 * b[1] + w2 * c[1] - mn[1], z = w0 * a[2] + w1 * b[2] + w2 * c[2] - mn[2];
      const vx = Math.min(size[0] - 1, Math.floor(x * s)), vy = Math.min(size[1] - 1, Math.floor((ext[1] - z) * s)), vz = Math.min(size[2] - 1, Math.floor(y * s));
      const u = [w0 * ua[0] + w1 * ub[0] + w2 * uc[0], w0 * ua[1] + w1 * ub[1] + w2 * uc[1]];
      const k = classify(img, tab, u, u, u).order[0];
      const id = (vz * size[1] + vy) * size[0] + vx;
      let v = votes.get(id); if (!v) votes.set(id, v = new Array(tab.keys.length).fill(0));
      v[k]++;
    }
  }
  const vox = new Map();
  for (const [id, v] of votes) vox.set(id, v.indexOf(Math.max(...v)));
  return { size, vox, s };
}

/** VoxelModelDef (+ preview.rgb per mats char) from a voxelization. `keyRgb(key)` -> [r,g,b] 0..255. */
export function toModelDef(vz, tab, name, keyRgb) {
  const [sx, sy, sz] = vz.size;
  const used = [...new Set(vz.vox.values())].sort((a, b) => a - b);
  const mats = {}, rgb = {}, charOf = {};
  used.forEach((k, i) => { mats[CHARS[i]] = tab.keys[k]; charOf[k] = CHARS[i]; rgb[CHARS[i]] = keyRgb(tab.keys[k]); });
  const layers = [];
  for (let z = 0; z < sz; z++) {
    const rows = [];
    for (let y = 0; y < sy; y++) { let r = ''; for (let x = 0; x < sx; x++) { const k = vz.vox.get((z * sy + y) * sx + x); r += k === undefined ? '.' : charOf[k]; } rows.push(r); }
    layers.push(rows);
  }
  const fits = sx <= 32 && sy <= 32 && sz <= 32 && sx * sy * sz <= 4096 && sx + sy + sz <= 48;
  return {
    name, desc: 'EXPERIMENT surface voxelization of ' + name,
    voxel: { version: 1, ...(fits ? {} : { meshOnly: true }), cellM: +(1 / vz.s).toFixed(5), size: [sx, sy, sz], anchor: [sx / 2, sy / 2, 0], mats, layers, parts: { body: { box: [0, 0, 0, sx, sy, sz], pivot: [sx / 2, sy / 2, 0] } } },
    preview: { rgb, voxels: vz.vox.size },
  };
}

/** Palette key -> displayed RGB: palette base colour scaled by the key's texture-ref lightness vs the table mean. */
export function makeKeyRgb(palette, texRefs) {
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const mean = Object.values(texRefs).reduce((s, c) => s + lum(c), 0) / Object.keys(texRefs).length;
  return (key) => {
    const hex = palette.colors[palette.materials[key].base] || '#808080';
    const f = Math.min(1.6, Math.max(0.55, lum(texRefs[key]) / mean));
    return [1, 3, 5].map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
  };
}

export function run({ names = DEFAULT_MODELS, res = [24, 48, 96], out } = {}) {
  const palette = createRequire(import.meta.url)(path.join(ROOT, 'design/palette.js'));
  const map = JSON.parse(fs.readFileSync(path.join(GLTF_DIR, '..', 'palette-map.json'), 'utf8'));
  const models = {};
  for (const name of names) {
    const mesh = loadGltf(name);
    const tab = textureTable(map, mesh.texName), img = readPng(fs.readFileSync(mesh.texFile));
    const keyRgb = makeKeyRgb(palette, map.textures[mesh.texName]);
    for (const r of res) { const key = `vx_${name}_${r}`; models[key] = toModelDef(voxelize(mesh, tab, img, r), tab, key, keyRgb); }
  }
  if (out) {
    fs.writeFileSync(out, '// EXPERIMENT (tools/voxelize-mesh.mjs): voxelized Quaternius meshes for design/preview/voxelized-compare.html. Not game content.\n' +
      "(function (g) { var A = g.ASSETS = g.ASSETS || {}; A.voxelModels = A.voxelModels || {};\n  var M = " + JSON.stringify(models) + ";\n  for (var k in M) A.voxelModels[k] = M[k];\n})(typeof window !== 'undefined' ? window : globalThis);\n");
  }
  return models;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = process.argv.slice(2); let out = path.join(ROOT, 'design/models/_preview_voxelized.js'), res; const names = [];
  for (let i = 0; i < a.length; i++) { if (a[i] === '--out') out = path.resolve(a[++i]); else if (a[i] === '--res') res = a[++i].split(',').map(Number); else names.push(a[i]); }
  const m = run({ names: names.length ? names : undefined, res, out });
  for (const [k, d] of Object.entries(m)) console.log(`${k}: ${d.preview.voxels} voxels, size ${d.voxel.size.join('x')}${d.voxel.meshOnly ? ' meshOnly' : ''}, cell ${d.voxel.cellM} m`);
  console.log('wrote ' + out);
}
