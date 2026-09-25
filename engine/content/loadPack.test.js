// engine/content/loadPack.test.js (US-027a, docs/architecture.md 21.4/21.10 S3)
//
//   node engine/content/loadPack.test.js
//
// Plain Node ESM, no framework - matches engine/core/playerLook.test.js.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadContentPack, globalId } from './loadPack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_MANIFEST = pathToFileURL(path.join(__dirname, 'fixtures', 'pack', 'manifest.json')).href;

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

function nodeFetchText(u) {
  return readFile(new URL(u), 'utf8');
}

async function expectError(name, promise, matchers) {
  try {
    await promise;
    ok(name, false, 'did not throw');
  } catch (e) {
    const nameOk = e.name === 'ContentError';
    const errs = e.errors || [e];
    const msgs = errs.map((x) => x.message).join(' | ');
    const matchOk = matchers.every((re) => re.test(msgs));
    ok(name, nameOk && matchOk, `errors=[${msgs}]`);
  }
}

// --- globalId helper ---------------------------------------------------------
ok('globalId formats fileId/localId', globalId('tower', 'lamp_hook') === 'tower/lamp_hook');

// --- happy path: the fixture pack loads cleanly ------------------------------
{
  const bundle = await loadContentPack(PACK_MANIFEST, { fetchText: nodeFetchText });
  ok('contentVersion comes from the manifest', bundle.contentVersion === 1);
  ok('packId comes from the manifest', bundle.packId === 'kestrel_test');
  ok('level is loaded by its id', !!bundle.levels.tiny);
  ok('world is loaded by its id', !!bundle.worlds.tiny_world);
  ok('envelope keys stripped from the loaded def', !('kind' in bundle.levels.tiny) && !('schema' in bundle.levels.tiny) && !('nextId' in bundle.levels.tiny));
  ok('meta carries schema/nextId per (kind,id)', bundle.meta.level.tiny.nextId === 3);
  ok('brazier id reused across props/lights (unique per collection)',
    bundle.levels.tiny.props[0].id === 'brazier' && bundle.levels.tiny.lights[0].id === 'brazier');
  ok('interactables ref fields resolve (prop/light -> brazier)',
    bundle.levels.tiny.interactables[0].prop === 'brazier' && bundle.levels.tiny.interactables[0].light === 'brazier');
}

// --- error cases (each via an in-memory fetchText, no extra broken fixture
// files needed - the loader only cares about the text it's handed) ----------

function memFetch(files) {
  return async (u) => {
    if (!(u in files)) throw new Error(`ENOENT: no such file '${u}'`);
    return files[u];
  };
}

const M = 'file:///mem/manifest.json';
const L = 'file:///mem/levels/a.level.json';

function manifestFor(fileText) {
  return JSON.stringify({ kind: 'manifest', schema: 1, id: 'm', contentVersion: 1, files: ['levels/a.level.json'] });
}

await expectError('missing/unreadable file (fetch throws)',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor() }) }),
  [/fetch/]);

await expectError('manifest itself missing throws immediately',
  loadContentPack(M, { fetchText: memFetch({}) }),
  [/fetch/]);

await expectError('bad JSON (parser message kept)',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: '{ not json' }) }),
  [/json/i]);

await expectError('unknown kind',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'model', schema: 1, id: 'a', nextId: 1 }) }) }),
  [/unknown kind/]);

await expectError('schema not an integer',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 'x', id: 'a', nextId: 1 }) }) }),
  [/schema/]);

await expectError('schema newer than engine',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 3, id: 'a', nextId: 1 }) }) }),
  [/3 is newer than this engine \(max 1\)/]);

await expectError('bad or missing id',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'Bad Id!', nextId: 1 }) }) }),
  [/bad or missing id/]);

await expectError('name not equal to id',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', name: 'not-a', nextId: 1 }) }) }),
  [/does not equal id/]);

await expectError('item without id in an id collection',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', nextId: 1, props: [{ model: 'x', x: 0, y: 0, z: 0 }] }) }) }),
  [/needs a valid id/]);

await expectError('duplicate local id within one collection',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', nextId: 1, props: [{ id: 'p1', model: 'x', x: 0, y: 0, z: 0 }, { id: 'p1', model: 'x', x: 1, y: 1, z: 0 }] }) }) }),
  [/duplicate id "p1"/]);

await expectError('a REF_FIELDS reference that does not resolve',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', nextId: 1, interactables: [{ id: 'i1', interact: 'use', x: 0, y: 0, z: 0, radius: 1, prop: 'nope' }] }) }) }),
  [/references unknown props id "nope"/]);

await expectError('nextId missing',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', props: [{ id: 'p_1', model: 'x', x: 0, y: 0, z: 0 }] }) }) }),
  [/nextId is required/]);

await expectError('nextId not greater than a minted n',
  loadContentPack(M, { fetchText: memFetch({ [M]: manifestFor(), [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', nextId: 2, props: [{ id: 'p_5', model: 'x', x: 0, y: 0, z: 0 }] }) }) }),
  [/nextId \(2\) must be greater than every minted id \(found _5\)/]);

await expectError('duplicate (kind,id) across two files',
  loadContentPack(M, {
    fetchText: memFetch({
      [M]: JSON.stringify({ kind: 'manifest', schema: 1, id: 'm', contentVersion: 1, files: ['levels/a.level.json', 'levels/b.level.json'] }),
      [L]: JSON.stringify({ kind: 'level', schema: 1, id: 'a', nextId: 1 }),
      'file:///mem/levels/b.level.json': JSON.stringify({ kind: 'level', schema: 1, id: 'a', nextId: 1 }),
    }),
  }),
  [/duplicate level id "a"/]);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('ALL PASS');
  process.exit(0);
}
