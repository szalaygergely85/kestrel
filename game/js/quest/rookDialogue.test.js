// QL-06: content/dialogue/rook.dialogue.json - entry order by flag state, flags set, line lengths.
//   node game/js/quest/rookDialogue.test.js
import { readFileSync } from 'node:fs';
import { loadContentPack, createDialogueRunner } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const root = new URL('../../../content/', import.meta.url);
const real = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
ok('manifest lists the rook dialogue', real.files.includes('dialogue/rook.dialogue.json'));
const small = { kind: 'manifest', schema: 1, id: 'rook-test', contentVersion: 1, files: ['dialogue/rook.dialogue.json'] };
const fetchText = async (u) => (u.endsWith('manifest.json') ? JSON.stringify(small) : readFileSync(new URL(u), 'utf8'));
const bundle = await loadContentPack(new URL('manifest.json', root).href, { fetchText });
const comp = bundle.dialogues.rook;
ok('loads (frozen), no warnings (all nodes reachable)', !!comp && Object.isFrozen(comp) && !bundle.warnings.some((w) => /rook/.test(w)), bundle.warnings.join('|'));

const mk = (...have) => { const s = new Set(have); return { s, has: (k) => s.has(k), set: (k) => s.add(k) }; };
function walk(f) {
  const said = [], clips = [];
  const r = createDialogueRunner({ pageLines: 1 });
  r.open(comp, f);
  for (let g = 0; g < 60 && r.state !== 'ended'; g++) {
    if (r.state === 'typing') { if (r.clip) clips.push(r.clip); said.push(r.speakerLabel + ': ' + r.line); r.press(); }
    else if (r.state === 'waiting') r.press();
    else if (r.state === 'choosing') r.choose();
  }
  return { said, clips };
}
const R = (t) => 'ROOK: ' + t;

{ const f = mk(); const w = walk(f);
  ok('meet: 8 lines, YOU answers on 2 and 6, caw clip, sets the quest accept', w.said.length === 8 && w.said[0] === R('Ha. The fell-bird walks.') && w.said[1] === 'YOU: ...You talk too.' && w.said[5].startsWith('YOU: ') && w.clips[0] === 'caw' && f.s.has('s.mq.bend.call.accept') && f.s.size === 1, w.said.length); }
{ const w = walk(mk('s.mq.bend.call.active')); ok('active: one line', w.said.length === 1 && w.said[0] === R('Count the blinks. Then the knot. Then me.')); }
{ const f = mk('s.mq.bend.call.ready', 's.mq.bend.call.active'); const w = walk(f);
  ok('ready: 6 lines, hand-in flag, ready wins over active', w.said.length === 6 && w.said[3] === R('Here. Paper. River on it. Not shiny.') && f.s.has('s.mq.bend.call.handin')); }
{ const w = walk(mk('s.mq.bend.call.done')); ok('repeat at the Bend', w.said.length === 1 && w.said[0] === R('River. West. Do not drown, fell-bird.')); }
{ const f = mk('s.mq.bend.call.done', 's.mq.ford.mirror.available'); const w = walk(f);
  ok('ford: 7 lines, accept flag, wins over bend.done', w.said.length === 7 && w.said[0] === R('Slow walker. Wet boots?') && f.s.has('s.mq.ford.mirror.accept')); }
{ const w = walk(mk('s.mq.bend.call.done', 's.mq.ford.mirror.active')); ok('mirror active hint', w.said.length === 1 && /Look inside/.test(w.said[0])); }
{ const f = mk('s.mq.bend.call.done', 's.waystone.ws_ford.woken'); const w1 = walk(f);
  ok('mirror done: 2 lines once, sets rook.mirror.told', w1.said.length === 2 && f.s.has('rook.mirror.told'));
  const w2 = walk(f); ok('then the ford repeat (smoke hint)', w2.said.length === 1 && /smoke/.test(w2.said[0])); 
  f.set('s.mq.smoke.done'); const w3 = walk(f); ok('after mq.smoke: repeat2', w3.said.length === 1 && /Wet boots, full pack/.test(w3.said[0])); }
{ const f = mk(); const all = []; for (const n of comp.nodes) for (const l of n.lines) all.push(l);
  ok('every line <= 56 ASCII chars', all.every((l) => l.length <= 56 && /^[\x20-\x7e]+$/.test(l))); }
console.log(`rookDialogue: ${pass} pass, ${fail} fail`); failures.forEach((m) => console.log('  FAIL', m));
process.exit(fail ? 1 : 0);
