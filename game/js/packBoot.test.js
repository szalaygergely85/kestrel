// CHARGEN-15 (38.33 item 5): loadBootBundle cases a-i with injected fetch + loadContentPack, packages built in memory.
import assert from 'node:assert/strict';
import { writeZip } from '../../engine/index.js';
import { loadKit, buildGlb } from '../../tools/chargen/export.mjs';
import { loadBootBundle } from './packBoot.js';

const kit = loadKit();
const glb = buildGlb(kit, kit.defaults).glb;
const enc = new TextEncoder();
const json = (o) => enc.encode(JSON.stringify(o));
const mk = async (id, { model, content, deps } = {}) => {
  const m = { format: 'kestrel-package', formatVersion: 1, id, name: id, version: '1.0.0', license: { spdx: 'MIT' }, assets: [] };
  const files = [];
  if (model) { m.assets.push({ path: 'm.glb', type: 'model.rigged', id: model }); files.push({ path: 'm.glb', bytes: glb }); }
  if (content) { m.content = 'content/manifest.json'; files.push({ path: 'content/manifest.json', bytes: json({ kind: 'manifest', files: [] }) }); }
  if (deps) m.dependencies = deps;
  return writeZip([{ path: 'kestrel.json', bytes: json(m) }, ...files]);
};
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => String(body), arrayBuffer: async () => body });
const mkFetch = (files) => async (u) => (u in files ? resp(200, files[u]) : resp(404, ''));
const loadContentPack = async (url, o) => ({ loadedFrom: url, custom: !!o.fetchText });
const run = (query, files, log) => loadBootBundle(new URLSearchParams(query), { fetch: mkFetch(files), loadContentPack }, log);
const IDX = '../content/packages/index.json';
const idx = (...packages) => JSON.stringify({ format: 'kestrel-addons', formatVersion: 1, packages });
const bytesOf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// a: no index (404) -> loose bundle, no models
let b = await run('', {});
assert.equal(b.loadedFrom, '../content/manifest.json'); assert.equal(b.models, undefined);

// b: index with a models-only package -> loose bundle + rigged model
const A = bytesOf(await mk('a.one', { model: 'one' }));
b = await run('', { [IDX]: idx('a.kestrel'), '../content/packages/a.kestrel': A });
assert.equal(b.loadedFrom, '../content/manifest.json'); assert.equal(b.models.one.kind, 'rigged');

// c: ?pack= models-only -> loose base + models
b = await run('pack=p.kestrel', { 'p.kestrel': A });
assert.equal(b.loadedFrom, '../content/manifest.json'); assert.equal(b.models.one.kind, 'rigged');

// d: ?pack= content package + index add-on -> content from ?pack=, models from both
const C = bytesOf(await mk('c.pack', { model: 'cm', content: true }));
const B2 = bytesOf(await mk('b.two', { model: 'two' }));
b = await run('pack=c.kestrel', { 'c.kestrel': C, [IDX]: idx('b.kestrel'), '../content/packages/b.kestrel': B2 });
assert.match(b.loadedFrom, /^kpkg:\/\/c\.pack\/content\/manifest\.json$/); assert.ok(b.custom);
assert.deepEqual(Object.keys(b.models).sort(), ['cm', 'two']);

// e: same model id in two packages -> error names both
const A2 = bytesOf(await mk('a.two', { model: 'one' }));
await assert.rejects(run('', { [IDX]: idx('a.kestrel', 'a2.kestrel'), '../content/packages/a.kestrel': A, '../content/packages/a2.kestrel': A2 }),
  (e) => /a\.one/.test(e.message + e.file) && /a\.two/.test(e.message + e.file));

// f: add-on with a content manifest -> error
await assert.rejects(run('', { [IDX]: idx('c.kestrel'), '../content/packages/c.kestrel': C }), /add-on content is not supported/);

// g: same package id in ?pack= and the index -> error
await assert.rejects(run('pack=p.kestrel', { 'p.kestrel': A, [IDX]: idx('a.kestrel'), '../content/packages/a.kestrel': A }), /a\.one.*\?pack=.*add-on|both/);

// h: bad index path
await assert.rejects(run('', { [IDX]: idx('../x.kestrel') }), /bad package path/);
await assert.rejects(run('', { [IDX]: '{nope' }), /invalid JSON/);

// i: ?addons=0 skips the index (the packages are never fetched)
const seen = [];
b = await loadBootBundle(new URLSearchParams('addons=0'), { fetch: async (u) => { seen.push(u); return resp(404, ''); }, loadContentPack });
assert.equal(b.loadedFrom, '../content/manifest.json'); assert.deepEqual(seen, []);

// extra: dependency on kestrel.base is satisfied by a loose boot
const D = bytesOf(await mk('d.dep', { model: 'dm', deps: [{ id: 'kestrel.base', version: '^1.0.0' }] }));
b = await run('', { [IDX]: idx('d.kestrel'), '../content/packages/d.kestrel': D, '../content/packages/kestrel.base.pkg.json': '{"version":"1.2.0"}' });
assert.equal(b.models.dm.kind, 'rigged');
console.log('packBoot: ok');
