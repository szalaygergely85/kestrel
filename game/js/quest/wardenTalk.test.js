// QWALK-WARDEN-TALK: the 10 region wardens are quest givers with a dialogue; main.js must register their [E] Talk interactable (dialogueCtl.addNpc),
// else a player standing at the warden cannot talk, accept or hand in (found by tools/verify-quest-walk2.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rd = (p) => readFileSync(ROOT + p, 'utf8');
const main = rd('game/js/main.js'), ctl = rd('game/js/quest/npcNames.js'); // R6-FIX A: the one name table
assert.ok(/talkNpcIds\(questGenCtx.*dialogueCtl\.addNpc\(nid\)/.test(main), 'main.js registers a Talk interactable for every giver npc with a dialogue (R6-FIX A: generic, includes warden_*)');
const world = JSON.parse(rd('content/worlds/world_m1.world.json'));
const regs = JSON.parse(rd('content/quests/regions/pack.json')).quests;
const wardens = world.entities.filter((e) => /^warden_/.test(e.id));
assert.equal(wardens.length, 10, 'ten wardens in the world');
for (const e of wardens) {
  assert.ok(e.components && e.components.dialogue === e.id, e.id + ' has its dialogue component');
  assert.ok(regs.some((q) => q.site === e.id), e.id + ' is the site/giver of a sq.reg quest');
  assert.ok(new RegExp(e.id + ": '").test(ctl), e.id + ' has a prompt name in NPC_NAMES');
}
console.log('wardenTalk.test ok (' + wardens.length + ' wardens)');
