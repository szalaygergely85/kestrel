// R6-FIX A: every giver/turn-in npc with a dialogue gets an [E] Talk interactable (joss, Bram, wardens ...), once; names come from ONE table.
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { makeOk } from '../../../engine/test/assert.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';
import { talkNpcIds, NPC_NAMES } from './npcNames.js';
import { createDialogueCtl } from './dialogueCtl.js';
import { labelOf } from './errands.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const assets = await loadDesignAssets();
const dir = root + 'content/quests';
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const defs = [...files.quests, ...packs.quests].map((q) => q.def);
const dialogues = new Proxy({}, { get: (_, id) => (typeof id === 'string' && existsSync(root + 'content/dialogue/' + id + '.dialogue.json') ? { id } : undefined) });
const ids = talkNpcIds(defs, dialogues);
ok(ids.includes('joss') && ids.includes('postkeeper'), 'joss and postkeeper are in the Talk list');
ok(ids.filter((i) => /^warden_/.test(i)).length === 10, '10 wardens in the Talk list');
ok(new Set(ids).size === ids.length, 'no duplicate ids');
ok(!talkNpcIds([{ objectGiver: true, giver: { npc: 'owBoard' } }], { owBoard: {} }).length, 'object givers get no Talk');

// every world_m1 npc entity that is a giver and has a dialogue component is in the list
const wd = JSON.parse(readFileSync(root + 'content/worlds/world_m1.world.json', 'utf8'));
const givers = new Set(defs.filter((d) => d.giver && !d.objectGiver).flatMap((d) => [d.giver.npc, d.giver.turnIn]).filter(Boolean));
const missing = (wd.entities || []).filter((e) => e.components && e.components.dialogue && givers.has(e.id) && !ids.includes(e.id)).map((e) => e.id);
ok(missing.length === 0, 'every giver npc entity with a dialogue gets Talk (missing: ' + missing.join(',') + ')');

// registration through a fake world: one interactable per id, idempotent, prompt uses the shared name
const list = [];
const world = { interactables: list, get: (id) => ({ data: { transform: { x: 1, y: 2, z: 0 }, components: {} } }), addInteractable(s) { if (list.some((r) => r.key === s.key)) throw new Error('dup'); list.push(s); return s; }, removeInteractable() {} };
const ctl = createDialogueCtl({ world, dialogues: {} });
for (const id of ids) ctl.addNpc(id);
for (const id of ids) ctl.addNpc(id); // twice: must not throw / duplicate
ok(list.length === ids.length, 'one Talk interactable per giver npc');
const j = list.find((r) => r.key === 'npc.joss'), b = list.find((r) => r.key === 'npc.postkeeper');
ok(j && j.prompt === '[E] Talk to Joss' && b && b.prompt === '[E] Talk to Bram', 'joss/Bram prompts from the shared table');
ok(labelOf('joss') === NPC_NAMES.joss && labelOf('postkeeper') === 'Bram' && labelOf('relayBend') === 'Bend Waystone', 'errand labels from the same table');
ok(labelOf('bear') === 'bear', 'errand label text unchanged for non-errand npcs');

console.log(`talkGivers: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
