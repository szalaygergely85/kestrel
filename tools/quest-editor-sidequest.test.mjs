// ED-QUEST-03b: a side quest built ONLY through model + target commands is played by the real game code
// (templates.js expansion, questBook, applyQuestPreset readyToReturn) and passes R14. Works on a scratch copy of content/quests.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadQuests, saveAll, applyZones, makeStack } from './editor/quest/model.js';
import { applyPick } from './editor/quest/targets.js';
import { applyQuestPreset } from '../game/js/quest/statePreset.js';
import { createQuestBook } from '../game/js/quest/sim/questBook.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from './validate-content.mjs';
import { r14Quest } from './content-lint.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'edq03b-'));
try {
  const dir = join(tmp, 'quests'); cpSync(join(root, 'content/quests'), dir, { recursive: true });
  const worldPath = join(root, 'content/worlds/world_m1.world.json'), world = JSON.parse(readFileSync(worldPath, 'utf8'));
  const sites = JSON.parse(readFileSync(join(dir, 'sites.json'), 'utf8')).sites;
  // skeleton row appended to a real pack (the editor's "new quest" is out of scope here)
  const packRel = 'regions/pack.json', pk = JSON.parse(readFileSync(join(dir, packRel), 'utf8'));
  const ID = 'sq.edq.side';
  pk.quests.push({ id: ID, title: 'Burl Side Job', site: 'burl', turnIn: 'burl', steps: [
    { template: 'explore', params: { areas: ['crossroads'] } }, { template: 'kill', params: { kind: 'boar', count: 1 } },
    { template: 'collect', params: { ids: ['berry.blue'], count: 2 } }], reward: { items: [{ id: 'potion.hp', n: 1 }] } });
  writeFileSync(join(dir, packRel), JSON.stringify(pk, null, 2) + '\n');

  const m = loadQuests(dir), q = m.quests.find((x) => x.id === ID), stack = makeStack();
  const ctx = { sites, floorAt: () => 100, model: m };
  const pick = (slot, hit) => { const r = applyPick(q, slot, hit, world, ctx); assert.equal(r.error, null, JSON.stringify([slot, hit, r.error])); stack.run(r.cmd); };
  pick('giver', { entityId: 'bear' }); pick('return', { entityId: 'bear' });
  pick({ obj: 0 }, { point: { x: 1400, y: 1030, z: 0 } });
  pick({ obj: 1 }, { entityId: 'boar1' });
  pick({ obj: 2 }, { entityId: 'berry1' });
  assert.equal(applyPick(q, { obj: 2 }, { entityId: 'notePost' }, world, ctx).error, 'Pick a quest pickup (an item you can take)');
  assert.deepEqual(q.raw.steps.map((s) => s.params), [{ areas: [ID + '.a1'] }, { kind: 'boar', count: 1 }, { ids: ['berry.blue'], count: 2 }]);
  assert.equal(q.raw.site, 'burl'); assert.equal(q.raw.turnIn, 'burl');

  // save: areas.json canonical + world zone merged; round trip
  const sv = saveAll(m); assert.ok(sv.ok && sv.written.includes('areas.json') && sv.written.includes(packRel), JSON.stringify(sv));
  const areasText = readFileSync(join(dir, 'areas.json'), 'utf8');
  assert.equal(areasText, JSON.stringify(JSON.parse(areasText), null, 2) + '\n', 'areas.json canonical');
  assert.equal(loadQuests(dir).files.get('areas.json').obj.areas[ID + '.a1'].trigger, ID + '.a1');
  assert.equal(applyZones(m, world), 1);
  const wDir = join(tmp, 'w'); cpSync(join(root, 'content/worlds'), wDir, { recursive: true });
  writeFileSync(join(wDir, 'world_m1.world.json'), JSON.stringify(world, null, 2) + '\n');

  // the REAL game pipeline
  const assets = await loadDesignAssets();
  const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
  assert.deepEqual([...(packs.errors || [])], [], 'pack expansion errors: ' + JSON.stringify(packs.errors));
  const all = [...files.quests, ...packs.quests].map((x) => x.def);
  const def = all.find((d) => d.id === ID); assert.ok(def, 'side quest expanded by templates.js');
  assert.deepEqual(def.objectives.map((o) => o.when), [{ type: 'area', id: ID + '.a1' }, { type: 'beasts', kind: 'boar', count: 1 }, { type: 'collect', id: 'berry.blue', count: 2 }]);
  assert.deepEqual(def.giver, { npc: 'bear' });
  const main = all.find((d) => d.id === 'm1'), givers = all.filter((d) => d.id !== 'm1');
  for (const p of ['accepted', 'readyToReturn']) {
    const r = applyQuestPreset({ main, givers }, ID, p), b = createQuestBook(main, givers, r.save);
    assert.equal(b.statusOf(ID), p === 'accepted' ? 2 : 3, p);
  }
  // area is reachable: areas.json -> world zone with the picked position
  const area = JSON.parse(areasText).areas[ID + '.a1'], zone = world.triggers.find((t) => t.id === area.trigger);
  assert.ok(zone && zone.x === 1400 && zone.y === 1030 && zone.r === 4);
  // R14 on the result: character giver/return resolve to placed entities, accept offered
  const chars = new Set(world.entities.filter((e) => e.type === 'npc' || (e.components && e.components.dialogue)).map((e) => e.id));
  const f = r14Quest({ characters: chars, pos: (id) => world.entities.find((e) => e.id === id) }, { ...def, accept: true });
  assert.deepEqual(f, [], 'R14: ' + JSON.stringify(f));
  console.log('sideQuest.test PASS');
} finally { rmSync(tmp, { recursive: true, force: true }); }
