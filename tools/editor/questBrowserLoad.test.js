// ED-QUEST-BROWSER: the browser load path (fetch -> in-memory fs) yields the same model as the Node path (node:fs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadQuests } from './quest/model.js';
import { loadDialogues } from './quest/lines.js';
import { fetchQuestFiles, fetchDialogueFiles, memFs } from './questPanel.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
globalThis.fetch = async (u) => {      // stub: URL -> file under repo root
  try { const text = readFileSync(ROOT + String(u).replace(/^(\.\.\/)+/, ''), 'utf8'); return { ok: true, status: 200, text: async () => text }; }
  catch { return { ok: false, status: 404, text: async () => '' }; }
};

const viaNode = loadQuests(ROOT + 'content/quests');
const viaFetch = loadQuests('q', memFs(await fetchQuestFiles()));
assert.ok(viaFetch.quests.length >= 10, 'quests loaded: ' + viaFetch.quests.length);
const key = (m) => m.quests.map((q) => [q.id, q.file, q.index, q.title]);
assert.deepEqual(key(viaFetch), key(viaNode));
for (const [f, v] of viaNode.files) { const w = viaFetch.files.get(f); assert.ok(w, f); assert.equal(w.text, v.text, f); }

const dfiles = await fetchDialogueFiles();
const dm = loadDialogues('d', memFs(dfiles));
assert.ok(dm.files.size >= 5, 'dialogue files: ' + dm.files.size);
for (const [n, v] of dm.files) assert.equal(v.text, readFileSync(ROOT + 'content/dialogue/' + n, 'utf8'), n);
console.log('questBrowserLoad ok: ' + viaFetch.quests.length + ' quests, ' + dm.files.size + ' dialogue files');

// Static import graph of the panel must stay browser-loadable: no `node:` specifiers and no .mjs (served as text/plain by python's http.server).
import { existsSync } from 'node:fs';
import path from 'node:path';
const seen = new Set(), bad = [];
(function walk(f) {
  if (seen.has(f)) return; seen.add(f);
  for (const m of readFileSync(f, 'utf8').matchAll(/^\s*(?:import|export)\s[^;'"]*?from\s*['"]([^'"]+)['"]/gm)) {
    const s = m[1];
    if (!s.startsWith('.') || s.endsWith('.mjs')) { bad.push(f + ' -> ' + s); continue; }
    const r = path.resolve(path.dirname(f), s); if (existsSync(r)) walk(r);
  }
})(fileURLToPath(new URL('./questPanel.js', import.meta.url)));
assert.deepEqual(bad.filter((b) => !b.includes('questBrowserLoad')), [], 'node/.mjs imports in the panel graph');
