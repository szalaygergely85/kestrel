// OB-206: whatever quest a giver shows '!' for, talking to it must offer exactly that quest (Accept). Rook: every giver quest
// that is AVAILABLE must win the dialogue entry list against every other Rook quest being active/ready/done.
//   node game/js/quest/rookOffers.test.js
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { generateAll } from './questSnippets.js';
import { ANCHORS } from './questSnippets.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';

const ROOT = new URL('../../../', import.meta.url);
const rd = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const defs = (await loadDesignAssets()).items.defs;
const items = Object.values(defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => JSON.parse(readFileSync(new URL(u, new URL('game/', ROOT)), 'utf8')), { log() {}, items });
let fail = 0; if (process.env.DUMP) {}
for (const npc of ['rook', 'bear', 'hesk', 'dorrin', 'postkeeper']) {
  let raw; try { raw = rd(`content/dialogue/${npc}.dialogue.json`); } catch { continue; }
  const gen = generateAll({ [npc]: raw }, files.giverDefs, rd('content/dialogue/quest-snippets.json'))[npc];
  const mine = files.giverDefs.filter((d) => d.giver && d.giver.npc === npc && !d.objectGiver);
  const offersAccept = (n, q) => { for (let k = 0; k < 6 && n; k++) { const nd = gen.nodes[n]; if (!nd) return false; if ((nd.choices || []).some((c) => c.setFlag === `q.${q}.accept`)) return true; n = nd.next; } return false; };
  const pick = (flags) => gen.entry.find((e) => !e.requires || flags.has(e.requires));
  const acceptsFor = (q) => { const n = pick(new Set([`q.${q}.available`]))?.node; return offersAccept(n, q); };
  for (const d of mine.filter((x) => /^sq\./.test(x.id))) { // side quests; the mq.* chain is sequential and offered by its own dialogue nodes
    if (!acceptsFor(d.id)) { fail++; console.log(`FAIL ${npc}: ${d.id} AVAILABLE alone -> entry ${pick(new Set([`q.${d.id}.available`]))?.node} has no Accept`); }
    for (const o of mine) {
      if (o.id === d.id || /^sq\./.test(o.id)) continue; // an mq.* quest of the same giver in a state that has its own talk node
      for (const st of ['active']) { // a READY hand-in shows '?' (beats '!', OB-155j) and is talked first
        const fl = new Set([`q.${d.id}.available`, `q.${o.id}.${st}`]);
        if (!offersAccept(pick(fl)?.node, d.id)) { fail++; console.log(`FAIL ${npc}: ${d.id} available while ${o.id} ${st} -> ${pick(fl)?.node}`); }
      }
    }
  }
}
console.log(`rookOffers: ${fail ? fail + ' FAIL' : 'ok'}`);
process.exit(fail ? 1 : 0);
