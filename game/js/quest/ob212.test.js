// OB-212: accepting / advancing quests must never move Burl. Real quest book (all quest files, preset via the real book API) +
// burlEscort + npcWalk on Burl's real walks. Covers the departure (gone) and the sq.burl.walk lead, plus a fresh load() mid-lead.
//   node game/js/quest/ob212.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadQuestFiles } from '../questBoot.js';
import { applyQuestPreset } from './statePreset.js';
import { createQuestBook } from './sim/questBook.js';
import { gateOnMeet } from './errands.js';
import { createNpcWalk } from './npcWalk.js';
import { createBurlEscort, PHASE_STONE, PHASE_GONE, PHASE_BACK, PHASE_LEAD } from './burlEscort.js';
import { loadDesignAssets } from '../../../tools/validate-content.mjs';

const A = await loadDesignAssets();
const items = Object.values(A.items.defs).map((d) => ({ id: d.id, slot: d.equip && d.equip.slot, tier: d.equip && d.equip.tier }));
const files = await loadQuestFiles(async (u) => JSON.parse(readFileSync(new URL('../../../' + u.replace(/^\.\.\//, ''), import.meta.url), 'utf8')), { items, log() {} });
const defs = gateOnMeet(files.giverDefs);
const bearEnt = JSON.parse(readFileSync(new URL('../../../content/worlds/world_m1.world.json', import.meta.url), 'utf8')).entities.find((e) => e.id === 'bear');
const TOWER = bearEnt.components.walks.follow[0], HOME = bearEnt.components.walks.home[0]; // OB-212: post-departure home is walks.home, not the tower
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function mk(qid, preset, state = {}) {
  const book = createQuestBook(files.questDef, defs, applyQuestPreset({ main: files.questDef, givers: defs }, qid, preset).save);
  const ent = { transform: { x: bearEnt.x, y: bearEnt.y, z: 0, yawDeg: 0 }, components: JSON.parse(JSON.stringify(bearEnt.components)) };
  const world = { state, terrain: { groundAt: () => 0 }, get: () => ({ data: ent }), setEntityCollider: () => true, interactables: [], removeInteractable() {} };
  const walk = createNpcWalk(world, 'bear', {});
  const esc = createBurlEscort({ world, walk, questFlag: (k) => { state[k] = true; }, id: 'bear', x: () => ent.transform.x, y: () => ent.transform.y,
    leadStatus: () => book.statusOf('sq.burl.walk') });
  return { book, ent, state, walk, esc };
}
const run = (c, s, px, py) => { for (let i = 0; i < s * 60; i++) c.esc.step(1 / 60, px, py, false); };
const pos = (c) => [c.ent.transform.x, c.ent.transform.y, !!c.ent.components.voxel.hidden];
// accept every available side quest through the real book API
function churn(c) {
  let n = 0;
  for (const id of ['sq.wreck.plate', 'sq.honey', 'sq.rook.shiny', 'sq.burl.fire']) if (c.book.statusOf(id) === 1 && c.book.accept(id)) n++;
  return n;
}

{ // Burl departs after the stone and walks to his NEW home (visible, not hidden, not the tower); accepting quests there never moves him
  const c = mk('sq.wreck.plate', 'notStarted');
  c.state['burl.phase'] = PHASE_STONE; c.walk.place('follow'); c.state['burl.depart'] = true;
  run(c, 60, TOWER[0], TOWER[1] - 4);
  assert.equal(c.esc.phase, PHASE_BACK, 'departed -> at the new home'); assert.ok(c.state['burl.home']);
  const before = pos(c);
  assert.ok(far(before, HOME) < 1 && far(before, TOWER) > 40 && !before[2], 'at the new home, visible ' + before);
  assert.ok(churn(c) >= 1, 'sq.wreck.plate accepted there'); assert.equal(c.book.statusOf('sq.wreck.plate'), 2);
  run(c, 5, HOME[0], HOME[1] + 5);
  assert.deepEqual(pos(c), before, 'accept did not move Burl');
}
{ // Continue / load after the departure (also an old save: gone / back / home flags) -> new home, never the tower
  for (const ph of [PHASE_GONE, PHASE_BACK]) {
    const c = mk('sq.wreck.plate', 'notStarted', { 'burl.phase': ph, 'burl.depart': true });
    c.esc.load(); const p = pos(c);
    assert.equal(c.esc.phase, PHASE_BACK); assert.ok(far(p, HOME) < 1 && !p[2], 'phase ' + ph + ' loads at the new home ' + p);
    assert.ok(churn(c) >= 1, 'errands offered through the real book');
  }
}
{ // sq.burl.walk lead: half-way along walks.toBend, accept another quest -> she stays on the lead, not home; a fresh load() resumes the lead
  const c = mk('sq.burl.walk', 'accepted', { 'burl.home': true, 'burl.phase': PHASE_BACK });
  assert.equal(c.book.statusOf('sq.burl.walk'), 2);
  for (let i = 0; i < 60 * 25; i++) c.esc.step(1 / 60, c.ent.transform.x - 3, c.ent.transform.y, false);
  assert.equal(c.esc.phase, PHASE_LEAD); const before = pos(c);
  assert.ok(far(before, HOME) > 15, 'walked away from the new home');
  churn(c); run(c, 3, before[0] + 40, before[1]); // player far: she waits where she is
  assert.deepEqual(pos(c), before, 'accept did not move Burl during the lead');
  const save = JSON.parse(JSON.stringify(c.state)), d = mk('sq.burl.walk', 'accepted', save);
  d.esc.load(); assert.equal(d.esc.phase, PHASE_LEAD, 'load keeps the lead');
  assert.ok(Math.hypot(d.ent.transform.x - before[0], d.ent.transform.y - before[1]) < 8, 'load resumes near the walked spot ' + pos(d));
}
{ // the lead walk completes from the new home to the Bend
  const c = mk('sq.burl.walk', 'accepted', { 'burl.home': true, 'burl.phase': PHASE_BACK }); c.esc.load();
  assert.ok(far(pos(c), HOME) < 1);
  for (let i = 0; i < 60 * 240 && c.esc.phase !== 7; i++) c.esc.step(1 / 60, c.ent.transform.x - 3, c.ent.transform.y, false);
  assert.equal(c.esc.phase, 7, 'reached the Bend'); assert.ok(c.state['escort.bear.relayBend']);
}
console.log('ob212: 4 pass');
