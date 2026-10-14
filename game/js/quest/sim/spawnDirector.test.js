// BEAST-06a: group list determinism, respawn timers + never-in-view, save round trip by gid, difficulty, rule 15, 0 alloc.
// Run: node --expose-gc game/js/quest/sim/spawnDirector.test.js
import { readFileSync } from 'node:fs';
import { allocProbe, skipNote } from '../../../../tools/allocProbe.mjs';
import { buildGroups, createSpawnDirector, RESPAWN_SEC, CAMP_DAYS } from './spawnDirector.js';
import { createDirectorWire } from './directorWire.js';
import { DIFFICULTY, resolveDifficulty, applyDifficulty } from './difficulty.js';
import { createTactics } from './tactics.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const mem = [];
const add = (kind, key, group, n, x, y) => { for (let k = 0; k < n; k++) mem.push({ kind, key, group, x: x + k * 3, y: y + k }); };
add('boar', 'downs', 0, 3, 500, 500); add('boar', 'downs', 1, 3, 900, 500); add('grey_wolf', 'northwood', 0, 4, 1500, 800); add('deer', 'downs', 0, 4, 300, 300);
const G1 = buildGroups(mem, 12), G2 = buildGroups(mem, 12), G3 = buildGroups(mem, 99);
ok(JSON.stringify(G1) === JSON.stringify(G2), 'same seed -> same group list');
ok(JSON.stringify(G1) !== JSON.stringify(G3), 'other seed -> other routes');
ok(G1.map((g) => g.gid).join() === 'downs/0,downs/1,northwood/0,downs/0:deer', 'gids ' + G1.map((g) => g.gid));
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
ok(Object.keys(sv).join() === 'spawnDirector.v1' && !('beast.v1' in sv) && Object.keys(sv['spawnDirector.v1']).join() === 'northwood/0', 'own key, only groups with something to remember ' + JSON.stringify(sv));
sv['spawnDirector.v1']['nope/9'] = { dead: 1, respawnAt: 5 };
const d2 = createSpawnDirector({ groups: G1 }); d2.setDifficulty(hard);
ok(d2.load(sv) && d2.dead[wolf] === 1 && d2.alive[wolf] === 0 && Math.abs(d2.dueAt(wolf) - d2.t - sv['spawnDirector.v1']['northwood/0'].respawnAt) < 1e-9, 'round trip keeps remaining timer; unknown gid ignored');
ok(createSpawnDirector({ groups: G1 }).load({ 'beast.v1': { t: 5 } }) === false && createSpawnDirector({ groups: G1 }).load({}) === false, 'old save without the key loads fine');
const sb = {}; db.save(sb); const d3 = createSpawnDirector({ groups: bg, dayLenSec: 100 }); d3.load(JSON.parse(JSON.stringify(sb)));
ok(d3.dead[0] === 1, 'boss stays dead after load');
// bind + slotDied + wire (fake sim)
{
  const ids = mem.map((_, i) => 'm' + i); mem.forEach((m, i) => { m.id = ids[i]; });
  const G = buildGroups(mem, 12), d = createSpawnDirector({ groups: G, los: () => false });
  const reset = [], handlers = {};
  const fake = { count: mem.length, slotOf: (id) => ids.indexOf(id), resetSlot: (sl) => reset.push(sl) };
  const w = createDirectorWire({ director: d, sim: fake, events: { on: (n, f) => { handlers[n] = f; return () => { delete handlers[n]; }; } } });
  ok(d.groupOfSlot instanceof Int16Array && d.groupOfSlot[0] === 0 && d.groupOfSlot[3] === 1 && d.groupOfSlot[6] === 2, 'slot -> group map');
  for (let k = 6; k < 10; k++) handlers['beast:died']({ id: 'm' + k });
  ok(d.dead[2] === 1 && d.dead[0] === 0, 'beast:died -> group dead');
  const st = {}; w.save(st); ok(JSON.stringify(st).includes('northwood/0'), 'wire save');
  w.dispose(); ok(!handlers['beast:died'], 'dispose');
  const d4 = createSpawnDirector({ groups: G, los: () => false, onRespawn: (gi, g) => w.respawn(gi, g) });
  d4.bind(fake); d4.load(st); for (let s = 0; s < 60 * 500; s++) d4.step(1 / 60, -9999, 0, -1, 0);
  ok(reset.join() === '6,7,8,9', 'respawn resets members via resetSlot ' + reset);
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
