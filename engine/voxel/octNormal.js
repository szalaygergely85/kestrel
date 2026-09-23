// engine/voxel/octNormal.js - US-039 octahedral normal packing (architecture.md
// 15.1 "Packed normal (face 7)"). Deterministic, allocation-free (no `new`,
// literals, closures, `for..of` or destructuring - tech notes item 5).
// `Math.round` is never used for the quantisation (GLSL can't mirror its
// round-half-to-even on some platforms); `floor(x + 0.5)` instead.

/**
 * Encodes a (not necessarily unit) normal as a packed uint32 (qx | qy<<16),
 * each 16 bits, via the standard octahedral map folded into the +z
 * hemisphere.
 */
export function packNormalOct(nx, ny, nz) {
  const s = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
  let x = nx / s;
  let y = ny / s;
  const z = nz / s;
  if (z < 0) {
    const ax = Math.abs(x), ay = Math.abs(y);
    const sx = x >= 0 ? 1 : -1;
    const sy = y >= 0 ? 1 : -1;
    const nxp = (1 - ay) * sx;
    const nyp = (1 - ax) * sy;
    x = nxp;
    y = nyp;
  }
  let qx = Math.floor((x * 0.5 + 0.5) * 65535 + 0.5);
  let qy = Math.floor((y * 0.5 + 0.5) * 65535 + 0.5);
  if (qx < 0) qx = 0; else if (qx > 65535) qx = 65535;
  if (qy < 0) qy = 0; else if (qy > 65535) qy = 65535;
  return (qx | (qy << 16)) >>> 0;
}

/** Decodes `bits` back into a unit normal, written into `out` (length >= 3). */
export function unpackNormalOct(bits, out) {
  const qx = bits & 0xFFFF;
  const qy = (bits >>> 16) & 0xFFFF;
  let x = (qx / 65535) * 2 - 1;
  let y = (qy / 65535) * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ax = Math.abs(x), ay = Math.abs(y);
    const sx = x >= 0 ? 1 : -1;
    const sy = y >= 0 ? 1 : -1;
    const ox = (1 - ay) * sx;
    const oy = (1 - ax) * sy;
    x = ox;
    y = oy;
  }
  const len = Math.sqrt(x * x + y * y + z * z);
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
}
