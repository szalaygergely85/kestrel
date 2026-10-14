// QFIX-S4 / D-098 rule 4 / OB-155o,f: hand-in beats offer, active never blocks a hand-in, offer + hand-in windows, chain, requireItem consumed. Real pack defs.
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { compileDialogue, createDialogueRunner } from '../../../engine/index.js';
import { createQuestBook, ACTIVE, READY, DONE, AVAILABLE } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { questWindowDialogue, openQuestWindow, rewardText } from './questWindow.js';
import { turnInOf } from './sim/giverResolve.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const clone = id => { const d = structuredClone(all.find(x => x.id === id)); delete d.requires; delete d.opensAfter; return d; };
const nameOf = id => (assets.items?.defs?.[id]?.name) || id;
const pack = new Map();
const packOps = { count: id => pack.get(id) || 0, remove: (id, n) => pack.set(id, (pack.get(id) || 0) - n), add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: () => true };

// 1) hand-in beats offer + an active quest at the same entity never blocks a hand-in (sq.packet at the post while sq.fc.stores is active)
const stores = clone('sq.fc.stores'), packet = clone('sq.packet');
const b = createQuestBook(all.find(d => d.id === 'm1'), [stores, packet]); b.packOps = packOps;
const postOf = d => turnInOf(d); // QFIX-S5a-2: resolved turn-in (giverResolve), not the legacy field
ok(postOf(stores) === 'post' && postOf(packet) === 'post' || b.entityFor(postOf(packet)) === b.entityFor(postOf(stores)), 'packet + stores share the post: ' + postOf(stores) + '/' + postOf(packet));
b.accept('sq.fc.stores'); b.accept('sq.packet');
ok(b.statusOf('sq.fc.stores') === ACTIVE && b.statusOf('sq.packet') === ACTIVE, 'both active');
ok((pack.get('packet') || 0) >= 1, 'accept gave the packet');
const hd = postOf(packet);
let pl = b.plan(hd); ok(pl && pl.action === 'refuse', 'nothing ready: refuse (' + JSON.stringify(pl) + ')');
b.feed({ type: 'item:count', id: 'packet', n: pack.get('packet') });
ok(b.statusOf('sq.packet') === READY, 'packet READY');
pl = b.plan(hd); ok(pl && pl.action === 'handin' && pl.id === 'sq.packet', 'active stores does not block: ' + JSON.stringify(pl));
ok(b.inspect(hd, true).action === 'handin' && b.statusOf('sq.packet') === READY, 'ask=true acts on nothing');
ok(b.inspect(hd).action === 'handin' && b.statusOf('sq.packet') === DONE && !(pack.get('packet') > 0), 'hand-in done, packet consumed');

// 2) windows: offer = Accept/Decline + objectives + rewards; hand-in = Complete; no auto-accept
const names = { arrow: 'Arrow' };
ok(/Arrow x20/.test(rewardText(packet, id => names[id] || id)), 'reward plain names');
const mkFlags = () => { const set = []; return { set, has: () => false, setf: (k) => set.push(k) }; };
const run = (raw) => { const fl = mkFlags(); const r = createDialogueRunner({ cps: 1e6 }); r.open(compileDialogue(raw), { has: fl.has, set: fl.setf }); return { r, fl }; };
const offer = questWindowDialogue(clone('sq.packet'), 'offer', nameOf);
const o = offer.nodes['w.0'];
ok(o.choices.map(c => c.text).join() === '[E] Accept,[Q] Decline', 'offer buttons');
ok(o.lines.join('\n').includes('Reward:') && o.lines.join('\n').includes('Objective:') && o.lines.every(l => l.length <= 56), 'offer shows objective + reward, lines fit');
const hw = questWindowDialogue(clone('sq.packet'), 'handin', nameOf);
ok(hw.nodes['w.0'].choices.map(c => c.text).join() === '[E] Complete,[Q] Not yet', 'hand-in button = Complete');
{ const { r, fl } = run(offer); for (let i = 0; i < 400 && r.state !== 'choosing'; i++) { r.tick(1); if (r.state === 'waiting' || r.state === 'paged') r.press(); }
  ok(fl.set.length === 0, 'opening the offer accepts nothing (state ' + r.state + ')'); }

// 3) ctl stub: hand-in window -> next quest of the chain offered right away by the same entity
const a1 = clone('sq.packet'), a2 = clone('sq.fc.stores'); a1.giver.npc = a2.giver.npc = 'npcX'; a1.giver.turnIn = a1.giver.turnIn = 'npcX'; a2.objectives = [{ id: 'o', text: 'do', when: { type: 'flag', id: 'z', equals: true } }]; delete a2.giver.turnIn; delete a2.giver.turnInEntity; delete a1.giver.turnInEntity; delete a1.giver.entity; delete a2.giver.entity;
for (const ob of a1.objectives) if (ob.when.to) ob.when.to = 'npcX';
a2.requires = [{ quest: 'sq.packet', done: true }];
const p2 = new Map(); const bk = createQuestBook(all.find(d => d.id === 'm1'), [a1, a2]); bk.packOps = { ...packOps, count: id => p2.get(id) || 0, remove: (id, n) => p2.set(id, (p2.get(id) || 0) - n), add: (id, n) => { p2.set(id, (p2.get(id) || 0) + n); return n; } };
bk.accept('sq.packet'); bk.feed({ type: 'item:count', id: 'packet', n: p2.get('packet') });
const opened = []; let onEnd = null; const ctl = { open: false, openComp(comp, id, cb) { opened.push(comp.id); onEnd = cb; return true; } };
const args = { book: bk, ctl, compile: compileDialogue, nameOf, objectId: 'npcX' };
ok(openQuestWindow(args).action === 'handin' && opened[0] === 'qwin.sq.packet.handin', 'hand-in window first: ' + opened);
ok(bk.statusOf('sq.packet') === READY, 'not completed until the button');
bk.actKey('q.sq.packet.handin'); onEnd();
ok(opened[1] === 'qwin.sq.fc.stores.offer' && bk.statusOf('sq.fc.stores') === AVAILABLE, 'next chain quest offered right away: ' + opened);

console.log(`questWindow: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
