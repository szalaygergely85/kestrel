#!/usr/bin/env node
// KPKG-03 (docs/architecture.md 38.30 item 4): build a `.kestrel` package.
//
//   node tools/pack.mjs content/packages/<id>.pkg.json [--out dist]   spec -> dist/<id>-<version>.kestrel
//   node tools/pack.mjs <dir> [--out dist]                              dir with kestrel.json -> package (verbatim)
//
// Spec (*.pkg.json): the kestrel.json fields (id, name, version, license, authors, dependencies,
// contentSchema, thumbnail, assets, ...; `format`/`formatVersion` are added) plus
//   "entries": [{"from":"content","to":"content","exclude":["editor/**","*.js"]}, ...]
// `from` is a repo-relative file or directory, `to` the path inside the zip. Globs: `*` (no `/`), `**`.
// A glob without `/` matches the file name in any folder.
// "content": true in the spec is replaced by "content/manifest.json" if that entry exists.
// Output is byte-deterministic (zip.js) and the result is re-opened with openPackage before it is written.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, openPackage, KPKG_FORMAT, KPKG_FORMAT_VERSION } from '../engine/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toPosix = (p) => p.split(path.sep).join('/');

function globToRe(g) {
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { s += '.*'; i++; if (g[i + 1] === '/') i++; } else s += '[^/]*';
    } else s += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + s + '$');
}

function walk(dir, rel, out) {
  const ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const ent of ents) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walk(path.join(dir, ent.name), r, out);
    else if (ent.isFile()) out.push(r);
  }
}

/** Expand the spec `entries` into [{path, bytes}] (zip paths). */
export function collectEntries(spec, root = REPO_ROOT) {
  const files = new Map();
  (spec.entries || []).forEach((e, i) => {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') throw new Error(`entries[${i}]: need string "from" and "to"`);
    const abs = path.resolve(root, e.from);
    if (!fs.existsSync(abs)) throw new Error(`entries[${i}]: "${e.from}" does not exist`);
    const ex = (e.exclude || []).map((g) => [globToRe(g), !g.includes('/')]);
    const rels = [];
    if (fs.statSync(abs).isDirectory()) walk(abs, '', rels); else rels.push('');
    for (const r of rels) {
      if (r && ex.some(([re, base]) => re.test(base ? r.split('/').pop() : r))) continue;
      const zp = r ? (e.to ? e.to + '/' + r : r) : e.to;
      if (files.has(zp)) throw new Error(`entries[${i}]: duplicate zip path "${zp}"`);
      const b = fs.readFileSync(r ? path.join(abs, r) : abs);
      files.set(zp, new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
    }
  });
  return [...files].map(([p, bytes]) => ({ path: p, bytes }));
}

/** Build the kestrel.json text from a spec + the collected zip paths. */
export function buildManifest(spec, paths) {
  const m = { format: KPKG_FORMAT, formatVersion: KPKG_FORMAT_VERSION };
  for (const [k, v] of Object.entries(spec)) if (k !== 'entries') m[k] = v;
  if (m.content === true) {
    if (paths.has('content/manifest.json')) m.content = 'content/manifest.json'; else delete m.content;
  }
  return JSON.stringify(m, null, 2) + '\n';
}

/** Spec object -> package bytes. */
export async function packSpec(spec, root = REPO_ROOT) {
  const entries = collectEntries(spec, root);
  const paths = new Set(entries.map((e) => e.path));
  if (paths.has('kestrel.json')) throw new Error('spec entries must not contain kestrel.json (it is generated)');
  entries.push({ path: 'kestrel.json', bytes: new TextEncoder().encode(buildManifest(spec, paths)) });
  const bytes = await writeZip(entries);
  await openPackage(bytes); // validates the manifest + every referenced path
  return bytes;
}

/** Directory that already holds kestrel.json (e.g. from unpack.mjs) -> package bytes. */
export async function packDir(dir) {
  const rels = [];
  walk(dir, '', rels);
  if (!rels.includes('kestrel.json')) throw new Error(`${dir}: no kestrel.json`);
  const entries = rels.map((r) => {
    const b = fs.readFileSync(path.join(dir, r));
    return { path: r, bytes: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) };
  });
  const bytes = await writeZip(entries);
  await openPackage(bytes);
  return bytes;
}

/** CLI target (spec file or directory) -> {name, bytes}. */
export async function packTarget(target, root = REPO_ROOT) {
  const abs = path.resolve(target);
  if (fs.statSync(abs).isDirectory()) {
    const m = JSON.parse(fs.readFileSync(path.join(abs, 'kestrel.json'), 'utf8'));
    return { name: `${m.id}-${m.version}.kestrel`, bytes: await packDir(abs) };
  }
  const spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return { name: `${spec.id}-${spec.version}.kestrel`, bytes: await packSpec(spec, root) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let out = path.join(REPO_ROOT, 'dist');
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = path.resolve(args[++i]); else targets.push(args[i]);
  }
  if (!targets.length) { console.error('usage: node tools/pack.mjs <spec.pkg.json | dir> [--out dist]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  for (const t of targets) {
    try {
      const { name, bytes } = await packTarget(t);
      fs.writeFileSync(path.join(out, name), bytes);
      console.log(`${toPosix(path.relative(process.cwd(), path.join(out, name)))}  ${(bytes.length / 1024).toFixed(0)} KB`);
    } catch (e) { console.error(`pack ${t}: ${e.message}`); process.exit(1); }
  }
}
