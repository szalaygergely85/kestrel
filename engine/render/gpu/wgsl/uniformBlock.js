// @ts-check
// engine/render/gpu/wgsl/uniformBlock.js - WG-1b1 (docs/architecture.md 38.3/38.4). Pure, Node-tested: a field
// table -> WGSL `struct` text + byte/word offsets (WGSL uniform address-space layout rules) + the 256-byte
// aligned per-frame uniform ring both the WebGPU device and Node tests use. No GPU* globals here.
//
// Layout rules implemented (WGSL spec "memory layout", uniform space):
//   f32/i32/u32: size 4, align 4     vec2: size 8, align 8     vec3: size 12, align 16 (a following f32 packs at +12)
//   vec4: size 16, align 16          mat4x4f: size 64, align 16
//   arrays: only `vec4`/`mat4` elements (uniform array stride must be a multiple of 16: arch 38.4 "array<vec4f,N>"),
//   array align 16, stride = element size. Struct align 16, struct size rounded up to 16.

/** @typedef {'f32'|'i32'|'u32'|'vec2'|'vec3'|'vec4'|'mat4'} UniformType */
/** @typedef {{name: string, type: UniformType, count?: number}} UniformField */
/** @typedef {{name: string, type: UniformType, count: number, isArray: boolean, offset: number, word: number, words: number}} UniformFieldInfo */

const TYPES = {
  f32: { size: 4, align: 4, wgsl: 'f32' },
  i32: { size: 4, align: 4, wgsl: 'i32' },
  u32: { size: 4, align: 4, wgsl: 'u32' },
  vec2: { size: 8, align: 8, wgsl: 'vec2f' },
  vec3: { size: 12, align: 16, wgsl: 'vec3f' },
  vec4: { size: 16, align: 16, wgsl: 'vec4f' },
  mat4: { size: 64, align: 16, wgsl: 'mat4x4f' },
};

/** Dynamic-offset alignment of a WebGPU uniform binding (minUniformBufferOffsetAlignment default). */
export const UNIFORM_SLOT_ALIGN = 256;

/** @param {number} n @param {number} a */
export function alignUp(n, a) { return Math.ceil(n / a) * a; }

/**
 * @param {string} name WGSL struct name
 * @param {UniformField[]} fields
 */
export function defineUniformBlock(name, fields) {
  /** @type {UniformFieldInfo[]} */
  const infos = [];
  /** @type {Record<string, UniformFieldInfo>} */
  const byName = {};
  const lines = [];
  let offset = 0;
  for (const f of fields) {
    const t = TYPES[f.type];
    if (!t) throw new Error(`uniformBlock ${name}.${f.name}: unknown type "${f.type}"`);
    if (byName[f.name]) throw new Error(`uniformBlock ${name}: duplicate field "${f.name}"`);
    const isArray = f.count !== undefined;
    const count = isArray ? /** @type {number} */ (f.count) : 1;
    if (isArray && (!Number.isInteger(count) || count < 1)) throw new Error(`uniformBlock ${name}.${f.name}: bad array count ${count}`);
    let align = t.align, size = t.size;
    if (isArray) {
      if (f.type !== 'vec4' && f.type !== 'mat4') throw new Error(`uniformBlock ${name}.${f.name}: uniform arrays must be vec4/mat4 elements (stride multiple of 16)`);
      align = 16; size = t.size * count;
    }
    offset = alignUp(offset, align);
    /** @type {UniformFieldInfo} */
    const info = { name: f.name, type: f.type, count, isArray, offset, word: offset / 4, words: (t.size / 4) * count };
    infos.push(info); byName[f.name] = info;
    lines.push(`  ${f.name}: ${isArray ? `array<${t.wgsl}, ${count}>` : t.wgsl},`);
    offset += size;
  }
  const sizeBytes = alignUp(offset, 16);
  const wgsl = `struct ${name} {\n${lines.join('\n')}\n};`;
  return {
    name, wgsl, sizeBytes, sizeWords: sizeBytes / 4,
    fields: infos,
    /** Field info by name (init-time only: hot paths use the cached `.word` number). @param {string} n */
    field(n) { const i = byName[n]; if (!i) throw new Error(`uniformBlock ${name}: no field "${n}"`); return i; },
    /** Typed views over `buffer` for one block instance at `byteOffset` (init-time; keep the views). @param {ArrayBuffer} buffer */
    createViews(buffer, byteOffset = 0) {
      if (byteOffset % 4 !== 0) throw new Error('uniformBlock.createViews: byteOffset must be 4-aligned');
      const n = sizeBytes / 4;
      return { f32: new Float32Array(buffer, byteOffset, n), i32: new Int32Array(buffer, byteOffset, n), u32: new Uint32Array(buffer, byteOffset, n) };
    },
  };
}

/**
 * Per-frame uniform ring (arch 38.4): one CPU ArrayBuffer of `slots` 256-byte-aligned slots, whole-buffer typed
 * views (zero allocation per draw: callers write at `word(byteOffset) + field.word`), overflow throws, never grows.
 * The device does one `writeBuffer` of `[0, usedBytes)` at submit.
 * @param {number} slots
 * @param {number} [slotBytes] multiple of 256 (every block must fit one slot)
 */
export function createUniformRing(slots, slotBytes = UNIFORM_SLOT_ALIGN) {
  if (slotBytes % UNIFORM_SLOT_ALIGN !== 0) throw new Error('createUniformRing: slotBytes must be a multiple of 256');
  const buffer = new ArrayBuffer(slots * slotBytes);
  let used = 0;
  return {
    buffer, slots, slotBytes,
    f32: new Float32Array(buffer), i32: new Int32Array(buffer), u32: new Uint32Array(buffer),
    /** Reserve one slot for a block of `sizeBytes`; returns its byte offset (the dynamic offset). @param {number} sizeBytes */
    alloc(sizeBytes) {
      if (sizeBytes > slotBytes) throw new Error(`uniform ring: block of ${sizeBytes} B exceeds slot ${slotBytes} B`);
      if (used >= slots) throw new Error(`uniform ring overflow (${slots} slots)`);
      return (used++) * slotBytes;
    },
    reset() { used = 0; },
    get usedSlots() { return used; },
    get usedBytes() { return used * slotBytes; },
    /** Word index of a slot byte offset in the f32/i32/u32 views. @param {number} byteOffset */
    word(byteOffset) { return byteOffset >> 2; },
  };
}
