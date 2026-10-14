// BH-S1/S2/S3 (PC-A bug hunt 2026-10-15): save/quest round trips through the REAL relay path (book.toSave -> collectSave -> parse -> applySave -> createQuestBook).
// Run: node game/js/quest/save/bughuntSave.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, AssetRegistry } from '../../../../engine/index.js';
import { loadQuestFiles } from '../../questBoot.js';
import { createQuestBook, READY } from '../sim/questBook.js';
import { createQuest, applyQuestEvent } from '../sim/quest.js';
import { fromQuestSaveV2 } from '../sim/questSaveV2.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from './saveState.js';
import { loadDesignAssets } from '../../../../tools/validate-content.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const A = await loadDesignAssets();
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => JSON.parse(readFileSync(new URL('game/' + u, ROOT), 'utf8')), { items, log: () => {} });
const { questDef, giverDefs } = files;
const assets = new AssetRegistry({ palette: {} }), world = World.load({ name: 'bh', terrain: null, structures: [], entities: [] }, assets, {});
const newBook = (saved) => createQuestBook(questDef, giverDefs, saved);
// the book keeps the main quest state private; mirror its facts in a plain state so collectSave can write it like saveRelay does
const mk = () => { const main = createQuest(questDef), b = newBook({ quests: fromQuestSaveV2({ v: 2, done: ['burl.boars'], active: {}, tracked: null }, giverDefs) }); return { b, main, feed: (e) => { b.feed(e); applyQuestEvent(main, e, questDef); } }; };
const unlock = (t) => { t.feed({ type: 'flag:set', key: 'burl.home', value: true }); };
const load = (save) => { const r = applySave(parseGameSave(stringifyGameSave(save)), assets, { questDef, giverDefs }); return { r, book: newBook({ quest: r.quest, quests: r.quests }) }; };
const rt = (t, dead) => load(collectSave(world, { quest: t.main, questDef, quests: t.b.toSave().quests, giverDefs, openedChests: [], deadBeasts: dead, place: 'x', playTimeSec: 1 }));
const kill = giverDefs.find((d) => d.id === 'sq.burl.boars.n'), kids = kill.objectives.find((o) => o.when.type === 'beasts').when.ids;

// S1: accept order survives the relay path (the later-accepted quest stays tracked)
{
  const t = mk(); unlock(t);
  assert.ok(t.b.accept('sq.burl.walk') && t.b.accept('sq.burl.boars.n')); // pack order: walk is AFTER boars.n, accepted FIRST
  const live = t.b.tracked();
  assert.equal(t.b.toSave().quests['sq.burl.boars.n'].seq > t.b.toSave().quests['sq.burl.walk'].seq, true);
  assert.equal(rt(t, []).book.tracked(), live, 'BH-S1: tracked quest unchanged after Continue');
}

// S2: abandon + re-accept keeps already-dead authored beasts
{
  const t = mk(); unlock(t);
  assert.ok(t.b.accept(kill.id));
  t.feed({ type: 'beast:died', id: kids[0] });
  assert.ok(t.b.abandon(kill.id) && t.b.accept(kill.id));
  for (const id of kids.slice(1)) t.feed({ type: 'beast:died', id });
  assert.equal(t.b.toSave().quests[kill.id].quest.deadBeasts.length, kids.length, 'BH-S2: first beast still counts after abandon + re-accept');
  assert.equal(t.b.statusOf(kill.id), READY);
}

// S3: legacy m1 save (no game.quests): two load/save cycles must not seed the boar kill count twice
{
  const idx = questDef.objectives.findIndex((o) => o.id === 'sword');
  const main = createQuest(questDef, { questVersion: 1, questId: questDef.id, flags: {}, items: [], deadBeasts: [], areas: [], completed: questDef.objectives.slice(0, idx + 1).map((o) => o.id) });
  const dead = ['boar1', 'boar2', 'boar3'];
  const legacy = collectSave(world, { quest: main, questDef, openedChests: [], deadBeasts: dead, place: 'x', playTimeSec: 1 });
  assert.equal(legacy.game.quests, undefined);
  let cur = load(legacy);
  const count = (c) => c.r.quests['burl.boars'].quest.counts.kill_boar;
  assert.equal(count(cur), 3);
  for (let k = 0; k < 2; k++) cur = load(collectSave(world, { quest: cur.r.quest, questDef, quests: cur.book.toSave().quests, giverDefs, openedChests: [], deadBeasts: dead, place: 'x', playTimeSec: 1 }));
  assert.equal(count(cur), 3, 'BH-S3: kill count stable across loads');
  assert.notEqual(cur.book.statusOf('burl.boars'), READY, 'BH-S3: 3/5 boars is not READY');
}
console.log('bughuntSave ok');
