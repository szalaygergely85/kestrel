// QFIX-S5c-1 (OB-155l, OB-156, D-082): the region warden mechanism. A pack row `site: warden_<region>` (sites.json -> an npc entity with a dialogue)
// makes a char.kit NPC beside the waystone the giver AND hand-in of sq.reg.<region>: generated Accept/Exit offer, `?` at the warden, not at the waystone.
//   node game/js/quest/regionWarden.test.js
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { makeOk } from '../../../engine/test/assert.js';
import { createQuestBook, AVAILABLE, ACTIVE } from './sim/questBook.js';
import { expandQuest } from './sim/templates.js';
import { generateForNpc } from './questSnippets.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const root = fileURLToPath(new URL('../../../content/', import.meta.url));
const J = (p) => JSON.parse(fs.readFileSync(root + p, 'utf8'));
const sites = J('quests/sites.json').sites, pack = J('quests/regions/pack.json'), world = J('worlds/world_m1.world.json'), manifest = J('manifest.json');
const ent = (id) => world.entities.find((e) => e.id === id);

// fixture: any region row switched to a warden site expands to a character giver with no separate turnIn
const row = pack.quests.find((q) => q.id === 'sq.reg.northwood');
const fx = expandQuest({ ...row, site: 'warden_fx' }, { sites: { ...sites, warden_fx: { entity: 'warden_fx' } }, pack, rewards: J('quests/rewards.json').tables, strictText: true });
ok(fx.giver.npc === 'warden_fx' && !fx.giver.turnIn, 'fixture: warden is giver and hand-in (? at the warden)');
const raw = { kind: 'dialogue', schema: 1, id: 'warden_fx', speakers: { warden: { label: 'WARDEN' }, you: { label: 'YOU', player: true } }, entry: [{ node: 'w.1' }], nodes: { 'w.1': { end: true, lines: ['Hello.'], speaker: 'warden' } } };
const gen = generateForNpc(raw, 'warden_fx', [fx], J('dialogue/quest-snippets.json'));
const offer = gen.nodes['qs.sq.reg.northwood.offer.1'] || gen.nodes['qs.sq.reg.northwood.offer.2'];
ok(gen !== raw && !!offer, 'fixture: generated offer route at the warden');
const choiceNode = Object.values(gen.nodes).find((n) => n.choices && n.choices.some((c) => c.setFlag === 'q.sq.reg.northwood.accept'));
ok(choiceNode && choiceNode.choices.length === 2 && choiceNode.choices.some((c) => !c.setFlag), 'fixture: Accept / Exit choices');
ok(Object.values(gen.nodes).some((n) => n.setFlag === 'q.sq.reg.northwood.handin'), 'fixture: ready route hands in at the warden');
const m1 = J('quests/m1.quest.json');
const b = createQuestBook(m1, [fx]);
ok(b.statusOf(fx.id) !== AVAILABLE, 'fixture: gated until the waystone woke');
b.feed({ type: 'flag:set', key: 'waystone.ws_northwood.woken', value: true });
ok(b.statusOf(fx.id) === AVAILABLE, 'fixture: available after wake');
ok(b.accept(fx.id) && b.statusOf(fx.id) === ACTIVE, 'fixture: accept works');

// real worked example: warden_glasswater
const wr = pack.quests.find((q) => q.id === 'sq.reg.glasswater'), w = ent('warden_glasswater'), rl = ent('relay_glasswater');
ok(wr.site === 'warden_glasswater' && sites.warden_glasswater && sites.warden_glasswater.entity === 'warden_glasswater', 'glasswater errand is given by its warden site');
ok(w && w.type === 'npc' && w.components.voxel.model === 'char.kit' && w.components.dialogue === 'warden_glasswater', 'warden entity: npc, char.kit, own dialogue');
ok(Math.hypot(w.x - rl.x, w.y - rl.y) >= 1.5 && Math.hypot(w.x - rl.x, w.y - rl.y) <= 4, 'warden stands 1.5-4 m beside the waystone');
ok(manifest.files.includes('dialogue/warden_glasswater.dialogue.json'), 'dialogue in the manifest');
ok(pack.quests.filter((q) => /^warden_/.test(q.site || '')).every((q) => ent(q.site)), 'every warden site has a placed entity');
console.log(`regionWarden.test: ${pass} pass, ${fail} fail`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
