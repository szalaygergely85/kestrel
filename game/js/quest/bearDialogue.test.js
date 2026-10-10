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
ok('loadPack loads the bear dialogue (frozen)', !!comp && Object.isFrozen(comp) && comp.nodes.length > 30);
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

const mk = (...have) => { const f = mkFlags(); for (const h of have) f.s.add(h); return f; };
const ids = JSON.stringify;
const first = (w) => w.said[0];
const lastOf = (w) => w.said[w.said.length - 1];
const burl = (t) => 'BURL: ' + t;
const you = (t) => 'YOU: ' + t;

// 1 departing
{ const f = mk('s.burl.departing', 's.waystone.waystone.woken', 's.burl.arrived', 'bear.talked'); const w = walk(f, 0);
  ok('1 departing: wins over every other flag, one farewell line, no new flags', ids(w.said) === ids([burl('Go on, sky-cub. The road is west.')]) && f.s.size === 4); }
// 2 woken
{ const f = mk('s.waystone.waystone.woken', 's.burl.arrived'); const w = walk(f, 0);
  ok('2 woken: starts with the player asking, 13 lines', first(w) === you('What is that?') && w.said.length === 13, w.said.length);
  ok('2 woken: last node sets s.burl.depart (only new flag)', lastOf(w) === burl('The world is wider than your Wall.') && f.s.has('s.burl.depart') && f.s.size === 3); }
// 3 arrived (the stone talk)
{ const f = mk('s.burl.arrived', 'q.burl.boars.done', 's.burl.follow'); const w = walk(f, 0);
  ok('3 arrived: stone talk, 18 lines, ends on the crystal line', first(w) === burl('There we are.') && w.said.length === 18 && lastOf(w) === burl('Hold that crystal up to the carved mark.'), w.said.length);
  ok('3 arrived: sets bear.stone.told, no lamp', f.s.has('bear.stone.told') && !w.said.some((l) => /lamp/i.test(l))); }
// 3b following (CH1-07): no follow offer replay, no flags, one line; arrived wins
{ const f = mk('q.burl.boars.done', 's.burl.follow', 'bear.talked'); const w = walk(f, 0);
  ok('3b following: one placeholder line, no offer, no new flags', w.said.length === 1 && !w.said[0].includes('Come along') && f.s.size === 3, w.said.join('|')); }
// 4 done -> follow offer
{ const f = mk('q.burl.boars.done'); const w = walk(f, 0);
  ok('4 done: follow offer (5 lines) sets s.burl.follow', first(w) === burl('Come along, sky-cub.') && w.said.length === 5 && f.s.has('s.burl.follow'), w.said.length); }
// 5 ready -> thanks -> follow
{ const f = mk('q.burl.boars.ready'); const w = walk(f, 0);
  ok('5 ready: 7 after-five lines, thanks (hand-in), then the 5 follow lines', w.said.length === 7 + 1 + 5 && w.said[7] === burl("You've done an old bear a kindness.") && w.said[8] === burl('Come along, sky-cub.'), w.said.length + ' ' + w.said[7]);
  ok('5 ready: hand-in flag then s.burl.follow', ids(w.events.filter((e) => e.startsWith('flag:'))) === ids(['flag:q.burl.boars.handin', 'flag:s.burl.follow']), w.events.join());
  ok('5 ready: wave clip on the thanks node', w.clips.includes('wave'));
  const g = mk('q.burl.boars.ready'); const r = createDialogueRunner({}); r.open(comp, g);
  for (let i = 0; i < 40 && !g.s.has('q.burl.boars.handin'); i++) r.press();
  r.close();
  ok('5 ready: Esc right after the hand-in keeps handin, no follow flag yet', g.s.has('q.burl.boars.handin') && !g.s.has('s.burl.follow')); }
// 6 active
{ const f = mk('q.burl.boars.active', 'bear.talked'); const w = walk(f, 0);
  ok('6 active: two lines, no flags', w.said.length === 2 && w.said[0] === burl('Still hearing those greedy snouts.') && f.s.size === 2); }
// 7 available: accept / later
{ const f = mk('q.burl.boars.available', 'bear.talked'); const w = walk(f, 0);
  ok('7 available accept: 10 offer lines + 2 accepted, sets q.burl.boars.accept', w.said.length === 12 && f.s.has('q.burl.boars.accept') && lastOf(w) === burl('Mind their tusks, sky-cub.'), w.said.length);
  const g = mk('q.burl.boars.available'); const w2 = walk(g, 1);
  ok('7 available later: kept later line (laugh), no accept flag', lastOf(w2) === burl('Then sit a while. The boars will still be rude.') && !g.s.has('q.burl.boars.accept') && w2.clips.includes('laugh'));
  const h = mk('q.burl.boars.available'); const r = createDialogueRunner({}); r.open(comp, h); r.press(); r.close();
  ok('7 Esc keeps the quest un-accepted', !h.s.has('q.burl.boars.accept')); }
// 8 repeat
{ const f = mk('bear.talked'); const w = walk(f, 0);
  ok('8 talked: only the repeat line', ids(w.said) === ids([burl('Back again? The berries are still mine. Mostly.')])); }
// 9 first encounter = turning in 'A Blade in the Ashes' (q.tower.blade.ready); flows into the boar offer
const R = 'q.tower.blade.ready';
{
  const f = mk(R); const w = walk(f, 0); // meet choice 0 (crash), offer choice 0 (accept)
  ok('9 fresh: opens with the quote, 10 meet lines then the crash exchange', first(w) === burl('Quite a fall you took, sky-cub.') && w.said[9] === burl('but a bear with words troubles you?') && w.said[10] === burl('Hard to miss a burning sky-boat.') && w.said[13] === burl('Not much of one now.'), w.said.slice(8, 14).join('|'));
  ok('9 fresh crash+accept: 10 + 4 + 10 + 2 = 26 lines; talked + accept set', w.said.length === 26 && f.s.has('bear.talked') && f.s.has('q.burl.boars.accept'), w.said.length);
  ok('9 fresh: wave clip on the first line', w.clips[0] === 'wave');
  const g = mk(R); const w2 = walk(g, 1); // meet choice 1 (west) skips the crash lines; offer choice 1 (Not yet)
  ok('9 fresh west+later: no crash lines (10 + 10 + 1 = 21), talked set, no accept, blade handed in', !w2.said.includes(burl('Hard to miss a burning sky-boat.')) && w2.said.length === 21 && g.s.has('bear.talked') && g.s.has('q.tower.blade.handin') && !g.s.has('q.burl.boars.accept'), w2.said.length);
  const h = mk(R); const r = createDialogueRunner({}); r.open(comp, h); r.press(); r.press(); r.close();
  ok('9 Esc halfway through the meet: nothing set', h.s.size === 1 && !h.s.has('q.tower.blade.handin'));
}
// 9b before the blade is done: one pre-quest line, no flags, nothing offered
{ for (const have of [[], ['q.tower.blade.available']]) { const f = mk(...have); const w = walk(f, 0);
  ok('9b early (' + have + '): early lines, no new flags', ids(w.said) === ids([burl('Out of the tower already, sky-cub? Empty-pawed?'), burl('Climb back up. The top holds more than a view.')]) && f.s.size === have.length, w.said.join('|')); } }
// 9c PO-CH1-01: blade accepted but not ready -> its own placeholder node (NEEDS WRITER), not 'Empty-pawed?'
{ const f = mk('q.tower.blade.active'); const w = walk(f, 0); ok('9c blade active: bear.blade.wait placeholder, no flags', w.said.length === 1 && w.said[0].includes('NEEDS WRITER') && f.s.size === 1, w.said.join('|')); }
// graph-wide
{
  const reach = new Set(), st = comp.entry.map((e) => e.node);
  while (st.length) { const i = st.pop(); if (reach.has(i)) continue; reach.add(i); const n = comp.nodes[i]; if (n.next != null && n.next >= 0) st.push(n.next); for (const c of n.choices) st.push(c.next); }
  ok(`every node reachable (${reach.size}/${comp.nodes.length})`, reach.size === comp.nodes.length);
  ok('12 entries, last is unconditional', comp.entry.length === 12 && comp.entry[11].requires === null);
  const long = comp.nodes.flatMap((n) => n.lines).filter((l) => l.length > 56);
  ok('every line <= 56 chars', long.length === 0, long.join('|'));
  ok('D-013: no player name in the lines', !comp.nodes.flatMap((n) => n.lines).some((l) => /\bWick\b/.test(l)));
  const flags = new Set(comp.nodes.flatMap((n) => [n.setFlag, ...n.choices.map((c) => c.setFlag)]).filter(Boolean));
  ok('flags set by the graph', ids([...flags].sort()) === ids(['bear.stone.told', 'bear.talked', 'q.burl.boars.accept', 'q.burl.boars.handin', 'q.tower.blade.handin', 's.burl.depart', 's.burl.follow']), [...flags].join());
}
// barks file shape
{
  const bk = JSON.parse(readFileSync(new URL('dialogue/bear.barks.json', root), 'utf8'));
  ok('barks: bear.call (3), bear.walk1 (4), bear.walk2 (6)', bk.barks['bear.call'].length === 3 && bk.barks['bear.walk1'].length === 4 && bk.barks['bear.walk2'].length === 6);
  ok('barks: every speaker declared, lines <= 56', Object.values(bk.barks).flat().every((l) => bk.speakers[l.who] && l.text.length <= 56));
  ok('barks: BURL + YOU (player) speakers', bk.speakers.burl.label === 'BURL' && bk.speakers.you.player === true);
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) { for (const f of failures) console.log(' - ' + f); process.exit(1); } else console.log('ALL PASS');
