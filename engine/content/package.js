// engine/content/package.js (KPKG-02, docs/architecture.md 38.30): the `.kestrel` package.
// A zip (zip.js) with a `kestrel.json` manifest + a content tree. Data only; no DOM.
import { ContentError } from './ContentError.js';
import { readZip, checkZipPath } from './zip.js';

export const KPKG_FORMAT = 'kestrel-package';
export const KPKG_FORMAT_VERSION = 1;
export const KPKG_SCHEME = 'kpkg://';
const ID_RE = /^[a-z][a-z0-9_.-]{2,63}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TYPE_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;
const CODE_EXT = /\.(m?js|cjs|wgsl|glsl|html?|wasm)$/i; // packages are data only (38.30 item 1)
const ASSET_ID_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SPDX_RE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/; // also matches LicenseRef-*

const fail = (file, field, reason) => { throw new ContentError(file, field, reason); };

/** '1.2.3' -> [1,2,3] or null. */
export function parseSemver(s) {
  const m = typeof s === 'string' ? SEMVER_RE.exec(s) : null;
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmp(a, b) { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }

/** Caret (`^1.2.0`) or exact (`1.2.0`) range; anything else -> null. Returns a predicate over parsed versions. */
export function parseRange(r) {
  if (typeof r !== 'string') return null;
  const caret = r.startsWith('^');
  const v = parseSemver(caret ? r.slice(1) : r);
  if (!v) return null;
  if (!caret) return (x) => cmp(x, v) === 0;
  // ^1.2.3 -> <2.0.0; ^0.2.3 -> <0.3.0; ^0.0.3 -> exactly 0.0.3
  const hi = v[0] > 0 ? [v[0] + 1, 0, 0] : v[1] > 0 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
  return (x) => cmp(x, v) >= 0 && cmp(x, hi) < 0;
}

/**
 * Validate a parsed kestrel.json. Throws ContentError (first problem). `paths` (optional
 * iterable of zip entry paths) additionally checks that every referenced file exists.
 * @param {any} obj
 * @param {{paths?: Set<string>|string[], file?: string}} [opts]
 * @returns {Object} the same object
 */
export function validatePackageManifest(obj, opts = {}) {
  const file = opts.file || 'kestrel.json';
  const paths = opts.paths ? (opts.paths instanceof Set ? opts.paths : new Set(opts.paths)) : null;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail(file, '(root)', 'expected an object');
  if (obj.format !== KPKG_FORMAT) fail(file, 'format', `expected "${KPKG_FORMAT}", got ${JSON.stringify(obj.format)}`);
  if (!Number.isInteger(obj.formatVersion) || obj.formatVersion < 1) fail(file, 'formatVersion', 'must be a positive integer');
  if (obj.formatVersion > KPKG_FORMAT_VERSION) fail(file, 'formatVersion', `${obj.formatVersion} is newer than the supported ${KPKG_FORMAT_VERSION}; update the game`);
  if (typeof obj.id !== 'string' || !ID_RE.test(obj.id)) fail(file, 'id', `must match ${ID_RE} (got ${JSON.stringify(obj.id)})`);
  if (typeof obj.name !== 'string' || !obj.name) fail(file, 'name', 'required non-empty string');
  if (!parseSemver(obj.version)) fail(file, 'version', `must be semver x.y.z (got ${JSON.stringify(obj.version)})`);
  const lic = obj.license;
  if (!lic || typeof lic !== 'object' || typeof lic.spdx !== 'string' || !lic.spdx) fail(file, 'license.spdx', 'required (SPDX id or LicenseRef-*)');
  if (!SPDX_RE.test(lic.spdx)) fail(file, 'license.spdx', `invalid SPDX id ${JSON.stringify(lic.spdx)}`);
  for (const k of ['file', 'attribution']) if (lic[k] !== undefined && typeof lic[k] !== 'string') fail(file, `license.${k}`, 'must be a string');
  if (obj.authors !== undefined && (!Array.isArray(obj.authors) || obj.authors.some((a) => typeof a !== 'string'))) fail(file, 'authors', 'must be an array of strings');
  const need = (field, p) => {
    if (typeof p !== 'string') fail(file, field, 'must be a string path');
    try { checkZipPath(p); } catch (e) { fail(file, field, e.reason || e.message); }
    if (CODE_EXT.test(p)) fail(file, field, `"${p}": packages are data only (no scripts/shaders)`);
    if (paths && !paths.has(p)) fail(file, field, `"${p}" is not in the package`);
  };
  const deps = obj.dependencies === undefined ? [] : obj.dependencies;
  if (!Array.isArray(deps)) fail(file, 'dependencies', 'must be an array');
  const depIds = new Set();
  deps.forEach((d, i) => {
    if (!d || typeof d.id !== 'string' || !ID_RE.test(d.id)) fail(file, `dependencies[${i}].id`, 'bad package id');
    if (!parseRange(d.version)) fail(file, `dependencies[${i}].version`, `caret (^1.0.0) or exact (1.0.0) only, got ${JSON.stringify(d.version)}`);
    if (d.id === obj.id) fail(file, `dependencies[${i}].id`, 'a package cannot depend on itself');
    if (depIds.has(d.id)) fail(file, `dependencies[${i}].id`, `duplicate dependency "${d.id}"`);
    depIds.add(d.id);
  });
  if (obj.contentSchema !== undefined && (typeof obj.contentSchema !== 'object' || obj.contentSchema === null
      || Object.values(obj.contentSchema).some((v) => !Number.isInteger(v) || v < 1))) fail(file, 'contentSchema', 'must map kind -> positive integer');
  if (lic.file !== undefined) need('license.file', lic.file);
  if (obj.content !== undefined) need('content', obj.content);
  if (obj.thumbnail !== undefined) { need('thumbnail', obj.thumbnail); if (!obj.thumbnail.endsWith('.png')) fail(file, 'thumbnail', 'must be a .png'); }
  const assets = obj.assets === undefined ? [] : obj.assets;
  if (!Array.isArray(assets)) fail(file, 'assets', 'must be an array');
  const seen = new Set();
  const seenId = new Set();
  assets.forEach((a, i) => {
    const f = `assets[${i}]`;
    if (!a || typeof a !== 'object') fail(file, f, 'expected an object');
    need(`${f}.path`, a.path);
    if (seen.has(a.path)) fail(file, `${f}.path`, `duplicate asset path "${a.path}"`);
    seen.add(a.path);
    if (typeof a.type !== 'string' || !TYPE_RE.test(a.type)) fail(file, `${f}.type`, `bad asset type ${JSON.stringify(a.type)}`);
    if (a.id !== undefined) {
      if (typeof a.id !== 'string' || !ASSET_ID_RE.test(a.id)) fail(file, `${f}.id`, `bad asset id ${JSON.stringify(a.id)}`);
      const key = `${a.type}:${a.id}`;
      if (seenId.has(key)) fail(file, `${f}.id`, `duplicate ${a.type} id "${a.id}" in this package`);
      seenId.add(key);
    }
    if (a.thumb !== undefined) { need(`${f}.thumb`, a.thumb); if (!a.thumb.endsWith('.png')) fail(file, `${f}.thumb`, 'must be a .png'); }
  });
  return obj;
}

/**
 * @typedef {Object} KPackage
 * @property {string} id
 * @property {Object} manifest
 * @property {string[]} paths
 * @property {(p:string)=>boolean} has
 * @property {(p:string)=>Promise<Uint8Array>} readBytes
 * @property {(p:string)=>Promise<string>} readText
 */

/** Open + validate a `.kestrel` package from its bytes. @returns {Promise<KPackage>} */
const SCRIPT_EXT = /\.(js|mjs|cjs|wgsl|glsl|html|wasm)$/i;

export async function openPackage(bytes, limits) {
  const zip = readZip(bytes, limits);
  if (!zip.has('kestrel.json')) fail('(package)', 'kestrel.json', 'missing manifest');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(await zip.read('kestrel.json'))); }
  catch (e) { fail('kestrel.json', 'json', e.message); }
  // data only (38.30 item 1): no script-type entry anywhere in the zip, referenced or not
  const script = zip.paths.find((p) => SCRIPT_EXT.test(p));
  if (script) fail(script, 'paths', 'script-type entries are not allowed in a package (data only)');
  validatePackageManifest(manifest, { paths: new Set(zip.paths) });
  return {
    id: manifest.id,
    manifest,
    paths: zip.paths,
    has: (p) => zip.has(p),
    readBytes: (p) => zip.read(p),
    readText: async (p) => new TextDecoder().decode(await zip.read(p)),
  };
}

/** Throws a ContentError for a missing / too-old package or the same package id twice. */
export function checkDependencies(pkgs) {
  const byId = new Map();
  for (const p of pkgs) {
    if (byId.has(p.id)) fail(`${KPKG_SCHEME}${p.id}`, 'id', `package id "${p.id}" is mounted twice`);
    byId.set(p.id, p);
  }
  for (const p of pkgs) {
    for (const d of p.manifest.dependencies || []) {
      const dep = byId.get(d.id);
      if (!dep) fail(`${KPKG_SCHEME}${p.id}`, 'dependencies', `missing dependency "${d.id}" ${d.version}`);
      if (!parseRange(d.version)(parseSemver(dep.manifest.version))) {
        fail(`${KPKG_SCHEME}${p.id}`, 'dependencies', `"${d.id}" ${dep.manifest.version} does not satisfy ${d.version} (too old or incompatible)`);
      }
    }
  }
}

/** The ids a package contributes: typed assets with an id, plus the `id` of each content file. */
async function contributedIds(p) {
  const out = new Map(); // key -> description
  for (const a of p.manifest.assets || []) if (a.id !== undefined) out.set(`${a.type}:${a.id}`, `${a.type} "${a.id}"`);
  const c = p.manifest.content;
  if (c && p.has(c)) {
    try {
      const m = JSON.parse(await p.readText(c));
      const dir = c.includes('/') ? c.slice(0, c.lastIndexOf('/') + 1) : '';
      for (const rel of [...(m.files || []), ...(m.masks || [])]) {
        const path = dir + rel;
        if (!path.endsWith('.json') || !p.has(path)) continue;
        try {
          const o = JSON.parse(await p.readText(path));
          if (o && typeof o.id === 'string' && o.kind) out.set(`content.${o.kind}:${o.id}`, `${o.kind} "${o.id}"`);
        } catch { /* the content loader reports unparsable files */ }
      }
    } catch { /* ditto for the manifest */ }
  }
  return out;
}

async function defaultFetchText(u) { const r = await fetch(u); if (!r.ok) throw new ContentError(u, 'fetch', `HTTP ${r.status}`); return r.text(); }
async function defaultFetchBytes(u) { const r = await fetch(u); if (!r.ok) throw new ContentError(u, 'fetch', `HTTP ${r.status}`); return r.arrayBuffer(); }

/**
 * Mount packages behind loadContentPack's injected fetchers: `kpkg://<id>/<path>` is served
 * from the package, any other URL goes to `fallback` ({fetchText, fetchBytes}).
 * Rejects (ContentError) missing/too-old dependencies and the same content id in two packages.
 * @param {KPackage[]} pkgs
 * @param {{fetchText?:Function, fetchBytes?:Function}} [fallback]
 */
export async function mountPackages(pkgs, fallback = {}) {
  checkDependencies(pkgs);
  const owner = new Map();
  for (const p of pkgs) {
    for (const [key, what] of await contributedIds(p)) {
      const prev = owner.get(key);
      if (prev) fail(`${KPKG_SCHEME}${p.id}`, 'id', `${what} is defined by both "${prev}" and "${p.id}"`);
      owner.set(key, p.id);
    }
  }
  const byId = new Map(pkgs.map((p) => [p.id, p]));
  const locate = (url) => {
    if (!url.startsWith(KPKG_SCHEME)) return null;
    const rest = url.slice(KPKG_SCHEME.length).split(/[?#]/)[0];
    const slash = rest.indexOf('/');
    const id = slash < 0 ? rest : rest.slice(0, slash);
    const pkg = byId.get(id);
    if (!pkg) throw new ContentError(url, 'fetch', `package "${id}" is not mounted`);
    let path;
    try { path = decodeURIComponent(slash < 0 ? '' : rest.slice(slash + 1)); } catch { path = ''; }
    if (!pkg.has(path)) throw new ContentError(url, 'fetch', `"${path}" is not in package "${id}"`);
    return { pkg, path };
  };
  return {
    fetchText: async (url) => { const l = locate(url); return l ? l.pkg.readText(l.path) : (fallback.fetchText || defaultFetchText)(url); },
    fetchBytes: async (url) => { const l = locate(url); return l ? l.pkg.readBytes(l.path) : (fallback.fetchBytes || defaultFetchBytes)(url); },
    /** `kpkg://<id>/<content manifest>` for loadContentPack, or null. */
    manifestUrl: (id) => { const p = byId.get(id); return p && p.manifest.content ? `${KPKG_SCHEME}${id}/${p.manifest.content}` : null; },
  };
}
