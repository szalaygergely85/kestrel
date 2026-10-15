// OB-185: every region meets the enemy density floor and no road stretch is empty for > 250 m (tools/density-report.mjs).
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const out = execFileSync(process.execPath, [new URL('./density-report.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const m = /longest road stretch .* = (\d+) m/.exec(out); assert.ok(m, 'walk test line');
assert.ok(+m[1] <= 250, `longest empty road stretch ${m[1]} m > 250`);
assert.match(out, /Regions below 50\/km2 \(walkable >= 0\.02 km2\): none/);
const tot = /\| TOTAL \|.*\| ([\d.]+) \|\n/.exec(out); assert.ok(tot && +tot[1] >= 50, 'total density >= 50/km2');
console.log(`density.test OK (longest empty ${m[1]} m, total ${tot[1]}/km2)`);
