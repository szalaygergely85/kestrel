// LIFE-10: shortened bench-life run (0.05 game hour, 2 distances): output shape + sanity. Run: node tools/bench-life.test.mjs
import { runBench } from './bench-life.mjs';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const t0 = performance.now();
const out = await runBench({ hours: 0.05, start: 21, scenarios: 2 });
const secs = (performance.now() - t0) / 1000;
ok(out.results.length === 2, '2 distance scenarios (first two; all 3 are in the full bench)');
for (const r of out.results) {
  ok(r.villagers === 5, 'villagers 5');
  ok(r.beasts > 0, 'beasts present');
  for (const k of ['villagers', 'raids', 'life', 'fauna', 'beast']) {
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
