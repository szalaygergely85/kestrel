// @ts-check
// engine/render/gpu/device/webgpuFormats.js - WG-1b2 (docs/architecture.md 38.4/38.6). Pure helpers of
// GpuDeviceWebGPU (format map, vertex formats, readback row padding / de-padding). No GPU* globals: Node-tested.

/** `TextureDesc.format` -> WebGPU format + bytes per texel (38.4). `depth24` + `sampled` is handled by textureFormatFor. */
const FORMATS = {
  rgba32ui: { gpu: 'rgba32uint', bpp: 16, depth: false },
  r32ui: { gpu: 'r32uint', bpp: 4, depth: false },
  r8ui: { gpu: 'r8uint', bpp: 1, depth: false },
  rgba8: { gpu: 'rgba8unorm', bpp: 4, depth: false },
  rgba32f: { gpu: 'rgba32float', bpp: 16, depth: false }, // WG-3b: world geometry atlas (textureLoad only)
  rg8ui: { gpu: 'rg8uint', bpp: 2, depth: false }, // WG-3b: world flags atlas
  depth24: { gpu: 'depth24plus', bpp: 0, depth: true },
};

/**
 * @param {string} format TextureDesc.format @param {boolean} [sampled]
 * @returns {{gpu: string, bpp: number, depth: boolean}}
 */
export function textureFormatFor(format, sampled = false) {
  const f = /** @type {any} */ (FORMATS)[format];
  if (!f) throw new Error(`GpuDeviceWebGPU: unhandled texture format "${format}"`);
  if (format === 'depth24' && sampled) return { gpu: 'depth32float', bpp: 4, depth: true }; // copyable, textureLoad-able
  return f;
}

/** Pipeline `depthFormat` -> WebGPU depth format. @param {'depth24'|'depth32f'} d */
export function depthFormatFor(d) {
  if (d === 'depth24') return 'depth24plus';
  if (d === 'depth32f') return 'depth32float';
  throw new Error(`GpuDeviceWebGPU: unhandled depthFormat "${d}"`);
}

/** Vertex attribute -> WebGPU vertex format. @param {'float'|'uint'} type @param {number} components */
export function vertexFormatFor(type, components) {
  if (!(components >= 1 && components <= 4)) throw new Error(`GpuDeviceWebGPU: bad vertex component count ${components}`);
  const base = type === 'uint' ? 'uint32' : type === 'float' ? 'float32' : '';
  if (!base) throw new Error(`GpuDeviceWebGPU: unhandled vertex attribute type "${type}"`);
  return components === 1 ? base : `${base}x${components}`;
}

/** WebGPU `bytesPerRow` of a copy must be a multiple of 256. @param {number} n */
export function padTo256(n) { return Math.ceil(n / 256) * 256; }

/**
 * Copy the rows of a padded readback (`src`, `paddedRowBytes` per row) into tightly packed `out`.
 * @param {Uint8Array} src @param {number} paddedRowBytes @param {number} rowBytes @param {number} rows @param {ArrayBufferView} out
 */
export function depadRows(src, paddedRowBytes, rowBytes, rows, out) {
  if (out.byteLength < rowBytes * rows) throw new Error(`readback: out is ${out.byteLength} B, need ${rowBytes * rows}`);
  const dst = new Uint8Array(out.buffer, out.byteOffset, rowBytes * rows);
  if (paddedRowBytes === rowBytes) { dst.set(src.subarray(0, rowBytes * rows)); return; }
  for (let y = 0; y < rows; y++) dst.set(src.subarray(y * paddedRowBytes, y * paddedRowBytes + rowBytes), y * rowBytes);
}

/** Size a staging buffer for a readback rect. @param {number} w @param {number} h @param {number} bpp */
export function readbackLayout(w, h, bpp) {
  const rowBytes = w * bpp, paddedRowBytes = padTo256(rowBytes);
  return { rowBytes, paddedRowBytes, bufferBytes: paddedRowBytes * h };
}
