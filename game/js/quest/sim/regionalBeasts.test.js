// WM-12: regional beast generation (deterministic ids/homes, walkable, inside region + bounds, counts per rule), far herds dormant
// cost, save/load of a dead generated beast. Run: node game/js/quest/sim/regionalBeasts.test.js
import { World, createRng } from '../../../../engine/index.js';
import paletteMod from '../../../../design/palette.js';
import detailPassMod from '../../../../design/detail-pass.js';
import terrainMod from '../../../../design/levels/overworld_far.js';
import geoMod from '../../../../design/levels/world_geo.js';
import '../../../../design/models/lantern.js'; import '../../../../design/models/lever.js'; import '../../../../design/models/boulder.js';
import '../../../../design/models/rubble.js'; import '../../../../design/models/wreckage.js'; import '../../../../design/models/relay.js';
import '../../../../design/models/sword.js'; import '../../../../design/models/m3_props.js'; import '../../../../design/models/far_tower.js';
import '../../../../design/models/ferrum_lights.js'; import '../../../../design/models/voxel_beast.js'; import '../../../../design/models/voxel_bear.js';
import { loadTestAssets } from '../../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../../engine/test/assert.js';
import { buildBeastNav } from './beastNav.js';
import { createBand } from './band.js';
import { createBeastSim, MAX_BEASTS, STATE_CORPSE } from './beastSim.js';
import { REGION_RULES, REGIONAL_BEAST_COUNT, generateRegionalBeasts, spawnRegionalBeasts, makeWalkable, inPolygon } from './regionalBeasts.js';

paletteMod; detailPassMod; terrainMod;
const G = globalThis.ASSETS.levels.world_geo; geoMod;
G.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
const { assets } = await loadTestAssets();
let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const def = assets.world('world_m1');
const mkWorld = () => World.load(def, assets, { physics: 'grid' });
const quiet = (f) => { const w = console.warn; console.warn = () => {}; try { return f(); } finally { console.warn = w; } };

const wA = mkWorld();
const avoid = []; wA.forEachEntity((e) => { const b = e.components?.brain; if (b?.kind === 'beast') avoid.push([...b.home]); });
const list1 = generateRegionalBeasts({ geo: G, terrain: wA.terrain, seed: 12, avoid });
const list2 = generateRegionalBeasts({ geo: G, terrain: wA.terrain, seed: 12, avoid });
const list3 = generateRegionalBeasts({ geo: G, terrain: wA.terrain, seed: 13, avoid });
ok('deterministic: same seed -> same ids + homes', JSON.stringify(list1) === JSON.stringify(list2));
ok('different seed -> different homes', JSON.stringify(list1) !== JSON.stringify(list3));
ok('ids unique + stable shape', new Set(list1.map((b) => b.id)).size === list1.length && list1.every((b) => /^(boar|wolf|bear)\.[A-Za-z]+\.\d+$/.test(b.id)), list1.map((b) => b.id).join(','));

// BEAST-02/OB-152: wolf packs spawn in northwood + signalHill with the real wolf model id
{
  const ww = mkWorld(); quiet(() => spawnRegionalBeasts(ww, G, 12));
  let n = 0, bad = 0; ww.forEachEntity((e) => { if (/^wolf\.(northwood|signalHill)\./.test(String(e.id))) { n++; if (e.components.voxel.model !== 'wolf' || e.components.brain.species !== 'wolf') bad++; } });
  ok('BEAST-02: >= 7 wolves in northwood+signalHill, model wolf', n >= 7 && bad === 0, 'n=' + n + ' bad=' + bad);
}

// OB-142: the river band around the ford is never empty - >= 6 beast homes (authored + generated) within 150 m of (1060, 1060)
{
  const near = [...avoid, ...list1.map((b) => [b.x, b.y])].filter((p) => Math.hypot(p[0] - 1060, p[1] - 1060) <= 150).length;
  ok('OB-142: >= 6 beasts within 150 m of the river (1060,1060)', near >= 6, 'near=' + near);
}

const walk = makeWalkable(wA.terrain, G.bounds);
const rectOf = (rule) => rule.rect || G.regions.find((g) => g.id === rule.region).r;
let bad = [];
for (const b of list1) {
  const rule = REGION_RULES.find((r) => r.region === b.region), r = rectOf(rule);
  const in_ = b.x > r[0] && b.x < r[2] && b.y > r[1] && b.y < r[3];
  if (!in_ || !inPolygon(G.bounds.pts, b.x, b.y) || !walk(b.x, b.y) || wA.terrain.typeAt(b.x, b.y) === 2) bad.push(b.id);
}
ok('every home walkable, inside its region rect and the bounds polygon', bad.length === 0, bad.join(','));
const perRegion = {}; for (const b of list1) perRegion[b.region] = (perRegion[b.region] || 0) + 1;
const wrongCount = REGION_RULES.filter((r) => (perRegion[r.region] || 0) !== r.groups * r.size).map((r) => `${r.region}:${perRegion[r.region] || 0}`);
ok('count per region matches its rule', wrongCount.length === 0 && list1.length === REGIONAL_BEAST_COUNT, wrongCount.join(',') + ' total ' + list1.length);
ok('strand has none', !perRegion.strand);
ok('authored + generated fit MAX_BEASTS', avoid.length + list1.length <= MAX_BEASTS, `${avoid.length}+${list1.length} / ${MAX_BEASTS}`);
const band = createBand(G.regions);
ok('tier from band: Heath/HighPastures boar-bear tier >= Downs', band.beastTierAt(450, 1350) >= band.beastTierAt(1580, 1430));

// sims: authored only (A) vs authored + generated (B), player at the tower so every far herd is out of the live nav area / > 200 m
const nav = (w) => { const n = buildBeastNav(w, def.nav); return n; };
const events = { emit() {}, on() { return () => {}; } };
const mkSim = (w) => createBeastSim(w, { nav: nav(w), rng: createRng(1), events, band, tileNav: true, spawn: { x: 1480, y: 1030 } });
const simA = quiet(() => mkSim(wA));
const wB = mkWorld();
const gen = quiet(() => spawnRegionalBeasts(wB, G, 12));
ok('spawn adds the same list as generate', gen.length === list1.length && gen.every((b, i) => b.id === list1[i].id && b.x === list1[i].x));
const simB = quiet(() => mkSim(wB));
ok('sim B has authored + generated slots', simB.count === simA.count + gen.length, `${simA.count} -> ${simB.count}`);
const far = gen.map((b) => simB.slotOf(b.id));
ok('all generated slots exist + dormant (far from player)', far.every((s) => s >= 0 && simB.isDormant(s)), far.filter((s) => s < 0 || !simB.isDormant(s)).length + ' not dormant');
const timeSteps = (sim, n) => { for (let i = 0; i < 200; i++) sim.step(1480, 1030, 0); const t0 = performance.now(); for (let i = 0; i < n; i++) sim.step(1480, 1030, 0); return (performance.now() - t0) / n; };
let a = 1e9, b = 1e9; for (let k = 0; k < 5; k++) { a = Math.min(a, timeSteps(simA, 600)); b = Math.min(b, timeSteps(simB, 600)); }
console.log(`step ms: authored only ${a.toFixed(4)}, + ${gen.length} dormant ${b.toFixed(4)}`);
ok('active step cost ~unchanged with far herds dormant', b <= a * 1.35 + 0.01, `${a.toFixed(4)} -> ${b.toFixed(4)} ms/step`);

// save/load of a dead generated beast (fresh world + same generation -> same slots)
const id = gen[3].id, slot = simB.slotOf(id);
simB.state[slot] = STATE_CORPSE; simB.entities[slot].components.health.hp = 0;
const saved = JSON.parse(JSON.stringify(simB.save()));
const wC = mkWorld(); quiet(() => spawnRegionalBeasts(wC, G, 12));
const simC = quiet(() => mkSim(wC));
simC.load(saved);
ok('dead generated beast stays dead after save/load (by stable id)', simC.slotOf(id) === slot && simC.isDead(simC.slotOf(id)) && !simC.isDead(simC.slotOf(gen[4].id)));

console.log(`regionalBeasts: ${pass} passed, ${fail} failed`);
if (fail) { console.error(failures.join('\n')); process.exit(1); }
