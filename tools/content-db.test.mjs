import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { stringifyContent } from '../engine/index.js';
import { exportContent, importContent, checkContent, contentFiles } from './content-db.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-content-db-'));
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function put(root, name, bytes) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), bytes);
}
function edit(file, fn) {
  const db = new DatabaseSync(file);
  try { fn(db); } finally { db.close(); }
}
try {
  const input = path.join(tmp, 'in'), output = path.join(tmp, 'out'), database = path.join(tmp, 'fixture.sqlite');
  const world = { kind: 'world', schema: 1, id: 'w', structures: [{ id: 'rock', mesh: 'pack/rock', origin: { x: 1, y: 2, z: 3 } }] };
  put(input, 'worlds/w.json', Buffer.from('\uFEFF' + JSON.stringify(world, null, 4).replaceAll('\n', '\r\n')));
  put(input, 'quests/regions/pack.json', '{"quests":[{"id":"sq.reg.downs","site":"relay_downs","title":"Errand"}]}');
  put(input, 'items/loot.json', '{ "sources": {"boar": {"fixed": [{"item":"arrow","n":1}]}} }\n');
  put(input, 'life/ambient.json', '{"regions":{"downs":{"cues":{"birds":0.3}}}}');
  assert.deepEqual(exportContent(input, database), { files: 4, kinds: 4 });
  assert.deepEqual(checkContent(database, input), []);
  assert.deepEqual(importContent(database, output), { files: 4, written: 4 });
  for (const name of contentFiles(input)) assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(input, name)), name);
  assert.deepEqual(importContent(database, output), { files: 4, written: 0 });
  edit(database, db => {
    assert.equal(db.prepare("SELECT mesh FROM placements_by_mesh").get().mesh, 'pack/rock');
    assert.equal(db.prepare("SELECT region FROM quests_by_region").get().region, 'downs');
    assert.equal(db.prepare("SELECT source FROM loot_by_source").get().source, 'boar');
    assert.equal(db.prepare('SELECT count(*) AS n FROM _content_all').get().n, 4);
    db.exec("UPDATE content_world SET document=json_set(document,'$.id','renamed')");
    assert.equal(db.prepare('SELECT world_id FROM placements_by_mesh').get().world_id, 'renamed', 'views read the current document id');
    db.exec("UPDATE content_world SET document=json_set(document,'$.id','w')");
    // SQL editing preserves unrelated rows, and edited JSON goes through the public writer.
    db.exec("UPDATE content_world SET document=json_set(document,'$.structures[0].origin.x',8)");
  });
  assert.deepEqual(checkContent(database, output), [{ path: 'worlds/w.json', reason: 'changed' }]);
  assert.equal(importContent(database, output).written, 1);
  assert.equal(fs.readFileSync(path.join(output, 'worlds/w.json'), 'utf8'), stringifyContent({ ...world, structures: [{ ...world.structures[0], origin: { x: 8, y: 2, z: 3 } }] }));
  assert.deepEqual(checkContent(database, output), []);
  // Whitespace-only edits to document have no effect on original source bytes.
  edit(database, db => {
    const row = db.prepare('SELECT document FROM content_life').get();
    db.prepare('UPDATE content_life SET document=?').run(JSON.stringify(JSON.parse(row.document)));
  });
  assert.equal(importContent(database, output).written, 0);
  const dbBytes = fs.readFileSync(database), sourceBytes = fs.readFileSync(path.join(output, 'worlds/w.json'));
  fs.unlinkSync(path.join(output, 'life/ambient.json'));
  put(output, 'extra.json', '{}');
  assert.deepEqual(checkContent(database, output), [{ path: 'life/ambient.json', reason: 'missing' }, { path: 'extra.json', reason: 'extra' }]);
  assert.deepEqual(fs.readFileSync(database), dbBytes, '--check does not mutate SQLite');
  assert.deepEqual(fs.readFileSync(path.join(output, 'worlds/w.json')), sourceBytes);
  // All rows are validated before the first write, including an otherwise-valid pending change.
  edit(database, db => {
    db.exec("UPDATE content_items SET document=json_set(document,'$.extra',true)");
    db.exec("UPDATE content_world SET path='../escaped.json'");
  });
  const lootBefore = fs.readFileSync(path.join(output, 'items/loot.json'));
  assert.throws(() => importContent(database, output), /unsafe content path/);
  assert.deepEqual(fs.readFileSync(path.join(output, 'items/loot.json')), lootBefore);
  assert.equal(fs.existsSync(path.join(tmp, 'escaped.json')), false);
  edit(database, db => db.exec("UPDATE content_world SET path='worlds/w.json'; UPDATE content_life SET original_json='{}'"));
  assert.throws(() => importContent(database, output), /baseline mismatch/);
  edit(database, db => db.exec("UPDATE content_life SET original_json=document; UPDATE content_world SET path='items/loot.json'"));
  // Restoring a noncanonical baseline is rejected as well; re-export for further cases.
  assert.throws(() => importContent(database, output));
  const second = path.join(tmp, 'second.sqlite'); exportContent(input, second);
  edit(second, db => db.exec("UPDATE content_world SET path='ITEMS/LOOT.json'"));
  assert.throws(() => importContent(second, output), /duplicate content path/);
  assert.throws(() => exportContent(input, database), /EEXIST/);
  assert.deepEqual(fs.readFileSync(database).subarray(0, 16), Buffer.from('SQLite format 3\0'));

  const third = path.join(tmp, 'third.sqlite'); exportContent(input, third);
  edit(third, db => db.exec("UPDATE content_world SET document=json_set(document,'$.kind','level')"));
  assert.throws(() => importContent(third, output), /kind changed/);
  // A junction/symlink parent must not redirect an import outside the output tree.
  const linked = path.join(tmp, 'linked'), outside = path.join(tmp, 'outside');
  fs.mkdirSync(linked); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(linked, 'worlds'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => importContent(database, linked));
  const clean = path.join(tmp, 'clean.sqlite'); exportContent(input, clean);
  assert.throws(() => importContent(clean, linked), /symlink refused/);
  assert.deepEqual(fs.readdirSync(outside), []);

  const blocked = path.join(tmp, 'blocked');
  fs.mkdirSync(path.join(blocked, 'worlds', 'w.json'), { recursive: true });
  assert.throws(() => importContent(clean, blocked), /not a regular file/);
  assert.equal(fs.existsSync(path.join(blocked, 'items')), false, 'preflight rejects directory collision before any write');
  edit(clean, db => db.exec("UPDATE content_world SET path='items/loot.json/nested.json'"));
  assert.throws(() => importContent(clean, output), /used as a directory/);
  edit(clean, db => db.exec("UPDATE content_world SET path='worlds/w.json'"));
  const tempCollision = path.join(output, 'life/ambient.json') + `.content-db-${process.pid}.tmp`;
  put(output, path.relative(output, tempCollision), 'existing temporary work');
  assert.throws(() => importContent(clean, output), /EEXIST/);
  assert.equal(fs.readFileSync(tempCollision, 'utf8'), 'existing temporary work', 'refusal does not remove another temporary file');
  fs.unlinkSync(tempCollision);

  const invalid = path.join(tmp, 'invalid'); put(invalid, 'broken.json', '{');
  const failed = path.join(tmp, 'failed.sqlite');
  assert.throws(() => exportContent(invalid, failed), /broken.json/);
  assert.equal(fs.existsSync(failed), false, 'failed export removes only its own database');
  const arrays = path.join(tmp, 'arrays'), arrayDb = path.join(tmp, 'arrays.sqlite'), arrayOut = path.join(tmp, 'arrays-out');
  put(arrays, 'logic/example.logic.json', '[ {"id":"rule1", "when": "go", "then": ["yes", "again"]} ]\r\n');
  put(arrays, 'logic/empty.logic.json', '[]');
  assert.deepEqual(exportContent(arrays, arrayDb), { files: 2, kinds: 1 });
  importContent(arrayDb, arrayOut);
  assert.deepEqual(checkContent(arrayDb, arrays), []);
  assert.deepEqual(fs.readFileSync(path.join(arrays, 'logic/example.logic.json')), fs.readFileSync(path.join(arrayOut, 'logic/example.logic.json')));
  edit(arrayDb, db => db.exec("UPDATE content_logic SET document=json_set(document,'$[0].when','changed') WHERE path='logic/example.logic.json'"));
  assert.equal(importContent(arrayDb, arrayOut).written, 1);
  const arrayText = fs.readFileSync(path.join(arrayOut, 'logic/example.logic.json'), 'utf8');
  assert.deepEqual(JSON.parse(arrayText), [{ id:'rule1', then:['yes','again'], when:'changed' }]);
  assert.ok(arrayText.startsWith('[\n  {"id": "rule1"') && arrayText.endsWith('\n]\n'), 'edited array uses public writer layout without its temporary envelope');
  assert.equal(importContent(arrayDb, arrayOut).written, 0);
  const foreign = path.join(tmp, 'foreign.sqlite');
  edit(foreign, db => db.exec('CREATE TABLE unrelated(x)'));
  assert.throws(() => importContent(foreign, output), /unsupported content database/);
  const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty);
  const emptyDb = path.join(tmp, 'empty.sqlite');
  assert.deepEqual(exportContent(empty, emptyDb), { files: 0, kinds: 0 });
  assert.deepEqual(importContent(emptyDb, path.join(tmp, 'empty-out')), { files: 0, written: 0 });
  assert.deepEqual(checkContent(emptyDb, empty), []);

  // Real corpus regression: every JSON file, even those outside the manifest.
  const production = path.join(ROOT, 'content'), realDb = path.join(tmp, 'real.sqlite'), realOut = path.join(tmp, 'real-out');
  const count = contentFiles(production).length;
  assert.equal(exportContent(production, realDb).files, count);
  assert.equal(importContent(realDb, realOut).written, count);
  for (const name of contentFiles(production)) assert.deepEqual(fs.readFileSync(path.join(realOut, name)), fs.readFileSync(path.join(production, name)), name);
  assert.deepEqual(checkContent(realDb, production), []);
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'tools/content-db.mjs'), 'import', realDb, '--root', production, '--check'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /content-db check OK/);
  put(realOut, 'unexpected.json', '{}');
  const stale = spawnSync(process.execPath, [path.join(ROOT, 'tools/content-db.mjs'), 'check', realDb, '--root', realOut], { encoding: 'utf8' });
  assert.equal(stale.status, 1); assert.match(stale.stderr, /extra: unexpected.json/);
  console.log(`content-db: fixture safety/edit/views/CLI PASS; ${count} production JSON files byte-identical`);
} finally {
  assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'kestrel-content-db-'));
  fs.rmSync(tmp, { recursive: true, force: true });
}
