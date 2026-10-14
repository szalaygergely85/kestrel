// QFIX-S4c / D-098 / OB-155: "This item begins a quest" - sq.packet (takeGiverOnAccept): E -> offer window; Accept = packet in the pack + entity gone;
// Decline = nothing; the removal survives save/reload; the post hand-in consumes the packet. Real pack defs, stub world + ctl.
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { compileDialogue } from '../../../engine/index.js';
import { createQuestBook, ACTIVE, READY, DONE, AVAILABLE } from './sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { openQuestWindow, takeGiverOnAccept } from './questWindow.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const clone = id => { const d = structuredClone(all.find(x => x.id === id)); delete d.requires; delete d.opensAfter; return d; };
const nameOf = id => id;
const def = clone('sq.packet');
ok(def.takeGiverOnAccept === true && def.objectGiver !== undefined || def.takeGiverOnAccept === true, 'sq.packet carries takeGiverOnAccept');
ok(def.abandonable === false, 'a taken giver cannot be abandoned back');

// stub world: entities packet + post; removal is the persisted part ("save" = the removed set)
const mkWorld = (removed) => { const ents = new Set(['packet', 'post']); for (const r of removed) ents.delete(r); const gone = new Set(removed), inter = new Set(['qi.packet', 'qi.post']);
  return { gone, inter, get: id => ents.has(id) ? { id } : null, remove: id => { ents.delete(id); gone.add(id); }, removeInteractable: k => inter.delete(k) }; };
const mkSession = (world, pack) => {
  const packOps = { count: id => pack.get(id) || 0, remove: (id, n) => pack.set(id, (pack.get(id) || 0) - n), add: (id, n) => { pack.set(id, (pack.get(id) || 0) + n); return n; }, equipped: () => true };
  const book = createQuestBook(all.find(d => d.id === 'm1'), [clone('sq.packet')]); book.packOps = packOps;
  book.onChange = (name, id) => { if (name === 'quest:accepted') takeGiverOnAccept(book, world, id); };
  const opened = []; let onEnd = null;
  const ctl = { open: false, openComp: (comp, anchor, cb) => { opened.push(comp.rawId); onEnd = cb; return true; } };
  const press = (id) => openQuestWindow({ book, ctl, compile: (r) => ({ rawId: r.id, comp: compileDialogue(r) }), nameOf, objectId: id });
  return { book, packOps, opened, press, close: () => { const f = onEnd; onEnd = null; if (f) f(); } };
};

// 1) E on the packet -> offer window, nothing taken yet; Decline leaves everything
{ const w = mkWorld([]), pack = new Map(), s = mkSession(w, pack);
  const pl = s.press('packet');
  ok(pl && pl.action === 'offer' && pl.id === 'sq.packet', 'E on the packet opens the offer window: ' + JSON.stringify(pl));
  ok(s.opened[0] === 'qwin.sq.packet.offer', 'offer window id: ' + s.opened);
  ok(s.book.statusOf('sq.packet') === AVAILABLE && !pack.get('packet') && w.get('packet') && w.inter.has('qi.packet'), 'opening alone takes nothing');
  s.close(); // Decline = the window closes without the accept flag
  ok(s.book.statusOf('sq.packet') === AVAILABLE && !pack.get('packet') && w.get('packet'), 'Decline: nothing, the packet still lies there');
  ok(s.press('packet') && s.opened.length === 2, 'it can be offered again');
}
// 2) Accept -> pack + entity removed + prompt removed + quest active; save/reload keeps it; hand-in consumes
{ const w = mkWorld([]), pack = new Map(), s = mkSession(w, pack);
  s.press('packet'); s.book.actKey('q.sq.packet.accept'); s.close();
  ok(s.book.statusOf('sq.packet') === ACTIVE, 'Accept: quest active');
  ok(pack.get('packet') === 1, 'Accept: packet in the pack');
  ok(!w.get('packet') && w.gone.has('packet') && !w.inter.has('qi.packet') && w.get('post'), 'Accept: packet entity + prompt gone, post stays');
  // save / reload: persisted removed set + book save
  const saved = JSON.stringify([...w.gone]), w2 = mkWorld(JSON.parse(saved));
  ok(!w2.get('packet') && w2.get('post'), 'reload: the packet stays taken');
  const saveBook = JSON.parse(JSON.stringify(s.book.toSave())), s2 = mkSession(w2, pack); // reload: book from its save, same pack
  const rb = createQuestBook(all.find(d => d.id === 'm1'), [clone('sq.packet')], saveBook); rb.packOps = s2.packOps; s2.book = rb;
  ok(rb.statusOf('sq.packet') === ACTIVE, 'reload: quest still active');
  s.book.feed({ type: 'item:count', id: 'packet', n: 1 });
  ok(s.book.statusOf('sq.packet') === READY, 'packet in the pack = ready to hand in');
  const hp = def.giver.turnIn || def.giver.npc, hl = s.press(hp);
  ok(hl && hl.action === 'handin', 'E at the post opens the hand-in window: ' + JSON.stringify(hl));
  s.book.actKey('q.sq.packet.handin'); s.close();
  ok(s.book.statusOf('sq.packet') === DONE && !(pack.get('packet') > 0), 'hand-in done, packet consumed (requireItem path)');
}
// 3) the flag is generic: takeGiverOnAccept is a no-op for a quest without it (boards/notes stay)
{ const w = mkWorld([]), d2 = clone('sq.fc.stores'); const b = createQuestBook(all.find(d => d.id === 'm1'), [d2]);
  ok(!takeGiverOnAccept(b, w, 'sq.fc.stores') && w.get('post'), 'quests without the flag take nothing'); }

console.log(`packetTake: ${pass} pass, ${fail} fail`);
if (fail) { for (const m of failures) console.error('FAIL ' + m); process.exit(1); }
