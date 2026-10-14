// QFIX-S4b / D-098 rule 4 for NPC talk: Burl (bear), Rook, Hesk, Dorrin. Real content: ready -> hand-in window first, offer -> story then offer window,
// nothing accepted on Decline, no accept/handin flags left inside the dialogues, story lines still reachable.
import { fileURLToPath } from 'node:url';
import { giverOf, turnInOf } from './sim/giverResolve.js';
import { readFileSync } from 'node:fs';
import { makeOk } from '../../../engine/test/assert.js';
import { compileDialogue, createDialogueRunner } from '../../../engine/index.js';
import { createQuestBook, READY, DONE, AVAILABLE, ACTIVE } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { npcQuestTalk } from './questWindow.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const NPCS = ['bear', 'rook', 'hesk', 'dorrin'];
const dlg = Object.fromEntries(NPCS.map(n => [n, JSON.parse(readFileSync(fileURLToPath(new URL(`../../../content/dialogue/${n}.dialogue.json`, import.meta.url)), 'utf8'))]));
const nameOf = id => id;

// 1) no accept / handin flag survives inside the four dialogues (the windows own them)
for (const n of NPCS) {
  const bad = []; for (const [k, nd] of Object.entries(dlg[n].nodes)) for (const f of [nd.setFlag, ...(nd.choices || []).map(c => c.setFlag)]) if (f && /\.(accept|handin)$/.test(f)) bad.push(k + ':' + f);
  ok(bad.length === 0, n + ': no accept/handin flags in dialogue ' + bad.join());
}

// 2) per quest of each NPC: stub ctl records what opens in which order
const handles = (n) => all.filter(d => d.giver && (giverOf(d) === n || turnInOf(d) === n)).map(d => d.id);
for (const n of NPCS) {
  const ids = handles(n);
  if (!ids.length) { ok(true, n + ': no quests (talk is plain)'); continue; }
  for (const id of ids) {
    const d = structuredClone(all.find(x => x.id === id)); delete d.requires; delete d.opensAfter; delete d.requireItem; delete d.requireEquipped;
    d.objectives = [{ id: 'o', text: 'do', when: { type: 'flag', id: 'zz.' + id, equals: true } }];
    const mk = () => { const bk = createQuestBook(all.find(x => x.id === 'm1'), [d]); bk.packOps = { count: () => 0, remove() {}, add: () => 0, equipped: () => true }; return bk; };
    const log = []; let cb = null;
    const ctl = { open: false, openFor(nid, skip, end) { log.push('story:' + nid + (skip ? '' : '!gate')); cb = end; return !!dlg[nid]; }, openComp(comp, nid, end) { log.push(comp.id); cb = end; return true; } };
    const st = {};
    // offered: story first (no accept in it), then the offer window; Decline leaves it AVAILABLE
    let bk = mk(); ok(bk.statusOf(id) === AVAILABLE, id + ' available');
    if (giverOf(d) === n) {
      const go = () => npcQuestTalk({ book: bk, ctl, compile: compileDialogue, nameOf, npcId: n, state: st });
      ok(go() === true && log[0] === 'story:' + n, n + '/' + id + ' offer: story first ' + log);
      ok(bk.statusOf(id) === AVAILABLE, 'story alone accepts nothing'); cb();
      ok(log[1] === 'qwin.' + id + '.offer', 'then the offer window: ' + log); cb(); // closing with Decline = no flag set
      ok(bk.statusOf(id) === AVAILABLE, 'Decline keeps it available');
      bk.actKey('q.' + id + '.accept'); ok(bk.statusOf(id) === ACTIVE, 'Accept button accepts');
    } else { bk.accept(id); }
    // ready: hand-in window first; "Not yet" opens no story; Complete opens the story with <npc>.after.<id> set for that open only
    bk = mk(); bk.accept(id); bk.feed({ type: 'flag:set', key: 'zz.' + id, value: true });
    if (turnInOf(d) === n) {
      ok(bk.statusOf(id) === READY, id + ' ready');
      log.length = 0;
      const go = () => npcQuestTalk({ book: bk, ctl, compile: compileDialogue, nameOf, npcId: n, state: st });
      ok(go() === true && log[0] === 'qwin.' + id + '.handin' && log.length === 1, n + '/' + id + ' ready: hand-in window FIRST ' + log);
      cb(); ok(log.length === 1 && bk.statusOf(id) === READY, 'Not yet: no story, still ready');
      let sawFlag = false; ctl.openFor = (nid, skip, end) => { sawFlag = !!st['dlg.' + n + '.after.' + id]; log.push('story:' + nid); cb = end; return true; };
      go(); bk.actKey('q.' + id + '.handin'); cb();
      ok(bk.statusOf(id) === DONE && log[1] === 'story:' + n && sawFlag && !st['dlg.' + n + '.after.' + id], 'Complete -> story with after-flag, cleared after: ' + log);
    }
  }
}

// 3) story lines still reachable: every node is reachable from an entry or a next/choice, and the after-entries start the old ready lines
for (const n of NPCS) {
  const comp = compileDialogue(dlg[n]); // throws on a broken graph
  const seen = new Set(dlg[n].entry.map(e => e.node)); let grew = true;
  while (grew) { grew = false; for (const k of [...seen]) { const nd = dlg[n].nodes[k]; for (const t of [nd.next, ...(nd.choices || []).map(c => c.next)]) if (t && !seen.has(t)) { seen.add(t); grew = true; } } }
  const orphan = Object.keys(dlg[n].nodes).filter(k => !seen.has(k));
  ok(orphan.length === 0 && comp, n + ': no orphan nodes ' + orphan.join());
}
const first = (n, flags) => { const r = createDialogueRunner({ cps: 1e6 }); r.open(compileDialogue(dlg[n]), { has: k => flags.includes(k), set() {} }); return r.line; };
ok(/berries/.test(first('bear', ['bear.after.burl.boars'])), 'bear: boars ready lines after hand-in');
ok(/Nobody|Oh, look/.test(first('bear', ['bear.after.sq.burl.blue'])) || /look at them/.test(first('bear', ['bear.after.sq.burl.blue'])), 'bear: blue ready lines after hand-in');
ok(/fall/.test(first('bear', ['bear.after.tower.blade'])), 'bear: meeting lines after tower.blade hand-in: ' + first('bear', ['bear.after.tower.blade']));
ok(/Counted/.test(first('rook', ['rook.after.mq.bend.call'])), 'rook: counted lines after hand-in');

console.log(`npcQuestTalk: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
