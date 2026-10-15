// DLG-REPEAT: postkeeper hello.1 on first talk (sets met.postkeeper), hello.2 afterwards, also after a save/load of the flags.
//   node game/js/quest/postkeeperDialogue.test.js
import { readFileSync } from 'node:fs';
import { loadContentPack, createDialogueRunner } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const root = new URL('../../../content/', import.meta.url);
const small = { kind: 'manifest', schema: 1, id: 'pk-test', contentVersion: 1, files: ['dialogue/postkeeper.dialogue.json'] };
const fetchText = async (u) => (u.endsWith('manifest.json') ? JSON.stringify(small) : readFileSync(new URL(u), 'utf8'));
const bundle = await loadContentPack(new URL('manifest.json', root).href, { fetchText });
const comp = bundle.dialogues.postkeeper;
ok('loads, no warnings', !!comp && !bundle.warnings.some((w) => /postkeeper/.test(w)), bundle.warnings.join('|'));

// flags backed by world.state['dlg.<k>'] like dialogueCtl (JSON round trip = save/load)
const mk = (state) => ({ has: (k) => state['dlg.' + k] === true, set: (k) => { state['dlg.' + k] = true; } });
function talk(state) {
  const said = [], r = createDialogueRunner({ pageLines: 1 });
  r.open(comp, mk(state));
  for (let g = 0; g < 30 && r.state !== 'ended'; g++) {
    if (r.state === 'typing') { said.push(r.line); r.press(); } else if (r.state === 'waiting') r.press();
  }
  return said;
}
let state = {};
const a = talk(state);
ok('first talk: hello.1 (2 lines) + met flag', a.length === 2 && a[0].startsWith('Saw your ship') && state['dlg.met.postkeeper'] === true, a.join('|'));
const b = talk(state);
ok('second talk: hello.2', b.length === 1 && b[0] === "Post's open. Take what you need.", b.join('|'));
state = JSON.parse(JSON.stringify(state));
const c = talk(state);
ok('after save/load still hello.2', c.length === 1 && c[0] === b[0], c.join('|'));
ok('lines <= 56 chars', [...a, ...b].every((l) => l.length <= 56));
// BEND-NPC-01: an old save with a moved errand open at Bram -> handover line (the quest itself hands in at Joss: allQuests.e2e + questBatch1)
for (const q of ['sq.rb.shield', 'sq.fc.cog']) for (const s of ['active', 'ready']) {
  const h = talk({ ['dlg.q.' + q + '.' + s]: true, 'dlg.met.postkeeper': true });
  ok('handover ' + q + ' ' + s, h.length === 2 && h[0].startsWith('Ask Joss'), h.join('|'));
}
console.log(`postkeeperDialogue: ${pass} pass, ${fail} fail`);
for (const m of failures) console.log('  FAIL ' + m);
process.exit(fail ? 1 : 0);
