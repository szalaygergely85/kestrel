// DIALOGUE-01a2 (architecture.md 38.28): content/dialogue/bear.dialogue.json through loadPack and the runner.
//   node game/js/quest/bearDialogue.test.js
import { readFileSync } from 'node:fs';
import { loadContentPack, createDialogueRunner } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const root = new URL('../../../content/', import.meta.url);
const real = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
ok('the content manifest lists the bear dialogue', real.files.includes('dialogue/bear.dialogue.json'));
// A one-file pack (the real manifest also pulls every mesh/bin, which is not this test's business).
const small = { kind: 'manifest', schema: 1, id: 'bear-test', contentVersion: 1, files: ['dialogue/bear.dialogue.json'] };
const fetchText = async (u) => (u.endsWith('manifest.json') ? JSON.stringify(small) : readFileSync(new URL(u), 'utf8'));
const bundle = await loadContentPack(new URL('manifest.json', root).href, { fetchText });
const comp = bundle.dialogues.bear;
ok('loadPack loads the bear dialogue (frozen, 8 nodes)', !!comp && Object.isFrozen(comp) && comp.nodes.length === 8);
ok('bear dialogue has no warnings (all nodes reachable)', !bundle.warnings.some((w) => /bear/.test(w)), bundle.warnings.join('|'));

const mkFlags = () => { const s = new Set(); return { s, has: (k) => s.has(k), set: (k) => s.add(k) }; };
// Run one conversation: at a choice node pick index `pick`. Returns the spoken lines (with speaker), clips seen, flags.
function walk(flags, pick) {
  const clips = [], said = [], events = [];
  const r = createDialogueRunner({ onEvent: (n, a) => events.push(n + ':' + a) });
  r.open(comp, flags);
  for (let guard = 0; guard < 100 && r.state !== 'ended'; guard++) {
    if (r.state === 'typing') { if (r.clip) clips.push(r.clip); said.push(r.speakerLabel + ': ' + r.line); r.press(); }
    else if (r.state === 'waiting') r.press();
    else if (r.state === 'choosing') { for (let i = 0; i < pick; i++) r.move(1); r.choose(); }
  }
  return { r, said, clips, events };
}

const common = ['BURL: Well. A cub from the loud hill, fallen out of the sky.', "YOU: ...Bears don't talk.", "BURL: And cubs don't fly. Yet here we both are."];
const close = 'BURL: Go on, sky-cub. Walk soft. The wild is listening.';
const branches = [
  ['a', 'BURL: Check my ears for brass, then. Gently.', []],
  ['b', 'BURL: One. The blue ones are mine. They are all blue.', ['laugh']],
  ['c', 'BURL: Since my grandmother was a cub. It never tires.', []],
];
for (let i = 0; i < 3; i++) {
  const [name, reply, extraClips] = branches[i];
  const f = mkFlags();
  const w = walk(f, i);
  ok(`branch ${name}: line order = 3 common + reply + close`, JSON.stringify(w.said) === JSON.stringify([...common, reply, close]), w.said.join(' / '));
  ok(`branch ${name}: ends with the talked flag set`, w.r.state === 'ended' && f.s.has('bear.talked') && f.s.size === 1);
  ok(`branch ${name}: clips = wave on l1${extraClips.length ? ' + laugh' : ''}`, JSON.stringify(w.clips) === JSON.stringify(['wave', ...extraClips]), w.clips.join());
  ok(`branch ${name}: flag event fired exactly once`, w.events.filter((e) => e === 'flag:bear.talked').length === 1);
}
{
  const f = mkFlags(); f.set('bear.talked');
  const w = walk(f, 0);
  ok('repeat mode: flag set -> only the repeat line, no choices', JSON.stringify(w.said) === JSON.stringify(['BURL: Back again? The berries are still mine. Mostly.']) && w.r.state === 'ended');
}
{
  // Esc halfway: the talked flag (set on the close node) is never set
  const f = mkFlags(); const r = createDialogueRunner({});
  r.open(comp, f); r.press(); r.press(); r.close();
  ok('closing early leaves the talked flag unset', !f.s.has('bear.talked'));
}
{
  const spk = bundle.dialogues.bear.speakers.map((s) => s.label).join();
  ok('speakers: BURL + YOU (player)', spk === 'BURL,YOU' && bundle.dialogues.bear.speakers[1].player === true);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
