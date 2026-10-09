// engine/content/zip.test.js (KPKG-01): node engine/content/zip.test.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, writeZip, checkZipPath, crc32 } from './zip.js';
import { ContentError } from './ContentError.js';
import { makeOk } from '../test/assert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

async function throwsContent(fn) {
  try { await fn(); } catch (e) { return e instanceof ContentError ? e : null; }
  return null;
}
const enc = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// 1. Python zipfile fixture: stored + deflate + UTF-8 name.
{
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'py.zip')));
  const z = readZip(bytes);
  ok('py: paths', z.paths.length === 4 && z.has('kestrel.json') && z.has('content/a.txt') && z.has('uni/\u00e4.txt'), z.paths.join());
  ok('py: stored', new TextDecoder().decode(await z.read('kestrel.json')) === '{"a":1}');
  ok('py: deflate', new TextDecoder().decode(await z.read('content/a.txt')) === 'hello hello hello hello '.repeat(50));
  const bin = await z.read('models/x.bin');
  ok('py: stored zero-copy subarray', bin.buffer === bytes.buffer && bin.length === 256 && bin[255] === 255);
  ok('py: utf8 name', new TextDecoder().decode(await z.read('uni/\u00e4.txt')) === '\u00fcber');
  ok('py: size()', z.size('content/a.txt') === 1200);
}

// 2. Round trip + determinism.
const files = [
  { path: 'content/b.json', bytes: enc('{"x":' + '1,'.repeat(300) + '2}') },
  { path: 'kestrel.json', bytes: enc('{"format":"kestrel-package"}') },
  { path: 'models/m.glb', bytes: Uint8Array.from({ length: 500 }, (_, i) => (i * 7) & 255) },
  { path: 'a/empty.txt', bytes: new Uint8Array(0) },
];
{
  const z1 = await writeZip(files, { deflate: true });
  const r = readZip(z1);
  ok('rt: kestrel.json first', r.paths[0] === 'kestrel.json', r.paths.join());
  ok('rt: sorted rest', r.paths.slice(1).join() === 'a/empty.txt,content/b.json,models/m.glb', r.paths.join());
  for (const f of files) ok('rt: ' + f.path, eq(await r.read(f.path), f.bytes));
  const glb = await r.read('models/m.glb');
  ok('rt: glb zero-copy', glb.buffer === z1.buffer);
  ok('rt: deflate shrank json', r.size('content/b.json') > 0 && z1.length < files.reduce((s, f) => s + f.bytes.length, 0));
  const s1 = await writeZip(files, { deflate: false });
  const s2 = await writeZip([...files].reverse(), { deflate: false });
  ok('stored-only deterministic', eq(s1, s2));
  const d1 = await writeZip(files, { deflate: true });
  ok('deflate deterministic (same runtime)', eq(z1, d1));
  const dv = new DataView(s1.buffer);
  ok('dos date 1980-01-01', dv.getUint16(12, true) === 0x21 && dv.getUint16(10, true) === 0);
  // Python can read our output too (optional, via fixture-independent check of CRC).
  ok('crc32 known value', crc32(enc('123456789')) === 0xcbf43926);
}

// 3. Errors.
{
  const s = await writeZip([{ path: 'a.txt', bytes: enc('hello world') }], { deflate: false });
  const bad = s.slice();
  bad[30 + 5 + 2] ^= 0xff; // flip a data byte (local header 30 + name 5)
  const e1 = await throwsContent(() => readZip(bad).read('a.txt'));
  ok('bad CRC rejected', e1 && /CRC/.test(e1.reason), e1 && e1.reason);

  for (const p of ['../x', 'a/../b', '/abs', 'a\\b', 'C:/x', 'c:x']) {
    ok('checkZipPath rejects ' + p, (await throwsContent(() => checkZipPath(p))) !== null);
    ok('writeZip rejects ' + p, (await throwsContent(() => writeZip([{ path: p, bytes: enc('x') }]))) !== null);
  }
  ok('checkZipPath accepts normal', (await throwsContent(() => checkZipPath('content/a..b/c.json'))) === null);

  // Evil archive: rename a stored entry to ../x of the same length in both headers.
  const ev = await writeZip([{ path: 'abc', bytes: enc('x') }], { deflate: false });
  const evil = ev.slice();
  const nm = enc('/ab');
  evil.set(nm, 30);
  const cdOff = new DataView(evil.buffer).getUint32(evil.length - 6, true);
  evil.set(nm, cdOff + 46);
  ok('evil name in archive rejected on read', (await throwsContent(() => readZip(evil))) !== null);

  // Entry count limit: configured and via EOCD count (10001).
  const many = await writeZip(Array.from({ length: 5 }, (_, i) => ({ path: 'f' + i, bytes: enc('x') })), { deflate: false });
  ok('entry limit (option)', (await throwsContent(() => readZip(many, { maxEntries: 4 }))) !== null);
  const over = many.slice();
  new DataView(over.buffer).setUint16(over.length - 22 + 10, 10001, true);
  const e3 = await throwsContent(() => readZip(over));
  ok('more than 10000 entries rejected', e3 && /10000/.test(e3.reason), e3 && e3.reason);
  const tooMany = Array.from({ length: 10001 }, (_, i) => ({ path: 'f' + i, bytes: new Uint8Array(0) }));
  ok('writeZip >10000 entries rejected', (await throwsContent(() => writeZip(tooMany))) !== null);

  // Size + ratio limits.
  const big = await writeZip([{ path: 'z.txt', bytes: new Uint8Array(200000) }], { deflate: true });
  ok('size limit', (await throwsContent(() => readZip(big, { maxTotal: 100000 }))) !== null);
  ok('ratio limit', (await throwsContent(() => readZip(big, { maxRatio: 10, ratioMinSize: 1000 }))) !== null);
  ok('big zeros ok under defaults', readZip(big).size('z.txt') === 200000);
  // Declared size smaller than the real inflated data -> rejected.
  const lie = big.slice();
  const lv = new DataView(lie.buffer);
  const cd = lv.getUint32(lie.length - 6, true);
  lv.setUint32(cd + 24, 100, true);
  ok('inflated beyond declared size rejected', (await throwsContent(() => readZip(lie).read('z.txt'))) !== null);

  ok('not a zip', (await throwsContent(() => readZip(enc('hello world this is not a zip file')))) !== null);
  ok('missing entry', (await throwsContent(() => readZip(many).read('nope'))) !== null);
}

console.log(`zip.test: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
