// engine/content/package.test.js (KPKG-02): node engine/content/package.test.js
import fs from 'node:fs';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeZip } from './zip.js';
import { validatePackageManifest, openPackage, mountPackages, parseRange, parseSemver } from './package.js';
import { loadContentPack } from './loadPack.js';
import { ContentError } from './ContentError.js';
import { makeOk } from '../test/assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const enc = (s) => new TextEncoder().encode(s);
const FIX = path.join(__dirname, 'fixtures', 'pack');

const base = (extra = {}) => ({
  format: 'kestrel-package', formatVersion: 1, id: 'kestrel.test.a', name: 'A', version: '1.0.0',
  license: { spdx: 'CC-BY-4.0', file: 'LICENSE.txt' }, ...extra,
});
async function build(manifest, extra = []) {
  return writeZip([{ path: 'kestrel.json', bytes: enc(JSON.stringify(manifest)) }, { path: 'LICENSE.txt', bytes: enc('x') }, ...extra]);
}
function throwsCE(fn, re) {
  try { fn(); } catch (e) { return e instanceof ContentError && (!re || re.test(e.message)); }
  return false;
}
async function rejectsCE(p, re) {
  try { await p; } catch (e) { return e instanceof ContentError && (!re || re.test(e.message)); }
  return false;
}

// 1. Manifest validation.
{
  ok('valid', !throwsCE(() => validatePackageManifest(base())));
  const lic = base(); delete lic.license;
  ok('missing license', throwsCE(() => validatePackageManifest(lic), /license\.spdx/));
  ok('empty spdx', throwsCE(() => validatePackageManifest(base({ license: { spdx: '' } })), /license\.spdx/));
  ok('LicenseRef ok', !throwsCE(() => validatePackageManifest(base({ license: { spdx: 'LicenseRef-AllRightsReserved' } }))));
  for (const id of ['Bad', 'ab', '1abc', 'a b c', 'x'.repeat(65), undefined]) {
    ok(`bad id ${id}`, throwsCE(() => validatePackageManifest(base({ id })), /\bid\b/));
  }
  ok('newer formatVersion', throwsCE(() => validatePackageManifest(base({ formatVersion: 2 })), /newer/));
  ok('wrong format', throwsCE(() => validatePackageManifest(base({ format: 'zip' })), /format/));
  ok('bad semver', throwsCE(() => validatePackageManifest(base({ version: '1.0' })), /semver/));
  ok('asset path missing in zip', throwsCE(() => validatePackageManifest(base({ assets: [{ path: 'models/x.glb', type: 'model.static' }] }), { paths: ['kestrel.json', 'LICENSE.txt'] }), /not in the package/));
  ok('asset path ..', throwsCE(() => validatePackageManifest(base({ assets: [{ path: '../x.glb', type: 'model.static' }] }))));
  ok('asset js refused', throwsCE(() => validatePackageManifest(base({ assets: [{ path: 'a.js', type: 'script' }] })), /data only/));
  ok('asset bad type', throwsCE(() => validatePackageManifest(base({ assets: [{ path: 'a.glb', type: 'Model' }] })), /type/));
  ok('asset dup path', throwsCE(() => validatePackageManifest(base({ assets: [{ path: 'a.glb', type: 'm' }, { path: 'a.glb', type: 'm' }] })), /duplicate/));
  ok('dep range', throwsCE(() => validatePackageManifest(base({ dependencies: [{ id: 'kestrel.dep', version: '>=1' }] })), /caret/));
  ok('thumb must be png', throwsCE(() => validatePackageManifest(base({ thumbnail: 'thumbs/a.jpg' })), /png/));
}

// 2. Semver ranges.
{
  const r = parseRange('^1.2.0');
  ok('caret in', r(parseSemver('1.2.0')) && r(parseSemver('1.9.9')));
  ok('caret out', !r(parseSemver('1.1.9')) && !r(parseSemver('2.0.0')));
  ok('caret 0.x', parseRange('^0.2.1')(parseSemver('0.2.5')) && !parseRange('^0.2.1')(parseSemver('0.3.0')));
  ok('exact', parseRange('1.0.0')(parseSemver('1.0.0')) && !parseRange('1.0.0')(parseSemver('1.0.1')));
  ok('bad range', parseRange('~1.0.0') === null && parseRange('*') === null);
}

// 3. openPackage: assets / license file must be in the zip.
{
  const p1 = await openPackage(await build(base({ assets: [{ path: 'models/x.glb', type: 'model.static', id: 'x' }] }), [{ path: 'models/x.glb', bytes: enc('glb') }]));
  ok('open ok', p1.id === 'kestrel.test.a' && p1.has('models/x.glb') && (await p1.readText('LICENSE.txt')) === 'x');
  ok('open: asset not in zip', await rejectsCE(openPackage(await build(base({ assets: [{ path: 'models/x.glb', type: 'model.static' }] }))), /not in the package/));
  const noLic = await writeZip([{ path: 'kestrel.json', bytes: enc(JSON.stringify(base())) }]);
  ok('open: license file missing', await rejectsCE(openPackage(noLic), /LICENSE\.txt/));
  for (const bad of ['stray.js', 'x/y.WGSL', 'z.wasm', 'a.html', 'b.mjs', 'c.cjs', 'd.glsl']) {
    ok('open: unreferenced script entry refused ' + bad, await rejectsCE(openPackage(await build(base(), [{ path: bad, bytes: enc('x') }])), /script/));
  }
  ok('open: no manifest', await rejectsCE(openPackage(await writeZip([{ path: 'a.txt', bytes: enc('x') }])), /manifest/));
  ok('open: bad json', await rejectsCE(openPackage(await writeZip([{ path: 'kestrel.json', bytes: enc('{') }])), /json/));
}

// 4. Loose pack == the same pack mounted through kpkg://.
{
  const manifestText = fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8');
  const m = JSON.parse(manifestText);
  const entries = [
    { path: 'content/manifest.json', bytes: enc(manifestText) },
    ...m.files.map((f) => ({ path: `content/${f}`, bytes: new Uint8Array(fs.readFileSync(path.join(FIX, f))) })),
  ];
  const pkg = await openPackage(await build(base({ id: 'kestrel.test.pack', content: 'content/manifest.json' }), entries));
  const mount = await mountPackages([pkg], {});
  const loose = await loadContentPack(pathToFileURL(path.join(FIX, 'manifest.json')).href, {
    fetchText: (u) => fs.promises.readFile(new URL(u), 'utf8'),
  });
  const packed = await loadContentPack(mount.manifestUrl('kestrel.test.pack'), { fetchText: mount.fetchText, fetchBytes: mount.fetchBytes });
  const strip = (b) => {
    const c = JSON.parse(JSON.stringify(b));
    for (const k of Object.keys(c.meta)) for (const id of Object.keys(c.meta[k])) delete c.meta[k][id].url;
    return c;
  };
  let same = true;
  try { assert.deepStrictEqual(strip(packed), strip(loose)); } catch (e) { same = false; console.log(e.message.slice(0, 600)); }
  ok('loose == mounted bundle (deep-equal)', same);
  ok('bundle not empty', Object.keys(packed.levels).length > 0 && Object.keys(packed.worlds).length > 0);
  ok('relative urls resolve', (await mount.fetchText(new URL('levels/tiny.level.json', 'kpkg://kestrel.test.pack/content/manifest.json').href)).includes('"kind"'));
  ok('unmounted package', await rejectsCE(mount.fetchText('kpkg://nope.pkg.x/a'), /not mounted/));
  ok('missing file', await rejectsCE(mount.fetchText('kpkg://kestrel.test.pack/content/zzz.json'), /not in package/));
  let fb = null;
  const m2 = await mountPackages([pkg], { fetchText: async (u) => { fb = u; return 'fallback'; } });
  ok('fallback for other urls', (await m2.fetchText('file:///x.json')) === 'fallback' && fb === 'file:///x.json');
  const pkg2 = await openPackage(await build(base({ id: 'kestrel.test.pack2', content: 'content/manifest.json' }), entries));
  ok('duplicate content id names both', await rejectsCE(mountPackages([pkg, pkg2]), /kestrel\.test\.pack(2)?".*kestrel\.test\.pack(2)?"/));
}

// 5. Dependencies and duplicate asset ids.
{
  const dep = await openPackage(await build(base({ id: 'kestrel.dep', version: '1.2.0' })));
  const mk = (range) => build(base({ id: 'kestrel.user', dependencies: [{ id: 'kestrel.dep', version: range }] }));
  const u1 = await openPackage(await mk('^1.0.0'));
  ok('dep satisfied', !(await rejectsCE(mountPackages([dep, u1]))));
  ok('dep missing', await rejectsCE(mountPackages([u1]), /missing dependency/));
  const u2 = await openPackage(await mk('^1.3.0'));
  ok('dep too old', await rejectsCE(mountPackages([dep, u2]), /too old/));
  const u3 = await openPackage(await mk('^2.0.0'));
  ok('dep wrong major', await rejectsCE(mountPackages([dep, u3]), /does not satisfy/));
  const glb = [{ path: 'models/m.glb', bytes: enc('g') }];
  const asset = [{ path: 'models/m.glb', type: 'model.rigged', id: 'mara' }];
  const a = await openPackage(await build(base({ id: 'kestrel.one', assets: asset }), glb));
  const b = await openPackage(await build(base({ id: 'kestrel.two', assets: asset }), glb));
  ok('duplicate asset id names both', await rejectsCE(mountPackages([a, b]), /kestrel\.one.*kestrel\.two/));
  ok('same package twice', await rejectsCE(mountPackages([a, a]), /twice/));
  const bytes = await (await mountPackages([a])).fetchBytes('kpkg://kestrel.one/models/m.glb');
  ok('fetchBytes', bytes.length === 1 && bytes[0] === 103);
}

console.log(`package.test: ${pass} passed, ${fail} failed`);
if (fail > 0) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
console.log('ALL PASS');
