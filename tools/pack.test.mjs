// KPKG-03 tests: tools/pack.mjs + tools/unpack.mjs (docs/architecture.md 38.30 item 4).
//   node tools/pack.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packSpec, packDir } from './pack.mjs';
import { unpackBytes } from './unpack.mjs';
import { openPackage, mountPackages, loadContentPack } from '../engine/index.js';
import { makeOk } from '../engine/test/assert.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kpack-'));
try {
  // 1. tiny synthetic tree: exclude globs, deterministic output, round trip
  const src = path.join(tmp, 'src');
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a.json'), '{"a":1}');
  fs.writeFileSync(path.join(src, 'sub', 'b.json'), '{"b":2}');
  fs.writeFileSync(path.join(src, 'sub', 'skip.js'), 'x');
  fs.writeFileSync(path.join(src, 'LICENSE.txt'), 'lic');
  fs.writeFileSync(path.join(src, 'm.glb'), Buffer.from([1, 2, 3, 4]));
  const spec = {
    id: 'test.pack', name: 'T', version: '1.2.3',
    license: { spdx: 'CC0-1.0', file: 'LICENSE.txt' },
    assets: [{ path: 'models/m.glb', type: 'model.static', id: 'm' }],
    entries: [
      { from: path.join(src, 'a.json'), to: 'content/a.json' },
      { from: src, to: 'content/tree', exclude: ['*.js', 'm.glb', 'LICENSE.txt'] },
      { from: path.join(src, 'LICENSE.txt'), to: 'LICENSE.txt' },
      { from: path.join(src, 'm.glb'), to: 'models/m.glb' },
    ],
  };
  const bytes = await packSpec(spec, REPO);
  const again = await packSpec(spec, REPO);
  ok('pack deterministic', eq(bytes, again));
  const pkg = await openPackage(bytes);
  ok('manifest id/format', pkg.manifest.id === 'test.pack' && pkg.manifest.format === 'kestrel-package');
  ok('exclude *.js', !pkg.has('content/tree/sub/skip.js') && pkg.has('content/tree/sub/b.json'));
  ok('glb stored intact', eq(await pkg.readBytes('models/m.glb'), [1, 2, 3, 4]));

  const out = path.join(tmp, 'out');
  await unpackBytes(bytes, out);
  ok('unpack writes files', fs.readFileSync(path.join(out, 'content/tree/sub/b.json'), 'utf8') === '{"b":2}');
  const re = await packDir(out);
  ok('unpack -> pack round trip is byte-identical', eq(bytes, re));

  // errors
  let msg = '';
  try { await packSpec({ ...spec, license: { file: 'LICENSE.txt' } }, REPO); } catch (e) { msg = e.message; }
  ok('missing license.spdx rejected', /spdx/.test(msg), msg);
  msg = '';
  try { await packSpec({ ...spec, entries: [{ from: path.join(tmp, 'nope'), to: 'x' }] }, REPO); } catch (e) { msg = e.message; }
  ok('missing source rejected', /does not exist/.test(msg), msg);
  msg = '';
  try { await packSpec({ ...spec, entries: [spec.entries[0], { from: path.join(src, 'a.json'), to: 'content/a.json' }] }, REPO); } catch (e) { msg = e.message; }
  ok('duplicate zip path rejected', /duplicate/.test(msg), msg);

  // 2. the real kestrel.base spec: mounted package loads == loose content
  const baseSpec = JSON.parse(fs.readFileSync(path.join(REPO, 'content/packages/kestrel.base.pkg.json'), 'utf8'));
  const baseBytes = await packSpec(baseSpec, REPO);
  const base = await openPackage(baseBytes);
  ok('base: content manifest set', base.manifest.content === 'content/manifest.json');
  ok('base: no scripts or packages dir packed', !base.paths.some((p) => /\.js$/.test(p) || p.startsWith('content/packages/') || p.startsWith('content/editor/')));
  const fetchers = await mountPackages([base], {});
  const viaPkg = await loadContentPack(`kpkg://kestrel.base/content/manifest.json`, fetchers);
  const loosePath = path.join(REPO, 'content/manifest.json');
  const loose = await loadContentPack(pathToFileURL(path.join(REPO, 'content/manifest.json')).href, {
    fetchText: (u) => fs.promises.readFile(new URL(u), 'utf8'),
    fetchBytes: async (u) => new Uint8Array(await fs.promises.readFile(new URL(u))),
  });
  const strip = (b) => {
    const c = JSON.parse(JSON.stringify(b));
    for (const k of Object.keys(c.meta || {})) for (const id of Object.keys(c.meta[k])) delete c.meta[k][id].url;
    return c;
  };
  let same = true;
  try { assert.deepStrictEqual(strip(viaPkg), strip(loose)); } catch (e) { same = false; console.log(String(e.message).slice(0, 400)); }
  ok('base: packed bundle deep-equals loose bundle', same);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`pack tests: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error('FAIL ' + f); process.exit(1); }
