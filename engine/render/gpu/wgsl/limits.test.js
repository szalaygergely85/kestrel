// S8-B2-01: every module in WGSL_MODULES stays inside the default WebGPU limits (static source analysis, no GPU).
// Run: node engine/render/gpu/wgsl/limits.test.js
// Limits (WebGPU defaults): 16 sampled textures / stage, 12 uniform buffers / stage, 8 storage buffers / stage,
// uniform block <= 64 KiB, 16 vertex attributes (locations 0..15), 8 colour targets (locations 0..7).
import assert from 'node:assert';
import { WGSL_MODULES } from './index.js';

export const LIMITS = Object.freeze({ textures: 16, uniformBuffers: 12, storageBuffers: 8, uniformBytes: 65536, vertexAttributes: 16, targets: 8 });

const strip = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// --- struct layout (WGSL host-shareable rules; only the types the engine uses) ------------------------------------
// split on commas outside <...> / (...)
function splitTop(text) {
  const out = []; let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '<' || ch === '(') depth++; else if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function structMap(src) {
  const out = new Map();
  for (const m of src.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g)) {
    out.set(m[1], splitTop(m[2]).map((f) => f.trim()).filter(Boolean).map((f) => {
      const [name, type] = f.replace(/@\w+(\([^)]*\))?\s*/g, '').split(/:\s*/);
      return { name: name.trim(), type: type.trim() };
    }));
  }
  return out;
}
const consts = (src) => new Map([...src.matchAll(/const\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(\d+)u?\s*;/g)].map((m) => [m[1], +m[2]]));

function sizeAlign(type, structs, k) {
  const scalar = /^(f32|i32|u32)$/.test(type);
  if (scalar) return { size: 4, align: 4 };
  let m = type.match(/^vec([234])(?:<(?:f32|i32|u32)>|[fiu])$/);
  if (m) { const n = +m[1]; return { size: n * 4, align: n === 2 ? 8 : 16 }; }
  m = type.match(/^mat([234])x([234])(?:<f32>|f)$/);
  if (m) { const cols = +m[1], rows = +m[2], colAlign = rows === 2 ? 8 : 16; return { size: cols * colAlign, align: colAlign }; }
  m = type.match(/^array<\s*(.+?)\s*,\s*(\w+)\s*>$/);
  if (m) {
    const el = sizeAlign(m[1], structs, k), n = /^\d+$/.test(m[2]) ? +m[2] : k.get(m[2]);
    if (n === undefined) throw new Error(`unknown array length ${m[2]}`);
    const stride = Math.ceil(el.size / el.align) * el.align;
    return { size: stride * n, align: el.align };
  }
  if (structs.has(type)) return structSize(type, structs, k);
  throw new Error(`unknown type ${type}`);
}
function structSize(name, structs, k) {
  let off = 0, maxAlign = 1;
  for (const f of structs.get(name)) {
    const { size, align } = sizeAlign(f.type, structs, k);
    off = Math.ceil(off / align) * align + size;
    maxAlign = Math.max(maxAlign, align);
  }
  return { size: Math.ceil(off / maxAlign) * maxAlign, align: maxAlign };
}

// --- per-module measurements --------------------------------------------------------------------------------------
function signature(src, fnName) {
  const m = src.match(new RegExp(`fn\\s+${fnName}\\s*\\(([^)]*(?:\\([^)]*\\)[^)]*)*)\\)\\s*(?:->\\s*([^{]+))?\\{`));
  return m ? { params: m[1], ret: (m[2] || '').trim() } : null;
}
function locationsOf(text) { return new Set([...text.matchAll(/@location\((\d+)\)/g)].map((m) => +m[1])); }
function structLocations(src, name) {
  const m = src.match(new RegExp(`struct\\s+${name}\\s*\\{([^}]*)\\}`));
  return m ? [...m[1].matchAll(/@location\((\d+)\)/g)].map((x) => +x[1]) : [];
}
function stageLocations(src, text) {
  const locs = locationsOf(text);
  for (const m of text.matchAll(/:\s*(\w+)/g)) for (const l of structLocations(src, m[1])) locs.add(l);
  if (/^\w+$/.test(text.trim())) for (const l of structLocations(src, text.trim())) locs.add(l);
  return locs;
}

export function measure(module) {
  const src = strip(module.code), structs = structMap(src), k = consts(src);
  const textures = [...src.matchAll(/var\s+\w+\s*:\s*texture_(?!storage)\w+/g)].length;
  const storageBuffers = [...src.matchAll(/var<storage[^>]*>/g)].length;
  const uniforms = [...src.matchAll(/var<uniform>\s+\w+\s*:\s*(\w+)/g)].map((m) => m[1]);
  const uniformBytes = Math.max(0, ...uniforms.map((u) => structSize(u, structs, k).size));
  const vs = signature(src, 'vs_main'), fsNames = [...src.matchAll(/@fragment\s+fn\s+(\w+)/g)].map((m) => m[1]);
  const vsLocs = vs ? stageLocations(src, vs.params) : new Set();
  let targets = 0;
  for (const n of fsNames) {
    const fs = signature(src, n);
    if (fs && fs.ret) for (const l of stageLocations(src, fs.ret.replace(/^@location\((\d+)\)\s*/, '@location($1) x: '))) targets = Math.max(targets, l + 1);
  }
  return { textures, storageBuffers, uniformBuffers: uniforms.length, uniformBytes, vertexAttributes: vsLocs.size, maxVertexLocation: Math.max(-1, ...vsLocs), targets };
}

const failures = [];
const rows = [];
for (const m of WGSL_MODULES) {
  let r;
  try { r = measure(m); } catch (e) { failures.push(`${m.name}: cannot measure (${e.message})`); continue; }
  rows.push({ name: m.name, ...r });
  if (r.textures > LIMITS.textures) failures.push(`${m.name}: ${r.textures} sampled textures, limit ${LIMITS.textures} (a patch added a texture binding?)`);
  if (r.uniformBuffers > LIMITS.uniformBuffers) failures.push(`${m.name}: ${r.uniformBuffers} uniform buffers, limit ${LIMITS.uniformBuffers}`);
  if (r.storageBuffers > LIMITS.storageBuffers) failures.push(`${m.name}: ${r.storageBuffers} storage buffers, limit ${LIMITS.storageBuffers}`);
  if (r.uniformBytes > LIMITS.uniformBytes) failures.push(`${m.name}: uniform block ${r.uniformBytes} B, limit ${LIMITS.uniformBytes}`);
  if (r.vertexAttributes > LIMITS.vertexAttributes || r.maxVertexLocation >= LIMITS.vertexAttributes) failures.push(`${m.name}: vertex attributes ${r.vertexAttributes} (max location ${r.maxVertexLocation}), limit ${LIMITS.vertexAttributes}`);
  if (r.targets > LIMITS.targets) failures.push(`${m.name}: ${r.targets} colour targets, limit ${LIMITS.targets}`);
}
if (failures.length) { console.error('WGSL limit failures:\n  ' + failures.join('\n  ')); process.exitCode = 1; }

// The checker itself must catch an over-limit patch with a readable message.
{
  const decls = Array.from({ length: 17 }, (_, i) => `@group(0) @binding(${i}) var t${i}: texture_2d<f32>;`).join('\n');
  assert.strictEqual(measure({ code: decls + '\n@fragment fn fs_main() -> @location(0) vec4f { return vec4f(0.0); }' }).textures, 17);
  const big = measure({ code: 'struct U { a: array<vec4f, 5000> };\n@group(0) @binding(0) var<uniform> u: U;' });
  assert.ok(big.uniformBytes > LIMITS.uniformBytes, 'big uniform block detected');
  const nine = measure({ code: 'struct O { ' + Array.from({ length: 9 }, (_, i) => `@location(${i}) c${i}: vec4f,`).join(' ') + ' };\n@fragment fn fs_main() -> O { var o: O; return o; }' });
  assert.strictEqual(nine.targets, 9);
  const vin = measure({ code: 'struct V { ' + Array.from({ length: 17 }, (_, i) => `@location(${i}) a${i}: f32,`).join(' ') + ' };\n@vertex fn vs_main(v: V) -> @builtin(position) vec4f { return vec4f(0.0); }' });
  assert.strictEqual(vin.vertexAttributes, 17);
  // arch 2026-10-08 (verdicts 12): inline @location params / returns (no struct) must be counted too
  const vinInline = measure({ code: '@vertex fn vs_main(' + Array.from({ length: 17 }, (_, i) => `@location(${i}) a${i}: f32`).join(', ') + ') -> @builtin(position) vec4f { return vec4f(0.0); }' });
  assert.strictEqual(vinInline.vertexAttributes, 17, 'inline vertex params counted');
  const fsInline = measure({ code: '@fragment fn fs_main() -> @location(8) vec4f { return vec4f(0.0); }' });
  assert.strictEqual(fsInline.targets, 9, 'inline fragment return location counted');
}
// Known anchors (guard against the parser silently returning zeros).
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
assert.strictEqual(by.shade.textures, 16, 'shade sits exactly at the 16-texture limit');
assert.ok(by.cull.storageBuffers >= 1 && by.rasterInstanced.vertexAttributes >= 7, 'anchors: cull storage, rasterInstanced attributes');
assert.ok(by.shade.uniformBytes > 0 && by.light.uniformBytes > 0, 'uniform sizes measured');
assert.ok(by.light.targets >= 1, 'anchor: light has an inline colour target (a regression to 0 = the location regex broke)');
if (!process.exitCode) {
  console.log('name'.padEnd(22) + 'tex uni sto uniB  vAttr tgt');
  for (const r of rows) console.log(r.name.padEnd(22) + [r.textures, r.uniformBuffers, r.storageBuffers].map((x) => String(x).padStart(3)).join(' ') + String(r.uniformBytes).padStart(6) + String(r.vertexAttributes).padStart(6) + String(r.targets).padStart(4));
  console.log(`wgsl/limits.test.js: ${rows.length} modules inside default WebGPU limits.`);
}
