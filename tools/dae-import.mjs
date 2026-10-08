#!/usr/bin/env node
// TREES-LP-a (D-042 item 4, architecture 37.15): dependency-free Collada (.dae) static-mesh importer for the Kenney Nature Kit.
//   node tools/dae-import.mjs <in.dae> <id> [--out path] [--map design/meshes/kenney/palette-map.json]
//                             [--simplify <tris> | --budget] [--scale s] [--dry-run]
// Reads geometry (<triangles>/<polylist>/<polygons>), node transforms (matrix/translate/rotate/scale, nested),
// material -> effect diffuse colour -> palette key (CIE Lab nearest of the map file's reference colours; keys must exist in
// design/palette.js), bakes world-space triangles and hands them to engine buildMeshFromTris (shared with the glTF importer).
// Output: canonical content/meshes/<id>.mesh.json + withCollision (trees: trunk prism proxy, castShadow true).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeMeshFiles } from './mesh-file.mjs';
import { buildMeshFromTris, simplifyTriangles, meshToJSON, meshFromJSON, validateMesh } from '../engine/index.js';
import { budgetFor } from './mesh-budgets.mjs';
import { rgbToLab } from './uvmap.mjs';
import { withCollision, stringifyMeshJSON, loadEngineMaterialKeys } from './gltf-import.mjs';

const DEFAULT_MAP = fileURLToPath(new URL('../design/meshes/kenney/palette-map.json', import.meta.url));

// ---------------------------------------------------------------- minimal XML
/** @typedef {{tag:string, attrs:Record<string,string>, kids:XNode[], text:string}} XNode */
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
/** Parses XML text into a tree (namespace prefixes dropped; comments, PIs, DOCTYPE skipped; CDATA kept as text). */
export function parseXml(src) {
  const s = src.replace(/^﻿/, '');
  const root = { tag: '#root', attrs: {}, kids: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3] !== undefined) {
      const tag = m[3].replace(/^.*:/, '');
      if (m[2]) {
        if (stack.length < 2 || top.tag !== tag) throw new Error(`dae: mismatched </${tag}> (open: <${top.tag}>)`);
        stack.pop();
      } else {
        const attrs = {};
        for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1].replace(/^.*:/, '')] = (a[2] ?? a[3]).replace(/&\w+;/g, (e) => ENT[e] ?? e);
        const n = { tag, attrs, kids: [], text: '' };
        top.kids.push(n);
        if (!m[5]) stack.push(n);
      }
    } else if (m[6] !== undefined) top.text += m[6];
  }
  if (stack.length !== 1) throw new Error(`dae: unclosed <${stack[stack.length - 1].tag}>`);
  return root;
}
const kid = (n, tag) => n.kids.find((k) => k.tag === tag);
const kids = (n, tag) => n.kids.filter((k) => k.tag === tag);
const nums = (t) => t.trim().split(/\s+/).filter(Boolean).map(Number);
const refId = (u) => (u || '').replace(/^#/, '');

// ---------------------------------------------------------------- matrices (row-major 4x4, column vectors: p' = M p)
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
function nodeMatrix(node) {
  let m = I4();
  for (const k of node.kids) {
    let t = null;
    if (k.tag === 'matrix') { t = nums(k.text); if (t.length !== 16) throw new Error('dae: <matrix> needs 16 numbers'); }
    else if (k.tag === 'translate') { const [x, y, z] = nums(k.text); t = [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]; }
    else if (k.tag === 'scale') { const [x, y, z] = nums(k.text); t = [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]; }
    else if (k.tag === 'rotate') {
      const v = nums(k.text); const l = Math.hypot(v[0], v[1], v[2]) || 1; const [x, y, z] = [v[0] / l, v[1] / l, v[2] / l];
      const a = (v[3] * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), u = 1 - c;
      t = [c + x * x * u, x * y * u - z * s, x * z * u + y * s, 0, y * x * u + z * s, c + y * y * u, y * z * u - x * s, 0, z * x * u - y * s, z * y * u + x * s, c + z * z * u, 0, 0, 0, 0, 1];
    }
    if (t) m = mul(m, t);
  }
  return m;
}
const xform = (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

// ---------------------------------------------------------------- Collada reader
/**
 * @param {string} text .dae XML
 * @returns {{upAxis:string, unit:number, materials:Record<string,{name:string,rgb:number[]|null}>,
 *   instances:{geom:string, world:number[], bind:Record<string,string>, name:string}[],
 *   geoms:Record<string,{pos:number[][], prims:{matSymbol:string, tris:number[]}[]}>}}
 *   materials keyed by material id; prim `tris` = flat vertex indices into pos (polygons already fan-triangulated).
 */
export function readCollada(text) {
  const doc = parseXml(text);
  const col = kid(doc, 'COLLADA');
  if (!col) throw new Error('dae: no <COLLADA> root');
  const asset = kid(col, 'asset');
  const upAxis = (asset && kid(asset, 'up_axis') ? kid(asset, 'up_axis').text.trim() : 'Y_UP');
  const unitN = asset && kid(asset, 'unit');
  const unit = unitN && unitN.attrs.meter ? Number(unitN.attrs.meter) : 1;

  // effects: id -> diffuse rgb (0..255) or null (textured / none)
  const effects = {};
  const libE = kid(col, 'library_effects');
  for (const e of libE ? kids(libE, 'effect') : []) {
    let rgb = null;
    const walk = (n) => {
      if (n.tag === 'diffuse') { const c = kid(n, 'color'); if (c) rgb = nums(c.text).slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)); return; }
      n.kids.forEach(walk);
    };
    walk(e);
    effects[e.attrs.id] = rgb;
  }
  const materials = {};
  const libM = kid(col, 'library_materials');
  for (const m of libM ? kids(libM, 'material') : []) {
    const ie = kid(m, 'instance_effect');
    materials[m.attrs.id] = { name: m.attrs.name || m.attrs.id, rgb: ie ? effects[refId(ie.attrs.url)] ?? null : null };
  }

  const geoms = {};
  const libG = kid(col, 'library_geometries');
  for (const g of libG ? kids(libG, 'geometry') : []) {
    const mesh = kid(g, 'mesh');
    if (!mesh) continue;
    const sources = {};
    for (const s of kids(mesh, 'source')) {
      const fa = kid(s, 'float_array');
      if (!fa) continue;
      const tc = kid(s, 'technique_common');
      const acc = tc && kid(tc, 'accessor');
      sources[s.attrs.id] = { data: nums(fa.text), stride: acc ? Number(acc.attrs.stride || 1) : 3 };
    }
    const vtx = kid(mesh, 'vertices');
    const posInput = vtx && kids(vtx, 'input').find((i) => i.attrs.semantic === 'POSITION');
    if (!posInput) throw new Error(`dae: geometry ${g.attrs.id} has no <vertices> POSITION`);
    const ps = sources[refId(posInput.attrs.source)];
    if (!ps) throw new Error(`dae: geometry ${g.attrs.id}: POSITION source missing`);
    const pos = [];
    for (let i = 0; i + 2 < ps.data.length; i += ps.stride) pos.push([ps.data[i], ps.data[i + 1], ps.data[i + 2]]);
    const prims = [];
    for (const p of mesh.kids) {
      if (p.tag !== 'triangles' && p.tag !== 'polylist' && p.tag !== 'polygons') continue;
      const inputs = kids(p, 'input');
      const stride = Math.max(...inputs.map((i) => Number(i.attrs.offset || 0))) + 1;
      const vin = inputs.find((i) => i.attrs.semantic === 'VERTEX');
      if (!vin) throw new Error(`dae: <${p.tag}> in ${g.attrs.id} has no VERTEX input`);
      const vo = Number(vin.attrs.offset || 0);
      const corners = (arr) => { const o = []; for (let i = vo; i < arr.length; i += stride) o.push(arr[i]); return o; };
      const tris = [];
      const fan = (c) => { for (let i = 1; i + 1 < c.length; i++) tris.push(c[0], c[i], c[i + 1]); };
      if (p.tag === 'triangles') {
        tris.push(...corners(nums(kid(p, 'p').text)));
      } else if (p.tag === 'polylist') {
        const vc = nums(kid(p, 'vcount').text), c = corners(nums(kid(p, 'p').text));
        let at = 0;
        for (const n of vc) { fan(c.slice(at, at + n)); at += n; }
      } else {
        for (const pp of kids(p, 'p')) fan(corners(nums(pp.text))); // one polygon per <p>
      }
      if (tris.length % 3) throw new Error(`dae: <${p.tag}> in ${g.attrs.id}: index count not a multiple of 3`);
      prims.push({ matSymbol: p.attrs.material || '', tris });
    }
    geoms[g.attrs.id] = { pos, prims };
  }

  // visual scene: depth-first, accumulate node matrices
  const instances = [];
  const scene = kid(col, 'library_visual_scenes');
  const vs = scene && kids(scene, 'visual_scene')[0];
  const findMats = (x, out) => { if (x.tag === 'instance_material') out.push(x); x.kids.forEach((c) => findMats(c, out)); return out; };
  const visit = (n, parent) => {
    const world = mul(parent, nodeMatrix(n));
    for (const k of n.kids) {
      if (k.tag === 'instance_geometry') {
        const bind = {};
        for (const im of findMats(k, [])) bind[im.attrs.symbol] = refId(im.attrs.target);
        instances.push({ geom: refId(k.attrs.url), world, bind, name: n.attrs.name || n.attrs.id || '' });
      } else if (k.tag === 'node') visit(k, world);
    }
  };
  if (vs) for (const n of kids(vs, 'node')) visit(n, I4());
  if (!instances.length) throw new Error('dae: no <instance_geometry> in the visual scene');
  return { upAxis, unit, materials, instances, geoms };
}

// ---------------------------------------------------------------- colour -> palette key
/** Validates the map file ({version, maxDelta, keys:{palette_key:[r,g,b]}, byName?:{materialName:key}, trunk?:[key...], scale?}). */
export function loadMap(map) {
  const keys = Object.keys(map.keys || {});
  if (!keys.length) throw new Error('dae-import: palette map has no "keys"');
  for (const k of keys) if (!Array.isArray(map.keys[k]) || map.keys[k].length !== 3) throw new Error(`dae-import: map key "${k}" must be [r,g,b]`);
  return { keys, labs: keys.map((k) => rgbToLab(map.keys[k])), maxDelta: map.maxDelta ?? 40, byName: map.byName || {}, trunk: map.trunk || [] };
}
/** Palette key for a material: byName override, else Lab-nearest reference of the diffuse colour. Returns {key, delta}. */
export function keyForMaterial(tab, name, rgb) {
  if (tab.byName[name]) return { key: tab.byName[name], delta: 0 };
  if (!rgb) throw new Error(`dae-import: material "${name}" has no diffuse colour (add it to the map's byName)`);
  const lab = rgbToLab(rgb);
  let best = 0, bd = Infinity;
  tab.labs.forEach((l, i) => { const d = Math.hypot(l[0] - lab[0], l[1] - lab[1], l[2] - lab[2]); if (d < bd) { bd = d; best = i; } });
  return { key: tab.keys[best], delta: bd };
}

// ---------------------------------------------------------------- build
/**
 * Collada text -> MeshData (+ per-key report). `simplifyTo` reduces each key group proportionally (quadric collapse).
 * @param {string} text
 * @param {string} id
 * @param {{map:object, scale?:number, simplifyTo?:number}} opts
 */
export function importDae(text, id, opts) {
  const dae = readCollada(text);
  const tab = loadMap(opts.map);
  const scale = (opts.scale ?? 1) * dae.unit;
  const unmapped = [];
  /** per key: world positions (copied per instance) + tri indices */
  const groups = new Map(); // key -> {pos:number[][], idx:number[]}
  for (const inst of dae.instances) {
    const g = dae.geoms[inst.geom];
    if (!g) throw new Error(`dae-import: instance of unknown geometry "${inst.geom}"`);
    const mirrored = det3(inst.world) < 0;
    // Y_UP -> engine Z up: (x,y,z) -> (x,-z,y), same convention as the glTF importer
    const world = g.pos.map((p) => { const w = xform(inst.world, p[0], p[1], p[2]); return (dae.upAxis === 'Z_UP' ? w : [w[0], -w[2], w[1]]).map((v) => v * scale); });
    for (const prim of g.prims) {
      const matId = inst.bind[prim.matSymbol] || prim.matSymbol;
      const mat = dae.materials[matId];
      if (!mat) throw new Error(`dae-import: material "${prim.matSymbol}" not found`);
      const { key, delta } = keyForMaterial(tab, mat.name, mat.rgb);
      if (delta > tab.maxDelta) unmapped.push(`${mat.name} (dE ${delta.toFixed(0)} -> ${key})`);
      let grp = groups.get(key);
      if (!grp) groups.set(key, grp = { pos: [], idx: [] });
      const base = grp.pos.length;
      for (const p of world) grp.pos.push(p);
      for (let t = 0; t < prim.tris.length; t += 3) {
        const a = prim.tris[t], b = prim.tris[t + 1], c = prim.tris[t + 2];
        grp.idx.push(base + a, base + (mirrored ? c : b), base + (mirrored ? b : c));
      }
    }
  }
  const total = [...groups.values()].reduce((n, g) => n + g.idx.length / 3, 0);
  const allTris = [], primRanges = [];
  const emit = (target) => {
    allTris.length = 0; primRanges.length = 0;
    for (const [key, grp] of groups) {
      let pos = grp.pos, idx = grp.idx;
      if (target && target < total) {
        const want = Math.max(4, Math.round((idx.length / 3) * (target / total)));
        const red = simplifyTriangles(pos, idx, want); pos = red.positions; idx = red.idx;
      }
      const triStart = allTris.length;
      for (let t = 0; t < idx.length; t += 3) {
        const p0 = pos[idx[t]], p1 = pos[idx[t + 1]], p2 = pos[idx[t + 2]];
        const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(n[0], n[1], n[2]);
        if (l < 1e-12) continue; // degenerate (zero area)
        allTris.push({ p0, p1, p2, normal: [n[0] / l, n[1] / l, n[2] / l], matName: key, uv0: null, uv1: null, uv2: null });
      }
      primRanges.push({ part: key, triStart, triCount: allTris.length - triStart });
    }
  };
  emit(0);
  // grouped simplification rounds up per key (min 4 tris): tighten until the target is met
  let target = opts.simplifyTo || 0;
  if (target) emit(target);
  for (let it = 0; target && allTris.length > opts.simplifyTo && it < 6; it++) { target = Math.max(4, Math.round(target * (opts.simplifyTo / allTris.length) * 0.98)); emit(target); }
  const mesh = buildMeshFromTris(allTris, primRanges.filter((r) => r.triCount > 0), id, {});
  return { mesh, tab, report: { triCount: mesh.triCount, sourceTris: total, keys: [...groups.keys()], unmapped } };
}

/** Mesh -> canonical json (floats rounded to 1e-5, mats identity), with collision; trees get a trunk-only prism proxy. */
export function daeToJson(mesh, tab, materialKeys) {
  const json = { kind: 'mesh', schema: 1, id: mesh.id, nextId: 1, ...meshToJSON(mesh) };
  json.mats = Object.fromEntries(mesh.matKeys.map((k) => [k, k]));
  const missing = mesh.matKeys.filter((k) => materialKeys && !materialKeys.has(k));
  if (missing.length) throw new Error(`dae-import: palette keys missing in design/palette.js: ${missing.join(', ')} (NEEDS PC-A: designer)`);
  for (const key of ['pos', 'uv', 'aux', 'bbox']) json[key] = json[key].map((v) => Math.round(v * 1e5) / 1e5);
  const rounded = validateMesh(meshFromJSON(json));
  if (rounded.errors.length) throw new Error(`dae-import: mesh failed validateMesh:\n${rounded.errors.join('\n')}`);
  // trees: footprint from the trunk-key triangles only (recorded as `colliderParts`; withCollision does the rest)
  if (/tree/i.test(mesh.id.split('/').pop())) { const parts = mesh.matKeys.filter((k) => tab.trunk.includes(k)); if (parts.length) json.colliderParts = parts; }
  const out = withCollision(json);
  return out;
}

// ---------------------------------------------------------------- CLI
const HELP = `dae-import - Collada (.dae) static mesh -> content/meshes/<id>.mesh.json (TREES-LP-a)

Usage: node tools/dae-import.mjs <in.dae> <id> [--out path] [--map palette-map.json] [--simplify <tris> | --budget] [--scale s] [--dry-run]
  id example: kenney/tree_oak. --budget uses tools/mesh-budgets.mjs (basename). Default map: design/meshes/kenney/palette-map.json.
`;
export async function runCli(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--map') args.map = argv[++i];
    else if (a === '--simplify') { args.simplify = Number(argv[++i]); if (!(args.simplify >= 4)) throw new Error('--simplify needs a triangle target >= 4'); }
    else if (a === '--scale') { args.scale = Number(argv[++i]); if (!(args.scale > 0)) throw new Error('--scale needs a number > 0'); }
    else if (a === '--budget') args.budget = true;
    else if (a === '--dry-run') args.dryRun = true;
    else args._.push(a);
  }
  if (args.help || args._.length < 2) return { help: true, text: HELP };
  const [inPath, id] = args._;
  if (args.budget && !args.simplify) args.simplify = budgetFor(id) || 0;
  const map = JSON.parse(fs.readFileSync(args.map || DEFAULT_MAP, 'utf8'));
  const keys = await loadEngineMaterialKeys();
  const { mesh, tab, report } = importDae(fs.readFileSync(inPath, 'utf8'), id, { map, scale: args.scale ?? map.scale, simplifyTo: args.simplify });
  const json = daeToJson(mesh, tab, keys);
  const outPath = args.out || path.join('content', 'meshes', `${id}.mesh.json`);
  if (!args.dryRun) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); if (outPath.endsWith('.mesh.json')) writeMeshFiles(outPath, json); else fs.writeFileSync(outPath, stringifyMeshJSON(json), 'utf8'); } // MESH-BIN-01: meta + .mesh.bin
  return { help: false, wrote: args.dryRun ? null : outPath, report, json };
}
async function main() {
  try {
    const r = await runCli(process.argv.slice(2));
    if (r.help) { console.log(r.text); return; }
    const { report } = r;
    console.log(`dae-import: ${r.wrote || '(dry-run)'}: tris ${report.sourceTris} -> ${report.triCount}, keys ${report.keys.join(',')}, bbox ${r.json.bbox.join(' ')}`);
    if (report.unmapped.length) console.log(`dae-import: WARNING colours far from every map key: ${report.unmapped.join('; ')}`);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();
