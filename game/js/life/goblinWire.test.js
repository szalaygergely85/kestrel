// GOB-07a: createGoblinWire. Run: node game/js/life/goblinWire.test.js
// Real goblinCamps.json + real enemy spear sim + spear view; stub beast sim (slotOf / setDormant / flee / setDown) and stub world.
import { readFileSync } from 'node:fs';
import '../../../design/palette.js';
import '../../../design/detail-pass.js';
import '../../../design/models/voxel_goblin.js';
import { makeOk } from '../../../engine/test/assert.js';
import { createGoblinWire } from './goblinWire.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const json = JSON.parse(readFileSync(new URL('../../../content/life/goblinCamps.json', import.meta.url), 'utf8'));

function makeEvents() {
  const ls = new Map();
  return { on(n, fn) { let s = ls.get(n); if (!s) ls.set(n, s = new Set()); s.add(fn); return () => s.delete(fn); },
    emit(n, p) { const s = ls.get(n); if (s) for (const fn of Array.from(s)) fn(p); } };
}
function rig(playerX, shieldFront) {
  const ents = new Map();
  const player = { data: { transform: { x: playerX, y: 0, z: 0 }, components: {} } };
  const world = {
    addEntity: (e) => ents.set(e.id, e), get: (id) => (id === 'player' ? player : null), flowAt() {}, raySegmentRay: () => false,
    forEachEntity: (f) => ents.forEach((e, id) => f(e, id)),
  };
  const events = makeEvents(), state = {};
  const gw = createGoblinWire({ world, events, state, json });
  const ids = gw.campDefs.flatMap((c) => c.members.map((m) => m.id));
  const sim = { slotOf: (id) => ids.indexOf(id), isDead: () => false, setDormant() {}, flee() {}, setDown() {} };
  const clanks = [];
  gw.attach(sim, { onClank: (p) => clanks.push(p.px) });
  return { gw, events, world, ents, state, clanks, player, sim };
}

// ---- camps + entities
{
  const r = rig(40);
  ok('active camp defs exposed for createLifeWire, goblins + props spawned', r.gw.campDefs.length === 2 && r.gw.added > 0 && [...r.ents.values()].filter((e) => e.type === 'beast').length === r.gw.added);
  ok('spear view pool entities added (goblinSpear)', [...r.ents.values()].filter((e) => e.components.voxel && e.components.voxel.model === 'goblinSpear').length === 16);
  r.gw.step(0, 0, 0); r.gw.update();
  ok('step with the player far away leaves camps dormant-capable and does not throw', r.gw.camps.isDormant(0) === true);
}
// ---- a throw -> the spear flies -> hits the player (combat:hit ranged, target player)
{
  const r = rig(12); const hits = [];
  r.events.on('combat:hit', (p) => hits.push({ t: p.target, ranged: p.ranged, src: p.source }));
  r.events.emit('beast:throw', { id: 'gob.x', slot: 0, x: 0, y: 0, z: 1.4, tx: 12, ty: 0, tz: 0.9 });
  ok('beast:throw launches an enemy spear', r.gw.spears.flyingCount === 1);
  r.gw.step(0, 12, 0); r.gw.update();
  const f = [...r.ents.values()].find((e) => e.id === 'gspear.f0');
  ok('view shows it flying', f.components.voxel.hidden === false && f.components.voxel.anim === 'fly');
  for (let i = 0; i < 100; i++) { r.gw.step(0, 12, 0); r.gw.update(); }
  ok('spear hit the player: combat:hit ranged 1 from the thrower', hits.length === 1 && hits[0].t === 'player' && hits[0].ranged === 1 && hits[0].src === 'gob.x', JSON.stringify(hits));
  ok('flying slot hidden afterwards', f.components.voxel.hidden === true && r.gw.spears.flyingCount === 0);
}
// ---- a shield block: combat:hit blocked flag -> stuck(down) + beast:spearBlocked -> clank callback + spear:clank event, view plays blocked
{
  const r = rig(12); let clankEv = 0;
  r.events.on('spear:clank', () => clankEv++);
  r.events.on('combat:hit', (p) => { p.blocked = 1; }); // the shield (vitals) marks the payload
  r.events.emit('beast:throw', { id: 'gob.x', slot: 0, x: 0, y: 0, z: 1.4, tx: 12, ty: 0, tz: 0.9 });
  for (let i = 0; i < 100; i++) { r.gw.step(0, 12, 0); r.gw.update(); }
  ok('blocked: clank callback + spear:clank event fired once', r.clanks.length === 1 && clankEv === 1, `${r.clanks.length} ${clankEv}`);
  const s = [...r.ents.values()].find((e) => e.id === 'gspear.s0');
  ok('blocked spear shows the blocked clip', s.components.voxel.hidden === false && s.components.voxel.anim === 'blocked');
}
// ---- dispose unhooks
{
  const r = rig(12); r.gw.dispose();
  r.events.emit('beast:throw', { id: 'g', slot: 0, x: 0, y: 0, z: 1.4, tx: 12, ty: 0, tz: 0.9 });
  ok('after dispose a throw does nothing and step is a no-op', r.gw.camps === null && (r.gw.step(0, 0, 0), true));
}

// ---- GOB-07b: the main.js order (source grep)
{
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  const at = (re) => main.search(re);
  const iC = at(/createGoblinWire\(\{/), iB = at(/beasts = createBeastSim\(/), iA = at(/goblinWire\.attach\(beasts/), iL = at(/createLifeWire\(\{ \.\.\.raidDefs, campDefs: goblinWire/);
  ok('main.js: createGoblinWire < createBeastSim < attach < createLifeWire(campDefs)', iC > 0 && iC < iB && iB < iA && iA < iL, [iC, iB, iA, iL]);
  const iS = at(/goblinWire\.step\(/), iLs = at(/lifeWire\.step\(clockHour/), iU = at(/goblinWire\.update\(\)/), iP = at(/presentBeasts\(beasts/);
  ok('main.js: goblinWire.step before lifeWire.step; update before presentBeasts', iS > 0 && iS < iLs && iU > 0 && iU < iP, [iS, iLs, iU, iP]);
  ok('main.js: dispose on reload + goblinCamps.json fetched + clock.day', /goblinWire\.dispose\(\)/.test(main) && /life\/goblinCamps\.json/.test(main) && /goblinWire\.step\(engine\.world\.state\['clock\.day'\]/.test(main));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { console.log('FAILURES:\n' + failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
console.log('ALL PASS');
