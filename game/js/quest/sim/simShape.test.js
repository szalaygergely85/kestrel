// BITE-ALLOC guard: the beastSim object must stay in V8 fast-properties mode for >= 12 sims and keep <= 145 top-level keys.
// Runs the probe in a child node with --allow-natives-syntax. Run: node game/js/quest/sim/simShape.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const probe = fileURLToPath(new URL('./simShape.probe.mjs', import.meta.url));
const r = spawnSync(process.execPath, ['--allow-natives-syntax', '--no-warnings', probe], { encoding: 'utf8' });
process.stdout.write(r.stdout || '');
if (r.stderr) process.stderr.write(r.stderr);
if (r.status !== 0) { console.log('FAIL sim shape'); process.exit(1); }
console.log('ALL PASS');
