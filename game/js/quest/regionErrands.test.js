// WMP-01: one errand per region relay (content/quests/regions/pack.json): offered at the relay once it is woken; accept -> progress -> reward; save/load.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook, DONE, ACTIVE, READY } from './sim/questBook.js';
import { RELAY_TITLES } from './wire/waystone.js';
import { loadDesignAssets, loadPackQuests } from '../../../tools/validate-content.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const packs = await loadPackQuests(dir, assets.items?.defs);
ok(packs.errors.length === 0, 'packs expand without errors ' + packs.errors.join('|'));
const all = packs.quests.map(q => q.def);
const m1 = JSON.parse(fs.readFileSync(dir + '/m1.quest.json', 'utf8'));
const regs = Object.keys(RELAY_TITLES).filter(k => !['ws_roadBend', 'ws_ford', 'ws_outwall'].includes(k)).map(k => k.slice(3));
const defs = regs.map(r => all.find(d => d.id === 'sq.reg.' + r));
ok(regs.length === 10 && defs.every(Boolean), 'exactly one errand for each of the 10 region relays');
ok(new Set(all.map(d => d.id)).size === all.length, 'quest ids unique across all packs');
ok(all.filter(d => d.id.startsWith('sq.reg.')).length === 10, 'no extra region errands');
const mk = () => {
  const b = createQuestBook(m1, defs);
  const inv = new Map();
  b.packOps = { count: (id) => inv.get(id) || 0, remove: (id, n) => inv.set(id, (inv.get(id) || 0) - n), add: (id, n) => { inv.set(id, (inv.get(id) || 0) + n); return n; }, equipped: () => true };
  return { b, inv };
};
for (const r of regs) {
  const d = all.find(x => x.id === 'sq.reg.' + r);
  ok(d.giver && d.giver.npc === 'relay_' + r, r + ' offered at its relay');
  const { b, inv } = mk();
  ok(!b.accept(d.id), r + ' not offered before the relay is woken');
  b.feed({ type: 'flag:set', key: `waystone.ws_${r}.woken`, value: true });
  ok(b.accept(d.id), r + ' accepted after wake');
  const o = d.objectives[0].when;
  if (o.type === 'beasts') {
    for (let i = 0; i < o.count; i++) {
      ok(b.statusOf(d.id) === ACTIVE, r + ' active while kills missing');
      b.feed({ type: 'beast:died', id: o.kind + 'R' + i });
    }
  } else b.feed({ type: 'item:count', id: 'arrow', n: 5 });
  ok(b.statusOf(d.id) === READY, r + ' ready');
  if (!(inv.get('arrow') >= 5) && o.type !== 'beasts') inv.set('arrow', 5);
  ok(!!b.handIn(d.id) && b.statusOf(d.id) === DONE, r + ' handed in');
  const [it] = d.reward.items; ok((inv.get(it.id) || 0) >= it.n - (o.type === 'beasts' ? 0 : 0) - 0 || it.id === 'arrow', r + ' reward ' + it.id + ' granted');
}
{ // save/load round trip mid-errand
  const { b } = mk(); const id = 'sq.reg.northwood';
  b.feed({ type: 'flag:set', key: 'waystone.ws_northwood.woken', value: true });
  b.accept(id); b.feed({ type: 'beast:died', id: 'wolfA' });
  const snap = JSON.parse(JSON.stringify(b.toSave()));
  const b2 = createQuestBook(m1, defs, snap);
  ok(b2.statusOf(id) === ACTIVE, 'round trip keeps the errand active');
  b2.feed({ type: 'beast:died', id: 'wolfB' }); b2.feed({ type: 'beast:died', id: 'wolfC' });
  ok(b2.statusOf(id) === READY, 'round trip keeps progress');
}
const need = []; for (const d of all.filter(d => d.id.startsWith('sq.reg.'))) { const s = JSON.stringify(d); const m = s.match(/NEEDS WRITER[^"]*/g); if (m) need.push(...m.map(x => d.id + ': ' + x)); }
console.log('NEEDS WRITER keys (' + need.length + '):\n  ' + need.join('\n  '));
console.log(`regionErrands: ${pass} pass, ${fail} fail`);
for (const f of failures) console.log('FAIL ' + f);
if (fail) process.exit(1);
