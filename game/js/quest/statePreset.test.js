// ED-QUEST-07: preset loader on the real content (sq.burl.blue + pack quest sq.burl.parcel, depth 3 prerequisites).
import { fileURLToPath } from 'node:url';
import { makeOk } from '../../../engine/test/assert.js';
import { World, AssetRegistry } from '../../../engine/index.js';
import { createQuestBook } from './sim/questBook.js';
import { applyQuestPreset, parseQstateParam } from './statePreset.js';
import { collectSave, applySave, stringifyGameSave, parseGameSave } from './save/saveState.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from '../../../tools/validate-content.mjs';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../../../content/quests', import.meta.url));
const files = loadQuestFiles(dir), packs = await loadPackQuests(dir, assets.items?.defs);
const all = [...files.quests, ...packs.quests].map(q => q.def);
const main = all.find(d => d.id === 'm1'), givers = all.filter(d => d.id !== 'm1');
const run = (id, p, pack) => applyQuestPreset({ main, givers, pack }, id, p);
const marks = b => { const g = [], r = [], sa = [], sr = []; b.markLists(g, r, sa, sr); return { g, r, sa, sr }; };
const has = (m, e) => [m.g, m.r, m.sa, m.sr].some(l => l.includes(e));
const count = (res, id) => res.items.find(i => i.id === id)?.n || 0;

// param parser
const P = parseQstateParam;
ok(JSON.stringify(P('?qstate=sq.burl.blue:accepted')) === '{"questId":"sq.burl.blue","preset":"accepted"}', 'parse accepted');
ok(P('?x=1&qstate=sq.burl.blue:objective2').preset.objective === 2 && P('?qstate=a.b:objective:3').preset.objective === 3, 'parse objective n');
ok(P('?qstate=a.b:readyToReturn').preset === 'readyToReturn' && P('?qstate=a.b:notStarted').preset === 'notStarted', 'parse the others');
ok(P('') === null && P('?qstate=nocolon') === null && P('?qstate=a:bogus') === null && P('?qstate=a:objective0') === null, 'parse rejects junk');

const blue = 'sq.burl.blue';
{ // notStarted: prerequisites done by real play, quest offered
  const r = run(blue, 'notStarted'), b = createQuestBook(main, givers, r.save);
  ok(r.status === 'available' && b.statusOf(blue) === 1, 'blue notStarted: available');
  ok(b.statusOf('burl.boars') === 4 && b.main.flags['burl.home'] === true, 'prereq burl.boars done + burl.home flag via the real drivers');
  const m = marks(b); ok(has(m, 'bear') && !m.r.includes('bear'), 'blue notStarted: "!" on bear, no "?"');
  ok(r.items.length === 0 || count(r, 'berry.blue') === 0, 'no sprigs granted');
}
{ // accepted
  const r = run(blue, 'accepted'), b = createQuestBook(main, givers, r.save);
  ok(b.statusOf(blue) === 2 && b.tracked() === b.index(blue), 'blue accepted: active + tracked');
  const o = b.objectives(b.index(blue)); ok(o[0].status === 'active' && o[0].progress === 0 && o[1].status === 'locked', 'objective 1 active, 0/6');
  ok(!has(marks(b), 'bear') || !marks(b).g.includes('bear'), 'no "!" for blue once accepted');
}
{ // objective 2 = sprigs done, deliver active
  const r = run(blue, { objective: 2 }), b = createQuestBook(main, givers, r.save);
  ok(b.statusOf(blue) === 3 || b.statusOf(blue) === 2, 'objective 2 in progress/ready');
  ok(count(r, 'berry.blue') === 6, 'objective 2: 6 sprigs granted');
  ok(b.questState(b.index(blue)).completed.length >= 1, 'first objective done');
}
{ // readyToReturn
  const r = run(blue, 'readyToReturn'), b = createQuestBook(main, givers, r.save);
  ok(r.status === 'ready' && b.statusOf(blue) === 3, 'blue ready');
  ok(count(r, 'berry.blue') === 6, 'ready: 6 sprigs in pack');
  const m = marks(b); ok(has(m, 'bear') && (m.r.includes('bear') || m.sr.includes('bear')), '"?" live on bear');
  // the real hand-in works on the produced state
  b.packOps = { count: id => r.pack[id] || 0, remove: (id, n) => { r.pack[id] -= n; }, add: () => 1, equipped: () => true };
  ok(b.handIn(blue) !== null && b.statusOf(blue) === 4, 'real handIn on the preset state');
  ok(r.save.quests[blue].handedIn === false, 'preset itself did not hand in');
}
// pack quest with a depth-3 prerequisite chain
const pq = 'sq.burl.parcel';
for (const p of ['notStarted', 'accepted', { objective: 1 }, 'readyToReturn']) {
  const r = run(pq, p), b = createQuestBook(main, givers, r.save);
  const want = p === 'notStarted' ? 1 : p === 'readyToReturn' ? 3 : 2;
  ok(b.statusOf(pq) === want, pq + ' ' + JSON.stringify(p) + ' status ' + b.statusOf(pq));
  ok(b.statusOf('sq.burl.meat') === 4 && b.statusOf('burl.boars') === 4, pq + ' prerequisites done: ' + JSON.stringify(p));
}
{
  const r = run(pq, 'readyToReturn'), b = createQuestBook(main, givers, r.save), m = marks(b);
  ok(m.r.length + m.sr.length >= 1 && r.items.length >= 1, 'pack quest ready: a "?" and granted items ' + JSON.stringify(r.items));
}
{ // errors
  let e = 0; for (const f of [() => run(blue, { objective: 9 }), () => run('nope', 'accepted'), () => run('m1', 'accepted'), () => run(blue, 'bogus')]) { try { f(); } catch { e++; } }
  ok(e === 4, 'bad input throws');
  const r1 = run(blue, 'accepted'), r2 = applyQuestPreset({ main, givers, save: r1.save, pack: r1.pack }, blue, 'readyToReturn');
  ok(r2.status === 'ready', 'preset on an existing save');
}
{ // save round trip (v1 save -> v2 quests -> back), and normal play untouched without a preset
  const assetsR = new AssetRegistry({ palette: {} }), world = World.load({ name: 'qs', terrain: null, structures: [], entities: [] }, assetsR, {});
  for (const p of ['notStarted', 'accepted', 'readyToReturn']) {
    const r = run(blue, p);
    const save = collectSave(world, { quest: r.save.quest, questDef: main, quests: r.save.quests, giverDefs: givers });
    const back = applySave(parseGameSave(stringifyGameSave(save)), assetsR, { questDef: main, giverDefs: givers });
    const b2 = createQuestBook(main, givers, { quest: back.quest, quests: back.quests });
    ok(b2.statusOf(blue) === createQuestBook(main, givers, r.save).statusOf(blue) && JSON.stringify(b2.toSave()) === JSON.stringify(r.save), 'round trip ' + p);
  }
  const fresh = createQuestBook(main, givers);
  ok(fresh.statusOf(blue) === 0 && JSON.stringify(fresh.toSave()) === JSON.stringify(createQuestBook(main, givers).toSave()), 'no preset: untouched');
}
console.log(`statePreset: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
if (fail) process.exit(1);
