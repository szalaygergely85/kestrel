#!/usr/bin/env node
// CONTENT-DB-01: offline JSON editing through Node's built-in SQLite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { stringifyContent } from '../engine/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPLICATION_ID = 0x4b435431;
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const tableFor = kind => 'content_' + kind;

function filePath(root, relative) {
  if (typeof relative !== 'string' || !relative.endsWith('.json') ||
      relative.split('/').some(s => !s || s === '.' || s === '..' || /[\\:*?"<>|\x00-\x1f]/.test(s) ||
        /[. ]$/.test(s) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) {
    throw new Error(`unsafe content path: ${relative}`);
  }
  const target = path.resolve(root, ...relative.split('/'));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`outside content root: ${relative}`);
  return target;
}

function noLinks(target) {
  for (let p = target; ; p = path.dirname(p)) {
    let stat;
    try { stat = fs.lstatSync(p); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (stat?.isSymbolicLink()) throw new Error(`symlink refused: ${p}`);
    const parent = path.dirname(p);
    if (parent === p) break;
  }
}

/** Sorted JSON inventory, including unregistered standalone content. */
export function contentFiles(root) {
  root = path.resolve(root);
  noLinks(root);
  const files = [];
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`symlink refused: ${rel}`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else if (entry.isFile() && entry.name.endsWith('.json')) { filePath(root, rel); files.push(rel); }
    }
  }
  walk(root, '');
  return files;
}

function parseContent(text, tag) {
  let obj;
  try { obj = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error(`${tag}: ${e.message}`); }
  if (!obj || typeof obj !== 'object') throw new Error(`${tag}: JSON object or array required`);
  return obj;
}

function canonicalContent(obj) {
  if (!Array.isArray(obj)) return stringifyContent(obj);
  // Logic files use array roots. Reuse the public writer's array layout,
  // removing only the temporary envelope and its two-space indentation.
  const prefix = '{\n  "payload": ';
  return stringifyContent({ payload: obj }).slice(prefix.length, -3).replace(/\n {2}/g, '\n') + '\n';
}

function kindOf(obj, relative) {
  const kind = obj.kind ?? (relative.includes('/') ? relative.split('/')[0] : path.basename(relative, '.json'));
  if (typeof kind !== 'string' || !kind || kind.includes('\0')) throw new Error(`${relative}: invalid kind`);
  return kind;
}

/** Refuses to replace an existing DB; a failed export leaves no partial DB. */
export function exportContent(root, database) {
  root = path.resolve(root); database = path.resolve(database);
  noLinks(database);
  fs.mkdirSync(path.dirname(database), { recursive: true });
  const fd = fs.openSync(database, 'wx'); fs.closeSync(fd);
  let db;
  try {
    db = new DatabaseSync(database);
    db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;
      CREATE TABLE _content_kinds(kind TEXT PRIMARY KEY, table_name TEXT NOT NULL UNIQUE);
      BEGIN;`);
    const kinds = new Map();
    const files = contentFiles(root);
    for (const relative of files) {
      const source = fs.readFileSync(filePath(root, relative));
      const obj = parseContent(source.toString('utf8'), relative);
      const kind = kindOf(obj, relative), table = tableFor(kind);
      if (!kinds.has(kind)) {
        db.exec(`CREATE TABLE ${quote(table)}(
          path TEXT PRIMARY KEY, id TEXT,
          document TEXT NOT NULL CHECK(json_valid(document) AND json_type(document) IN ('object','array')),
          original_json TEXT NOT NULL, source BLOB NOT NULL);`);
        db.prepare('INSERT INTO _content_kinds VALUES (?,?)').run(kind, table);
        kinds.set(kind, table);
      }
      const canonical = canonicalContent(obj);
      db.prepare(`INSERT INTO ${quote(table)} VALUES (?,?,?,?,?)`).run(
        relative, typeof obj.id === 'string' ? obj.id : null, canonical, canonical, source);
    }
    const union = [...kinds].map(([kind, table]) =>
      `SELECT path, ${"'" + kind.replaceAll("'", "''") + "'"} AS kind, json_extract(document, '$.id') AS id, document FROM ${quote(table)}`).join(' UNION ALL ');
    db.exec(`CREATE VIEW _content_all AS ${union || "SELECT NULL AS path, NULL AS kind, NULL AS id, NULL AS document WHERE 0"};`);
    db.exec(fs.readFileSync(path.join(HERE, 'content-db', 'views.sql'), 'utf8'));
    db.exec('COMMIT');
    db.close(); db = null;
    return { files: files.length, kinds: kinds.size };
  } catch (e) {
    if (db) db.close();
    fs.unlinkSync(database);
    throw e;
  }
}

function importPlan(database) {
  const db = new DatabaseSync(path.resolve(database), { readOnly: true });
  try {
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
        db.prepare('PRAGMA user_version').get().user_version !== 1) throw new Error('unsupported content database');
    const result = [], seen = new Set();
    for (const { kind, table_name: table } of db.prepare('SELECT * FROM _content_kinds ORDER BY kind').all()) {
      if (typeof kind !== 'string' || table !== tableFor(kind)) throw new Error('invalid kind catalog');
      for (const row of db.prepare(`SELECT * FROM ${quote(table)} ORDER BY path`).all()) {
        filePath(path.parse(path.resolve('.')).root, row.path);
        const collisionKey = row.path.toLowerCase();
        if (seen.has(collisionKey)) throw new Error(`duplicate content path: ${row.path}`);
        seen.add(collisionKey);
        const obj = parseContent(row.document, row.path);
        if (kindOf(obj, row.path) !== kind) throw new Error(`${row.path}: kind changed; move row to the correct table`);
        const canonical = canonicalContent(obj);
        const source = Buffer.from(row.source);
        if (canonicalContent(parseContent(source.toString('utf8'), row.path)) !== row.original_json) {
          throw new Error(`${row.path}: original bytes/baseline mismatch`);
        }
        result.push({ path: row.path, bytes: canonical === row.original_json ? source : Buffer.from(canonical) });
      }
    }
    for (const row of result) {
      const parts = row.path.toLowerCase().split('/'); parts.pop();
      while (parts.length) {
        if (seen.has(parts.join('/'))) throw new Error(`content file used as a directory: ${row.path}`);
        parts.pop();
      }
    }
    return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  } finally { db.close(); }
}

/** Read-only exact file-set/byte comparison; also detects edited DB documents. */
export function checkContent(database, root) {
  root = path.resolve(root);
  const plan = importPlan(database), expected = new Set(plan.map(row => row.path));
  noLinks(root);
  const differences = [];
  for (const row of plan) {
    const target = filePath(root, row.path); noLinks(target);
    if (!fs.existsSync(target)) differences.push({ path: row.path, reason: 'missing' });
    else if (!fs.readFileSync(target).equals(row.bytes)) differences.push({ path: row.path, reason: 'changed' });
  }
  if (fs.existsSync(root)) for (const rel of contentFiles(root)) {
    if (!expected.has(rel)) differences.push({ path: rel, reason: 'extra' });
  }
  return differences;
}

/** Preflight every row/path before writing. Rows removed from the DB do not delete files. */
export function importContent(database, root) {
  root = path.resolve(root);
  const plan = importPlan(database);
  noLinks(root);
  for (const row of plan) {
    const target = filePath(root, row.path); noLinks(target);
    if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new Error(`not a regular file: ${target}`);
    for (let p = path.dirname(target); ; p = path.dirname(p)) {
      if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) throw new Error(`not a directory: ${p}`);
      if (p === root) break;
    }
  }
  let written = 0;
  for (const row of plan) {
    const target = filePath(root, row.path);
    if (fs.existsSync(target) && fs.readFileSync(target).equals(row.bytes)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temp = target + `.content-db-${process.pid}.tmp`;
    let created = false;
    try {
      fs.writeFileSync(temp, row.bytes, { flag: 'wx' });
      created = true;
      fs.renameSync(temp, target);
    } finally { if (created && fs.existsSync(temp)) fs.unlinkSync(temp); }
    written++;
  }
  return { files: plan.length, written };
}

export function main(args = process.argv.slice(2)) {
  const [command, database, ...rest] = args;
  let root = 'content', check = command === 'check';
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--root' && rest[i + 1]) root = rest[++i];
    else if (rest[i] === '--check') check = true;
    else throw new Error(`unknown option: ${rest[i]}`);
  }
  if (!['export', 'import', 'check'].includes(command) || !database) {
    throw new Error('usage: node tools/content-db.mjs export|import|check <db.sqlite> [--root content] [--check]');
  }
  if (check) {
    const differences = checkContent(database, root);
    for (const row of differences) console.error(`${row.reason}: ${row.path}`);
    if (differences.length) return 1;
    console.log('content-db check OK');
  } else {
    console.log(command === 'export' ? exportContent(root, database) : importContent(database, root));
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (e) { console.error('content-db: ' + e.message); process.exitCode = 1; }
}
