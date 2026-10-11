// OB-030: pure autosave snapshot logic. Run: node tools/editor/autosave.test.mjs
import { buildSnapshot, snapshotDiffers, applySnapshot, formatAge } from './autosave.js';
import { makeOk } from '../../engine/test/assert.js';
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

function mkDoc() {
  const mk = (kind, id, def) => ({ kind, id, def, meta: { schema: 1, nextId: 5, url: null }, dirty: false, handle: null });
  const files = new Map([
    ['world/w', mk('world', 'w', { name: 'w', entities: [] })],
    ['level/l', mk('level', 'l', { name: 'l' })],
  ]);
  return { worldId: 'w', files, readOnly: false };
}
function mkAssets(doc) {
  return { replace(kind, id, def) { doc.files.get(`${kind}/${id}`).def = def; } };
}
const doc = mkDoc();
ok(buildSnapshot(doc) === null, 'clean doc -> no snapshot');
const w = doc.files.get('world/w');
w.dirty = true; w.def.editorGroups = [{ name: 'g', ids: ['a'] }]; w.meta.nextId = 9;
const snap = buildSnapshot(doc, 1000);
ok(snap && Object.keys(snap.files).join() === 'world/w', 'only dirty files in snapshot');
ok(snap.files['world/w'].includes('editorGroups'), 'editorGroups included');
ok(snapshotDiffers(doc, snap).length === 0, 'same state -> no diff');

// "new session": fresh doc with the on-disk content
const fresh = mkDoc();
const diff = snapshotDiffers(fresh, snap);
ok(diff.join() === 'world/w', 'fresh doc differs');
const done = applySnapshot(fresh, mkAssets(fresh), JSON.parse(JSON.stringify(snap)));
const fw = fresh.files.get('world/w');
ok(done.join() === 'world/w' && fw.dirty, 'restored and marked dirty');
ok(fw.def.editorGroups && fw.def.editorGroups[0].name === 'g' && fw.meta.nextId === 9, 'def + nextId restored');
ok(snapshotDiffers(fresh, snap).length === 0, 'round trip is stable');
ok(applySnapshot(fresh, mkAssets(fresh), { v: 1, files: { 'world/zzz': '{}', 'world/w': 'not json' } }).length === 0, 'garbage/unknown skipped');
ok(applySnapshot(fresh, mkAssets(fresh), null).length === 0, 'null snapshot ok');
ok(formatAge(1000, 31000) === '30s ago' && formatAge(0, 120000) === '2 min ago', 'formatAge');
console.log(`autosave.test: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
