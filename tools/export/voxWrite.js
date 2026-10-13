// tools/export/voxWrite.js (CHARGEN-12, docs/architecture.md 38.29 item 6): MagicaVoxel .vox writer, split out of
// tools/vox-export.mjs the same way tools/voxParse.js was split from vox-import.mjs. Browser-safe (Uint8Array only, no Buffer/fs),
// deterministic. tools/vox-export.mjs builds its voxels and calls writeVoxSingle / writeVoxMulti (same bytes as before the split).
//
//   writeVoxSingle({size:[x,y,z], voxels:[{x,y,z,c}], palette}) -> Uint8Array   v150, one SIZE/XYZI, no scene graph
//   writeVoxMulti({parts:[{name, size, origin:[x,y,z], voxels, nodeName?}], palette}) -> Uint8Array
//       v200 scene graph: root nTRN -> nGRP -> per part nTRN(translation = origin + floor(size/2)) -> nSHP, + a named LAYR per part
//   exportVoxGrid(grid, {rgbOf}) -> Uint8Array   a chargen grid (composeCharacter output): one shape per bone, the nTRN of
//       shape i carries the bone name (_name); voxel colour = grid.mat (1-based matKeys index = palette index)
//   palette = array of up to 255 [r,g,b,a] entries (index i -> .vox colour i+1)
// Limits (errors, never clipped): palette <= 255 entries, every shape axis <= 256.
const enc = new TextEncoder();

export const MAX_VOX_AXIS = 256;
export const MAX_VOX_PALETTE = 255;

// ---- low-level RIFF / .vox chunk writers (mirror of voxParse.js's readers)
export function cat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
export function i32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n | 0, true);
  return b;
}
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
export function chunk(id, content) { return cat([ascii(id), u32(content.length), u32(0), content]); }
export function str(s) { const b = enc.encode(String(s)); return cat([u32(b.length), b]); }
export function dict(obj) {
  const keys = Object.keys(obj);
  const parts = [u32(keys.length)];
  for (const k of keys) { parts.push(str(k)); parts.push(str(obj[k])); }
  return cat(parts);
}
export function sizeChunk(sx, sy, sz) { return chunk('SIZE', cat([u32(sx), u32(sy), u32(sz)])); }
export function xyziChunk(voxels) {
  const body = new Uint8Array(4 + voxels.length * 4);
  new DataView(body.buffer).setUint32(0, voxels.length, true);
  voxels.forEach((v, i) => { const o = 4 + i * 4; body[o] = v.x; body[o + 1] = v.y; body[o + 2] = v.z; body[o + 3] = v.c; });
  return chunk('XYZI', body);
}
export function rgbaChunk(entries256) {
  const body = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const e = entries256[i] || [0, 0, 0, 0];
    body[i * 4] = e[0]; body[i * 4 + 1] = e[1]; body[i * 4 + 2] = e[2]; body[i * 4 + 3] = e[3];
  }
  return chunk('RGBA', body);
}
/** One nTRN node: single frame, translation only (identity rotation: the `_r` key is omitted). `name` -> node attribute `_name`. */
export function ntrnChunk(nodeId, childId, layerId, t, name) {
  const frame = dict({ _t: `${t[0]} ${t[1]} ${t[2]}` });
  return chunk('nTRN', cat([u32(nodeId), dict(name == null ? {} : { _name: name }), u32(childId), i32(-1), i32(layerId), u32(1), frame]));
}
export function ngrpChunk(nodeId, childIds) { return chunk('nGRP', cat([u32(nodeId), dict({}), u32(childIds.length), ...childIds.map(u32)])); }
export function nshpChunk(nodeId, modelId) { return chunk('nSHP', cat([u32(nodeId), dict({}), u32(1), u32(modelId), dict({})])); }
export function layrChunk(layerId, name) { return chunk('LAYR', cat([u32(layerId), dict({ _name: name }), i32(-1)])); }
export function mainChunk(childrenBuf) { return cat([ascii('MAIN'), u32(0), u32(childrenBuf.length), childrenBuf]); }
export function voxFile(version, mainBuf) { return cat([ascii('VOX '), u32(version), mainBuf]); }

function checkLimits(palette, sizes) {
  if (palette.length > MAX_VOX_PALETTE) throw new Error(`voxWrite: palette has ${palette.length} entries (max ${MAX_VOX_PALETTE})`);
  for (const s of sizes) if (s.some((a) => a > MAX_VOX_AXIS || a < 1)) throw new Error(`voxWrite: shape size ${s.join('x')} outside 1..${MAX_VOX_AXIS} per axis`);
}

export function writeVoxSingle({ size, voxels, palette }) {
  checkLimits(palette, [size]);
  return voxFile(150, mainChunk(cat([sizeChunk(...size), xyziChunk(voxels), rgbaChunk(palette)])));
}

export function writeVoxMulti({ parts, palette }) {
  checkLimits(palette, parts.map((p) => p.size));
  const models = [];
  parts.forEach((p) => { models.push(sizeChunk(...p.size)); models.push(xyziChunk(p.voxels)); });
  // node0 nTRN root -> node1 nGRP -> per part i: nTRN(2+2i, translation) -> nSHP(3+2i, model i) + LAYR(i)
  const scene = [ntrnChunk(0, 1, -1, [0, 0, 0]), ngrpChunk(1, parts.map((_, i) => 2 + i * 2))];
  parts.forEach((p, i) => {
    const t = p.origin.map((o, k) => o + Math.floor(p.size[k] / 2));
    scene.push(ntrnChunk(2 + i * 2, 3 + i * 2, i, t, p.nodeName));
    scene.push(nshpChunk(3 + i * 2, i));
  });
  parts.forEach((p, i) => scene.push(layrChunk(i, p.name)));
  return voxFile(200, mainChunk(cat([...models, rgbaChunk(palette), ...scene])));
}

/**
 * CHARGEN-22c (38.34): one dense grid at the finest chosen level F = max block k (1 without blocks). The main grid is
 * upsampled by F; a block of level k fills (F/k)^3 fine cells per block cell. No blocks -> the grid itself (same bytes as before).
 * Returns {size, mat, bone, F}.
 */
export function flattenGrid(grid) {
  const blocks = grid.blocks || [];
  const F = blocks.reduce((m, b) => Math.max(m, b.k), 1);
  if (F === 1) return { size: grid.size, mat: grid.mat, bone: grid.bone, F };
  const [sx, sy, sz] = grid.size, fx = sx * F, fy = sy * F, fz = sz * F;
  const mat = new Uint8Array(fx * fy * fz), bone = new Uint8Array(fx * fy * fz);
  const stamp = (x0, y0, z0, n, m, b) => {
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (x0 + x) + fx * ((y0 + y) + fy * (z0 + z)); mat[i] = m; bone[i] = b;
    }
  };
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++) if (grid.mat[i]) stamp(x * F, y * F, z * F, F, grid.mat[i], grid.bone[i]);
  for (const bl of blocks) {
    const [bx, by, bz] = bl.size, n = F / bl.k;
    for (let z = 0, i = 0; z < bz; z++) for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++, i++) {
      if (bl.mat[i]) stamp(bl.origin[0] * F + x * n, bl.origin[1] * F + y * n, bl.origin[2] * F + z * n, n, bl.mat[i], bl.bone[i]);
    }
  }
  return { size: [fx, fy, fz], mat, bone, F };
}

/** Chargen grid -> .vox with one shape per bone (empty bones are skipped; blocks are flattened to the finest level). Needs grid.{size, mat, bone, bones, matKeys}. */
export function exportVoxGrid(grid, { rgbOf }) {
  if (typeof rgbOf !== 'function') throw new Error('exportVoxGrid: opts.rgbOf(matKey) -> [r,g,b] is required');
  const { bones, matKeys } = grid;
  const { size, mat, bone } = flattenGrid(grid);
  const [sx, sy, sz] = size, nb = bones.length;
  const palette = matKeys.map((k) => {
    const c = rgbOf(k);
    if (!c || c.length < 3) throw new Error(`exportVoxGrid: rgbOf("${k}") gave no colour`);
    return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255];
  });
  const lo = new Int32Array(3 * nb).fill(1 << 30), hi = new Int32Array(3 * nb).fill(-1);
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++) {
    if (!mat[i]) continue;
    const b = 3 * bone[i], c = [x, y, z];
    for (let k = 0; k < 3; k++) { if (c[k] < lo[b + k]) lo[b + k] = c[k]; if (c[k] > hi[b + k]) hi[b + k] = c[k]; }
  }
  const parts = [];
  for (let b = 0; b < nb; b++) {
    if (hi[3 * b] < 0) continue;
    const o = [lo[3 * b], lo[3 * b + 1], lo[3 * b + 2]], s = o.map((v, k) => hi[3 * b + k] - v + 1), voxels = [];
    for (let z = o[2]; z < o[2] + s[2]; z++) for (let y = o[1]; y < o[1] + s[1]; y++) for (let x = o[0]; x < o[0] + s[0]; x++) {
      const i = x + sx * (y + sy * z);
      if (mat[i] && bone[i] === b) voxels.push({ x: x - o[0], y: y - o[1], z: z - o[2], c: mat[i] });
    }
    parts.push({ name: bones[b].name, nodeName: bones[b].name, size: s, origin: o, voxels });
  }
  return writeVoxMulti({ parts, palette });
}
