// ED-QUI-07b1 (38.85): questE2eRun.js is browser-safe (no node:* / tools/ in its import graph, no globalThis.ASSETS writes)
// and runQuestE2e gives a fresh, repeatable step list for one quest; a broken in-memory bundle names the failing step.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { makeOk } from '../../../engine/test/assert.js';
import { runQuestE2e } from './questE2eRun.js';
import { loadQuestE2eBundle } from '../../../tools/quest-e2e-content.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// 1. import-graph guard (check-deps style static walk of relative imports)
{
  const bad = [], seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return; seen.add(file);
    if (!existsSync(file)) { bad.push('missing ' + relative(ROOT, file)); return; }
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // comments may quote imports
    for (const m of src.matchAll(/(?:^|[\n;])\s*(?:import|export)\s[^'";()]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('node:') || !spec.startsWith('.')) { bad.push(relative(ROOT, file) + ' -> ' + spec); continue; }
      const to = resolve(dirname(file), spec);
      if (relative(ROOT, to).split(String.fromCharCode(92)).join('/').startsWith('tools/')) bad.push(relative(ROOT, file) + ' -> ' + spec);
      walk(to);
    }
  };
  walk(fileURLToPath(new URL('./questE2eRun.js', import.meta.url)));
  ok('import graph has modules', seen.size > 5, String(seen.size));
  ok('no node:* / bare / tools/ imports in the questE2eRun graph', bad.length === 0, bad.join(', '));
  ok('questE2eRun.js never writes globalThis.ASSETS', !/globalThis\.ASSETS\s*=/.test(readFileSync(new URL('./questE2eRun.js', import.meta.url), 'utf8')));
}

// 2. real content: burl.road passes, twice with equal steps (fresh runtime per call)
const bundle = await loadQuestE2eBundle();
const before = globalThis.ASSETS;
const a = await runQuestE2e(bundle, 'burl.road'), b = await runQuestE2e(bundle, 'burl.road');
ok('burl.road ok', a.ok && a.firstFail === null, JSON.stringify(a.firstFail));
ok('burl.road steps listed (offer .. save-load)', a.steps.length >= 10 && a.steps[0].name.startsWith('1 ') && a.steps.at(-1).name === '9 save-load', a.steps.map((s) => s.name).join(','));
ok('step shape {name, ok, detail}', a.steps.every((s) => typeof s.name === 'string' && typeof s.ok === 'boolean' && typeof s.detail === 'string'));
ok('repeatable: same steps on a second run', JSON.stringify(a) === JSON.stringify(b));
ok('runner left globalThis.ASSETS alone', globalThis.ASSETS === before);

// 3. broken in-memory bundles
{
  const noArea = { ...bundle, areaIds: new Set([...bundle.areaIds].filter((x) => x !== 'bendRelay')) };
  const r = await runQuestE2e(noArea, 'burl.road');
  ok('missing area -> FAIL at 5 objectives', !r.ok && r.firstFail.name === '5 objectives' && r.firstFail.detail.includes('bendRelay'), JSON.stringify(r.firstFail));
  ok('failing step is marked in the list', r.steps.some((s) => s.name === '5 objectives' && !s.ok) && r.steps.find((s) => s.name === '4 accept').ok);
  const noRook = { ...bundle, entDlg: { ...bundle.entDlg, rook: undefined } };
  const r2 = await runQuestE2e(noRook, 'burl.road');
  ok('hand-in not a character -> FAIL at 2 giver-character', !r2.ok && r2.firstFail.name === '2 giver-character' && r2.firstFail.detail.includes('rook'), JSON.stringify(r2.firstFail));
  const r3 = await runQuestE2e(bundle, 'no.such.quest');
  ok('unknown quest -> FAIL 0 loaded', !r3.ok && r3.firstFail.name === '0 loaded');
  const r4 = await runQuestE2e({ ...bundle, fetchJson: () => { throw new Error('offline'); } }, 'burl.road');
  ok('unloadable content -> FAIL 0 loaded', !r4.ok && r4.firstFail.name === '0 loaded', JSON.stringify(r4.firstFail));
}

console.log(`questE2eRun.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error(f); process.exit(1); }
