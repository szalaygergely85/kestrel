// LIFE-10: shortened bench-life run (0.05 game hour, 2 distances): output shape + sanity. Run: node tools/bench-life.test.mjs
import { runBench } from './bench-life.mjs';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const t0 = performance.now();
const out = await runBench({ hours: 0.05, start: 21, scenarios: 2, goblinHours: 0.04 });
const secs = (performance.now() - t0) / 1000;
ok(out.results.length === 4, '2 distance scenarios (first two; all 3 are in the full bench) + the goblin scenario + the BEAST-06b caps-full scene');
const gob = out.results[2], capsR = out.results[3];
ok(capsR.scenario.startsWith('caps-full') && capsR.beasts === 160 && capsR.activeN <= 48 && capsR.engagedN <= 12, `BEAST-06b caps-full: 160 slots, <= 48 active, <= 12 engaged (${capsR.beasts}/${capsR.activeN}/${capsR.engagedN})`);
ok(capsR.activeN > 0 && out.rows.some((r) => r.scenario === capsR.scenario && r.cap === 1.2) && out.rows.some((r) => r.scenario === capsR.scenario && r.cap === 8), 'caps-full budget rows (beastSim 1.2 ms, total 8 ms)');
ok(gob.scenario.startsWith('goblins') && gob.beasts === 48 && gob.goblins === 20 && gob.throwers === 6 && gob.flyMax === 8, 'GOB-08 scenario: 48 beasts, 20 goblins, 6 throwers, 8 spears in flight');
ok(gob.raidStarts > 0, 'goblin torch raid started');
ok(gob.sys.spears && gob.sys.spears.p95 >= gob.sys.spears.p50 && gob.sys.spears.max >= gob.sys.spears.p999, 'spears stats shape');
ok(out.rows.some((r) => r.scenario === gob.scenario && r.label.startsWith('beastSim goblin extras') && r.cap === 0.1), 'goblin extras budget row');
for (const r of out.results.filter((x) => x !== capsR)) {
  ok(r.villagers === 5, 'villagers 5');
  ok(r.beasts > 0, 'beasts present');
  for (const k of ['villagers', 'raids', 'life', 'fauna', 'beast', ...(r === gob ? ['spears'] : [])]) {
    const s = r.sys[k];
    ok(s && s.p50 >= 0 && s.p95 >= s.p50 && s.max >= s.p95 && Number.isFinite(s.mean), `${r.scenario} ${k} stats shape`);
  }
  ok(r.sys.life.mean < 0.25, `${r.scenario} life mean sane (${r.sys.life.mean.toFixed(4)} ms)`);
}
ok(out.rows.length > 0 && out.rows.every((r) => ['PASS', 'FLAG'].includes(r.verdict) || r.verdict.startsWith('INFO')), 'rows have verdicts');
// wall-clock part (LIFE-03-SPIKE): no one-off hitch in a villager step; correctness above stays always on
if (process.env.BAKE_BENCH === '1') for (const r of out.results) ok(r.sys.villagers.p95 < 1 && r.warmMs > 0, `${r.scenario} villager step p95 < 1 ms, band baked at load (${r.sys.villagers.p95.toFixed(3)}; full-run p99.9 <= 4 is the bench row)`);
ok(typeof out.chat === 'string', 'chat note present');
if (process.env.BAKE_BENCH === '1') ok(secs < 40, `runs in < 40 s (${secs.toFixed(1)} s)`);
console.log(fails ? `FAILED ${fails}` : `bench-life.test: all ok (${secs.toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
