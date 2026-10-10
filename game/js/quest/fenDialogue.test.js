// CH1-08a (architecture.md 38.37 item 6): content/dialogue/fen.dialogue.json through loadPack and the runner.
//   node game/js/quest/fenDialogue.test.js
import { readFileSync } from 'node:fs';
import { loadContentPack, createDialogueRunner } from '../../../engine/index.js';
import { makeOk } from '../../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const root = new URL('../../../content/', import.meta.url);
const real = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
ok('the content manifest lists the fen dialogue', real.files.includes('dialogue/fen.dialogue.json'));
const small = { kind: 'manifest', schema: 1, id: 'fen-test', contentVersion: 1, files: ['dialogue/fen.dialogue.json'] };
const fetchText = async (u) => (u.endsWith('manifest.json') ? JSON.stringify(small) : readFileSync(new URL(u), 'utf8'));
const bundle = await loadContentPack(new URL('manifest.json', root).href, { fetchText });
const comp = bundle.dialogues.fen;
ok('loadPack loads the fen dialogue (frozen)', !!comp && Object.isFrozen(comp) && comp.nodes.length > 30);
ok('no warnings (all nodes reachable)', !bundle.warnings.some((w) => /fen/.test(w)), bundle.warnings.join('|'));

const mk = (...have) => { const s = new Set(have); return { s, has: (k) => s.has(k), set: (k) => s.add(k) }; };
function walk(flags, picks) {
  const said = []; let ci = 0;
  const r = createDialogueRunner({});
  r.open(comp, flags);
  for (let g = 0; g < 200 && r.state !== 'ended'; g++) {
    if (r.state === 'typing') { said.push(r.speakerLabel + ': ' + r.line); r.press(); }
    else if (r.state === 'waiting') r.press();
    else if (r.state === 'choosing') { const p = picks[ci++] || 0; for (let i = 0; i < p; i++) r.move(1); r.choose(); }
  }
  return { said, r, choices: ci };
}
const has = (w, t) => w.said.some((l) => l.endsWith(t));

// 3 choice points; every pick path rejoins and ends with s.fen.met
for (const picks of [[0, 0, 0], [1, 1, 1], [0, 1, 0], [1, 0, 1]]) {
  const f = mk(); const w = walk(f, picks);
  ok(`picks ${picks}: 3 choice points, ends, sets s.fen.met`, w.choices === 3 && w.r.state === 'ended' && f.s.has('s.fen.met') && f.s.size === 1, w.choices + ' ' + w.said.length);
  ok(`picks ${picks}: rejoin lines present`, has(w, 'Just a lamp-trimmer.') && has(w, 'Magic, lad.') && has(w, 'Choose your friends carefully.') && has(w, 'Good.'));
}
{
  const w = walk(mk(), [0, 0, 0]);
  ok('who/things/chart path text', has(w, 'Fen. Just Fen.') && has(w, 'Old guardians. Beasts. Stranger things.') && has(w, 'And that line?') && !has(w, 'Boars are the least of it, friend.'));
  const v = walk(mk(), [1, 1, 1]);
  ok('startled/boars/nothing path text', has(v, 'Fen, by the way. Just Fen.') && has(v, 'Boars are the least of it, friend.') && has(v, 'Crown ink, and a pencil line. Not nothing.') && !has(v, 'And that line?'));
}
// repeat entry
{
  const f = mk('s.fen.met'); const w = walk(f, []);
  ok('repeat: 3 lines about the river road, no choices, no new flag', w.said.length === 3 && has(w, 'The river road. West, to the ford.') && w.choices === 0 && f.s.size === 1, w.said.length);
}
// Esc halfway: nothing set
{ const f = mk(); const r = createDialogueRunner({}); r.open(comp, f); r.press(); r.press(); r.close(); ok('Esc halfway sets nothing', f.s.size === 0); }
// graph-wide
{
  const reach = new Set(), st = comp.entry.map((e) => e.node);
  while (st.length) { const i = st.pop(); if (reach.has(i)) continue; reach.add(i); const n = comp.nodes[i]; if (n.next != null && n.next >= 0) st.push(n.next); for (const c of n.choices) st.push(c.next); }
  ok(`every node reachable (${reach.size}/${comp.nodes.length})`, reach.size === comp.nodes.length);
  ok('2 entries, last unconditional, first requires s.fen.met', comp.entry.length === 2 && comp.entry[1].requires === null && comp.entry[0].requires === 's.fen.met');
  const long = comp.nodes.flatMap((n) => n.lines).filter((l) => l.length > 56);
  ok('every line <= 56 chars', long.length === 0, long.join('|'));
  ok('D-013: no player name in the lines', !comp.nodes.flatMap((n) => n.lines).some((l) => /\bWick\b/.test(l)));
  const flags = new Set(comp.nodes.flatMap((n) => [n.setFlag, ...n.choices.map((c) => c.setFlag)]).filter(Boolean));
  ok('only flag set is s.fen.met', [...flags].join() === 's.fen.met', [...flags].join());
}
// world entity
{
  const wd = JSON.parse(readFileSync(new URL('worlds/world_m1.world.json', root), 'utf8'));
  const fen = wd.entities.find((e) => e.id === 'fen');
  ok('world: fen npc, char.fen hidden, kinematic collider, dialogue fen', !!fen && fen.type === 'npc' && fen.components.voxel.model === 'char.fen' && fen.components.voxel.hidden === true && fen.components.collider.kinematic === true && fen.components.dialogue === 'fen');
  const path = fen.components.walks.emerge;
  const end = path[path.length - 1], d = Math.hypot(end[0] - 1262, end[1] - 1033);
  ok('world: emerge has >= 3 points and ends 3-5 m from the relay', path.length >= 3 && d >= 3 && d <= 5, String(d));
}
console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
