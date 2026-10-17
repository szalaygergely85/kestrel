// LIFE-02 schedule.test.js: 24 h loop per NPC, forced sleep, need-driven eat/chat, resolveAt == stepped at 6 h, determinism.
import fs from 'node:fs';
import { ROUTINES, inWindow } from '../quest/outwallRoutines.js';
import { lifeFromRoutines, createSchedule, step, current, resolveAt, choose, snap } from './schedule.js';
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

const life = lifeFromRoutines(ROUTINES);
// the shipped data file == the converter output
const file = JSON.parse(fs.readFileSync(new URL('../../../content/life/outwall.life.json', import.meta.url), 'utf8'));
ok(JSON.stringify(file) === JSON.stringify(life), 'content/life/outwall.life.json matches lifeFromRoutines(ROUTINES) (regenerate it)');
ok(life.npcs.length === Object.keys(ROUTINES).length, 'one entry per OUT-02 NPC');

const SEC = 7200, STEPS = SEC * 60; // one game day = 7200 real seconds
const hourAt = (t) => (t / 300) % 24;

// run one full day; returns per-NPC visited kinds + a hash of every decision
function runDay(startHour = 0) {
  const s = createSchedule(life, startHour, 0);
  const seen = life.npcs.map(() => new Set());
  const sleepOk = life.npcs.map(() => true);
  let h = 2166136261;
  for (let k = 0; k < STEPS; k++) {
    const hour = (startHour + (k / 60) / 300) % 24;
    step(s, hour, 0);
    if (k % 60 === 59) for (let i = 0; i < s.n; i++) {
      const c = current(s, i);
      seen[i].add(c.kind);
      const npc = life.npcs[i];
      const inSleep = npc.activities.some((a) => a.kind === 'sleep' && inWindow(hour, a.from, a.to));
      if (inSleep && c.kind !== 'sleep') sleepOk[i] = false;
      h = Math.imul(h ^ (s.act[i] + 2) ^ (Math.round(s.hunger[i] * 1000) << 4) ^ (Math.round(s.social[i] * 1000) << 14), 16777619) >>> 0;
    }
  }
  return { seen, sleepOk, h, s };
}
const t0 = Date.now();
const a = runDay(), b = runDay();
life.npcs.forEach((n, i) => {
  ok(a.seen[i].has('sleep'), n.id + ' sleeps');
  ok(a.sleepOk[i], n.id + ' is asleep during its whole sleep window (forced)');
  ok(a.seen[i].has('eat'), n.id + ' eats once hungry');
  ok(a.seen[i].size >= 3, n.id + ' does >= 3 kinds in 24 h: ' + [...a.seen[i]]);
});
ok(a.h === b.h, 'determinism: two runs, same hash (' + a.h + ' vs ' + b.h + ')');
for (let i = 0; i < life.npcs.length; i++) for (const k of ['energy', 'hunger', 'social']) {
  const v = a.s[k][i]; ok(v >= 0 && v <= 1, life.npcs[i].id + ' ' + k + ' in 0..1');
}

// need-driven picks: same hour, hunger / social decide
const hesk = life.npcs[0];
ok(hesk.activities[choose(hesk, 0, 13, 0, 0.0, 0.0)].kind !== 'eat', 'not hungry at 13 h -> no eat');
ok(hesk.activities[choose(hesk, 0, 13, 0, 0.9, 0.0)].kind === 'eat', 'hungry at 13 h -> eat');
ok(hesk.activities[choose(hesk, 0, 16, 0, 0.0, 0.1)].kind !== 'chat', 'sociable-low at 16 h -> no chat');
ok(hesk.activities[choose(hesk, 0, 16, 0, 0.0, 0.9)].kind === 'chat', 'lonely at 16 h -> chat');
ok(hesk.activities[choose(hesk, 0, 3, 0, 1, 1)].kind === 'sleep', 'sleep forced even when starving at 3 h');
// tie-break by hash is stable
ok(choose(hesk, 0, 13, 5, 0.2, 0.2) === choose(hesk, 0, 13, 5, 0.2, 0.2), 'tie-break stable');

// eat actually cuts hunger, chat cuts social (stepped)
{
  const s = createSchedule(life, 12.1, 0); s.hunger[0] = 0.95;
  for (let k = 0; k < 60 * 120; k++) step(s, 12.1 + (k / 60) / 300, 0);
  ok(s.hunger[0] < 0.9, 'hunger drops while eating (' + s.hunger[0].toFixed(2) + ')');
}

// resolveAt == stepped result at 6 h (everyone sleeps), and the snap path
{
  const s = runDay(0);
  const sch = createSchedule(life, 0, 0);
  for (let k = 0; k < 6 * 300 * 60; k++) step(sch, (k / 60) / 300, 0);
  for (let i = 0; i < life.npcs.length; i++) {
    const r = resolveAt(life, i, 6, 0), c = current(sch, i);
    ok(r.act === c.act && r.x === c.x && r.y === c.y && r.pose === c.pose && r.kind === c.kind, life.npcs[i].id + ': resolveAt(6) == stepped at 6 h (' + r.kind + ' vs ' + c.kind + ')');
  }
  snap(sch, 12.5, 0);
  for (let i = 0; i < life.npcs.length; i++) ok(sch.act[i] === life.npcs[i].activities.indexOf(life.npcs[i].activities[resolveAt(life, i, 12.5, 0).act]), 'snap == resolveAt at 12.5 h');
}
ok(Date.now() - t0 < 5000, 'test under 5 s (' + (Date.now() - t0) + ' ms)');
console.log(fails ? fails + ' FAILED' : 'schedule.test.js: PASS (' + (Date.now() - t0) + ' ms)');
process.exit(fails ? 1 : 0);
