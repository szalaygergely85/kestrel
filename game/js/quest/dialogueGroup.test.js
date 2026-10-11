// OB-022: grouped dialogue pages on the real Burl / Rook content - E presses per conversation.
//   node --experimental-default-type=module game/js/quest/dialogueGroup.test.js
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { compileDialogue, createDialogueRunner } from '../../../engine/index.js';

const rd = (n) => compileDialogue(JSON.parse(readFileSync(new URL('../../../content/dialogue/' + n + '.dialogue.json', import.meta.url), 'utf8')));
const bear = rd('bear'), rook = rd('rook');
const flags = (...have) => { const s = new Set(have); return { s, has: (k) => s.has(k), set: (k) => s.add(k) }; };
/** Plays a conversation like the ctl: E completes the reveal, E again advances; at choices pick `pick`. Returns E presses + pages. */
function play(comp, f, opts, pick = 0) {
  const r = createDialogueRunner(opts), pages = []; let presses = 0;
  r.open(comp, f);
  for (let g = 0; g < 200 && r.state !== 'ended'; g++) {
    if (r.state === 'choosing') { r.selected = pick; r.choose(); continue; }
    if (r.state === 'typing') pages.push(r.speakerLabel + ': ' + r.line);
    r.press(); presses++;
  }
  return { presses, pages };
}
const R = 'q.tower.blade.ready';
const one = play(bear, flags(R), { pageLines: 1 }), grp = play(bear, flags(R), {});
console.log('Burl first talk: E presses', one.presses, '->', grp.presses);
// the first talk alternates YOU/BURL a lot (a speaker change always splits), so the cap is -40%; long monologues halve
assert.ok(grp.presses <= one.presses * 0.6, 'Burl first talk: <= 60% of the presses (' + one.presses + ' -> ' + grp.presses + ')');
for (const [name, comp, f] of [['burl first', bear, () => flags(R)], ['burl stone', bear, () => flags('s.burl.arrived', 'q.burl.boars.done', 's.burl.follow')], ['rook meet', rook, () => flags()]]) {
  const g = play(comp, f(), {}), u = play(comp, f(), { pageLines: 1 }); console.log(name + ': E presses', u.presses, '->', g.presses);
  for (let i = 1; i < g.pages.length; i++) assert.ok(g.pages[i].length > 0, name);
  assert.ok(g.presses < u.presses, name);
  for (const p of g.pages) assert.ok(p.length <= 215, name + ': page too long ' + p.length);
}
// Every page stays inside the box (4 rows x 88 wide, word-wrapped) - checked with a simple greedy wrap.
const rows = (t, w = 88) => { let n = 1, cx = 0; for (const word of t.split(' ')) { if (cx && cx + 1 + word.length > w) { n++; cx = 0; } cx += (cx ? 1 : 0) + word.length; } return n; };
for (const f of [flags(R), flags('s.waystone.waystone.woken'), flags('s.burl.arrived')]) for (const p of play(bear, f, {}).pages) assert.ok(rows(p) <= 4, 'box rows: ' + p);
console.log('dialogueGroup: ALL PASS');
