// BEAST-06a: group list determinism, respawn timers + never-in-view, save round trip by gid, difficulty, rule 15, 0 alloc.
// Run: node --expose-gc game/js/quest/sim/spawnDirector.test.js
import { readFileSync } from 'node:fs';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { buildGroups, regionalMembers, createSpawnDirector, RESPAWN_SEC, CAMP_DAYS } from './spawnDirector.js';
import { DIFFICULTY, resolveDifficulty, applyDifficulty } from './difficulty.js';
import { createTactics } from './tactics.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const mem = [];
const add = (kind, key, group, n, x, y) => { for (let k = 0; k < n; k++) mem.push({ kind, key, group, x: x + k * 3, y: y + k }); };
add('boar', 'downs', 0, 3, 500, 500); add('boar', 'downs', 1, 3, 900, 500); add('grey_wolf', 'northwood', 0, 4, 1500, 800); add('deer', 'downs', 0, 4, 300, 300);
const G1 = buildGroups(mem, 12), G2 = buildGroups(mem, 12), G3 = buildGroups(mem, 99);
ok(JSON.stringify(G1) === JSON.stringify(G2), 'same seed -> same group list');
ok(JSON.stringify(G1) !== JSON.stringify(G3), 'other seed -> other routes');
ok(G1.map((g) => g.gid).join() === 'boar.downs.1,boar.downs.2,grey_wolf.northwood.1,deer.downs.1', 'gids ' + G1.map((g) => g.gid));
ok(G1.every((g) => g.route.length >= 3 && g.route.length <= 6 && g.slots.length === g.members.length), 'route 3..6, static slots');

// respawn timer + never in view
let spawned = [];
const dir = createSpawnDirector({ groups: G1, viewHalfRad: 0.5236, los: () => false, onRespawn: (g) => spawned.push(g) });
const wolf = 2, wolfHome = G1[wolf].home;
for (let k = 0; k < 4; k++) dir.memberDied(wolf);
ok(dir.dead[wolf] === 1 && dir.dueAt(wolf) === RESPAWN_SEC.pack, 'pack timer ' + dir.dueAt(wolf));
// player far away (>60 m) looking away: spawns right after the timer, not before
const px = wolfHome[0] - 200, py = wolfHome[1];
const stepFor = (sec, fx, fy) => { for (let s = 0; s < sec * 60; s++) dir.step(1 / 60, px, py, fx, fy); };
stepFor(RESPAWN_SEC.pack - 5, -1, 0); ok(spawned.length === 0, 'not before timer');
stepFor(10, -1, 0); ok(spawned.length === 1 && dir.alive[wolf] === 4, 'respawn after timer');
// in cone: player turning toward home -> blocked; then turns away -> spawns on retry
for (let k = 0; k < 4; k++) dir.memberDied(wolf);
spawned = []; stepFor(RESPAWN_SEC.pack + 1, 1, 0); ok(spawned.length === 0 && dir.deferred > 0, 'no spawn inside view cone');
stepFor(6, 0.9, 0.436); ok(spawned.length === 0, 'cone + 15deg margin: 25deg off-axis still blocked');
stepFor(6, 0, 1); ok(spawned.length === 1, 'spawns once player looks away (<= 5 s retry)');
// < 60 m blocks, LOS blocks
ok(!dir.canSpawnAt(wolfHome[0], wolfHome[1], wolfHome[0] - 50, wolfHome[1], -1, 0), '< 60 m blocked');
const dl = createSpawnDirector({ groups: G1, los: () => true });
ok(!dl.canSpawnAt(wolfHome[0], wolfHome[1], px, py, -1, 0), 'LOS blocks');
// difficulty timer
const hard = resolveDifficulty('hard'); ok(Object.isFrozen(hard) && resolveDifficulty('x') === DIFFICULTY.normal, 'resolve');
dir.setDifficulty(hard); ok(Math.abs(dir.dueAt(wolf) - dir.diedAt[wolf] - 480 * 0.7) < 1e-9, 'hard x0.7');
// bosses + camps
const bg = [{ gid: 'boss.x.1', kind: 'b', region: 'x', cls: 'boss', slots: [0], members: [], home: [0, 0], route: [] }, { gid: 'camp.y.1', kind: 'c', region: 'y', cls: 'camp', slots: [1, 2], members: [], home: [0, 0], route: [] }];
const db = createSpawnDirector({ groups: bg, dayLenSec: 100, onRespawn: (g) => spawned.push('b' + g) });
db.memberDied(0); db.memberDied(1); db.memberDied(1); spawned = [];
for (let s = 0; s < 60 * 250; s++) db.step(1 / 60, 500, 500, 1, 0);
ok(!spawned.includes('b0') && !spawned.includes('b1') && db.dead[1] === 1, 'boss never; camp not before 3 days (300 s)');
for (let s = 0; s < 60 * 100; s++) db.step(1 / 60, 500, 500, 1, 0);
ok(spawned.includes('b1') && !spawned.includes('b0'), 'camp respawns after ' + CAMP_DAYS + ' days');
// save round trip by gid
for (let k = 0; k < 4; k++) dir.memberDied(wolf);
db.memberDied(0);
const st = {}; dir.save(st); db.save(st); // second save overwrites key: keep per-director states separate
const s1 = {}; dir.save(s1); const sv = JSON.parse(JSON.stringify(s1));
ok(Object.keys(sv['beast.v1'].g).join() === 'grey_wolf.northwood.1' && sv['beast.v1'].diff === 'hard', 'only groups with something to remember ' + JSON.stringify(sv));
sv['beast.v1'].g['nope.zz.9'] = { dead: 1, at: 5 };
const d2 = createSpawnDirector({ groups: G1 }); d2.setDifficulty(hard);
ok(d2.load(sv) && d2.dead[wolf] === 1 && d2.alive[wolf] === 0 && Math.abs(d2.dueAt(wolf) - dir.dueAt(wolf)) < 1e-9, 'round trip keeps timer; unknown gid ignored');
const sb = {}; db.save(sb); const d3 = createSpawnDirector({ groups: bg, dayLenSec: 100 }); d3.load(JSON.parse(JSON.stringify(sb)));
ok(d3.dead[0] === 1, 'boss stays dead after load');

// BEAST-06a-WIRE: generateRegionalBeasts-shaped members ({id, species, region, x, y, group}) -> groups -> respawn resets every member slot
{
  const list = [];
  const addR = (species, region, group, n, x, y) => { for (let k = 0; k < n; k++) list.push({ id: `${species}.${region}.${list.length + 1}`, species, region, x: x + k * 3, y, group }); };
  addR('boar', 'downs', 0, 3, 500, 500); addR('boar', 'downs', 1, 3, 900, 500); addR('wolf', 'northwood', 0, 4, 1500, 800); addR('bear', 'alpine', 0, 1, 300, 300);
  const slotOf = (id) => { const i = list.findIndex((b) => b.id === id); return i; };
  const W = buildGroups(regionalMembers(list, slotOf), 12, null, []), W2 = buildGroups(regionalMembers(list, slotOf), 12, null, []);
  ok(W.map((g) => g.gid).join() === 'boar.downs.1,boar.downs.2,grey_wolf.northwood.1,black_bear.alpine.1', 'wire gids ' + W.map((g) => g.gid));
  ok(JSON.stringify(W) === JSON.stringify(W2) && W[2].slots.join() === '6,7,8,9' && W[2].cls === 'pack', 'wire: static slots + class ' + W[2].slots + W[2].cls);
  ok(regionalMembers(list, (id) => (id === 'boar.downs.1' ? -1 : slotOf(id))).length === list.length - 1, 'untracked members dropped');
  const resets = [];
  const mk = () => createSpawnDirector({ groups: W, los: () => false, onRespawn: (gi, g) => { for (const sl of g.slots) resets.push(sl); } });
  const d = mk(); const home = W[2].home, px = home[0] - 300, py = home[1];
  for (let k = 0; k < 4; k++) d.memberDied(2);
  const hashRun = () => { const dd = mk(); resets.length = 0; for (let k = 0; k < 4; k++) dd.memberDied(2); for (let s = 0; s < 60 * 600; s++) dd.step(1 / 60, px, py, -1, 0); return resets.join() + ':' + dd.respawns; };
  const h1 = hashRun(), h2 = hashRun();
  ok(h1 === '6,7,8,9:1' && h1 === h2, 'wire: pack respawn resets its 4 slots after region time, player away, replay equal: ' + h1);
  resets.length = 0; const dv = mk(); for (let k = 0; k < 4; k++) dv.memberDied(2);
  for (let s = 0; s < 60 * 600; s++) dv.step(1 / 60, px, py, 1, 0); // looking toward home, player 300 m away: cone blocks
  ok(resets.length === 0 && dv.deferred > 0, 'wire: no respawn in view');
  // save/load round trip across a fresh director (new session)
  const dm = mk(); for (let k = 0; k < 4; k++) dm.memberDied(2); for (let s = 0; s < 60 * 100; s++) dm.step(1 / 60, px, py, -1, 0);
  const sv = JSON.parse(JSON.stringify(dm.save({}))); const dl2 = mk(); dl2.load({ 'beast.v1': sv });
  resets.length = 0; for (let s = 0; s < 60 * 500; s++) dl2.step(1 / 60, px, py, -1, 0);
  ok(dl2.dead[2] === 0 && resets.join() === '6,7,8,9', 'wire: save/load keeps the pending timer, then respawns');
}
// applyDifficulty -> tactics
const sim = { tactics: createTactics(8, 1) };
ok(applyDifficulty(sim, 'hard', dir) && sim.tactics.tokM === 3 && applyDifficulty(sim, 'easy') && sim.tactics.tokM === 1, 'applyDifficulty sets tokM');
sim.tactics.nM = 1; ok(applyDifficulty(sim, 'hard') === false && sim.tactics.tokM === 1, 'refused while engaged');
// determinism of director state
const run = () => { const d = createSpawnDirector({ groups: G1 }); d.memberDied(0); d.memberDied(0); d.memberDied(0); for (let s = 0; s < 60 * 500; s++) d.step(1 / 60, 0, 0, 1, 0); return d.respawns + ':' + d.deferred + ':' + d.t; };
ok(run() === run(), 'deterministic');
// rule 15 + alloc
const src = readFileSync(new URL('./spawnDirector.js', import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(!/Math\.random|Date\.now|performance\.now|Math\.(sin|cos|atan2?|tan)\b.*\n?/.test(src.replace(/const viewCos[^\n]*/, '')), 'rule 15 (viewCos is create-time)');
ok(!/new Map|\.forEach\(|for \(const \w+ of D\./.test(src.slice(src.indexOf('D.step'), src.indexOf('D.save'))), 'no Map iteration in step');
const da = createSpawnDirector({ groups: G1, los: () => false, onRespawn: () => {} });
for (let s = 0; s < 600; s++) da.step(1 / 60, 0, 0, 1, 0);
{ // min of 5 gc'd windows (single window read heap noise 0-15 B under load)
  const r = allocProbe((n) => { for (let s = 0; s < n; s++) da.step(1 / 60, 0, 0, 1, 0); }, { n: 60000 });
  if (!skipNote(r, 'spawnDirector alloc')) ok(r.perCall < 8, 'alloc/step ' + r.perCall.toFixed(2) + ' B');
}
console.log(fails ? `spawnDirector: ${fails} FAIL` : 'spawnDirector: all OK'); process.exit(fails ? 1 : 0);
