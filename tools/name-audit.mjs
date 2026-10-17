// OB-135: audit player-facing names/descriptions. `node tools/name-audit.mjs [--list]`; exports audit() for the test.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const PLACEHOLDER = /\b(todo|tbd|placeholder|xxx|lorem|fixme|needs writer|copy)\b|\btest\b/i;
const ID_LIKE = /^[a-z]+[A-Z]|[a-z]\.[a-z]|_/;      // camelCase, dotted, snake_case
const TIER_CODE = /\bT[0-9]\b/;
const OBSCURE = /\b(draught|flask|tonic|elixir|philter|vial)\b/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}
// Collect { where, kind: 'name'|'text', text } entries.
export function collect() {
  const rows = [];
  const items = require(path.join(root, 'design/items.js')).items;
  for (const id of Object.keys(items.defs)) {
    const d = items.defs[id];
    rows.push({ where: 'design/items.js:' + id + '.name', kind: 'name', text: d.name });
    rows.push({ where: 'design/items.js:' + id + '.desc', kind: 'text', text: d.desc || '' });
  }
  const NAME_KEYS = new Set(['title']), TEXT_KEYS = new Set(['objText', 'journal', 'returnText', 'text']);
  for (const f of walk(path.join(root, 'content/quests'))) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    (function rec(o, p) {
      if (Array.isArray(o)) o.forEach((v, i) => rec(v, p + '[' + i + ']'));
      else if (o && typeof o === 'object') for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === 'string') {
          if (NAME_KEYS.has(k)) rows.push({ where: rel + ':' + p + '.' + k, kind: 'name', text: v });
          else if (TEXT_KEYS.has(k)) rows.push({ where: rel + ':' + p + '.' + k, kind: 'text', text: v });
        } else rec(v, p + '.' + k);
      }
    })(JSON.parse(fs.readFileSync(f, 'utf8')), '');
  }
  return rows;
}
export function audit() {
  const rows = collect(), issues = [], byName = new Map();
  for (const r of rows) {
    if (PLACEHOLDER.test(r.text)) issues.push({ ...r, why: 'placeholder' });
    if (TIER_CODE.test(r.text)) issues.push({ ...r, why: 'tier-code' });
    if (r.kind === 'name') {
      if (ID_LIKE.test(r.text) && !/\s/.test(r.text)) issues.push({ ...r, why: 'id-as-name' });
      if (OBSCURE.test(r.text)) issues.push({ ...r, why: 'obscure' });
      if (r.where.startsWith('design/items.js')) { const k = r.text.toLowerCase(); (byName.get(k) || byName.set(k, []).get(k)).push(r.where); }
    }
  }
  for (const [n, w] of byName) if (w.length > 1) issues.push({ where: w.join(' | '), kind: 'name', text: n, why: 'duplicate-name' });
  return { rows, issues };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rows, issues } = audit();
  if (process.argv.includes('--list')) for (const r of rows) console.log(r.where + '\t' + r.text);
  for (const i of issues) console.log('[' + i.why + '] ' + i.where + ' : ' + i.text);
  console.log(rows.length + ' strings, ' + issues.length + ' issues');
  process.exitCode = issues.some((i) => i.why !== 'obscure') ? 1 : 0;
}
