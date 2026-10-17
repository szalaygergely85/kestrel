// ED-QUI-07b1 (38.85): node tools/quest-sim.mjs --quest <id> [--json] - exit 0 on burl.road, exit 1 on a broken fixture tree naming the step.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeOk } from '../engine/test/assert.js';

let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = fileURLToPath(new URL('./quest-sim.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });

{
  const r = run('--quest', 'burl.road');
  ok('burl.road exit 0', r.status === 0, r.stdout + r.stderr);
  ok('burl.road prints steps + OK line', /PASS 1 offered/.test(r.stdout) && /quest burl\.road: OK/.test(r.stdout), r.stdout);
  const j = run('--quest', 'burl.road', '--json');
  let o = null; try { o = JSON.parse(j.stdout); } catch { /* checked below */ }
  ok('--json: parseable, ok, steps', j.status === 0 && o && o.quest === 'burl.road' && o.ok === true && Array.isArray(o.steps) && o.firstFail === null, j.stdout.slice(0, 200));
  const a = run('--all');
  ok('--all prints a total line and one line per quest', /^\d+ quest\(s\): \d+ PASS, \d+ FAIL$/m.test(a.stdout) && /^PASS burl\.road$/m.test(a.stdout), a.stdout.slice(-300));
  ok('--all exit code matches FAIL count', (a.status === 0) === /, 0 FAIL/.test(a.stdout), 'status ' + a.status);
  ok('no --quest id -> usage, exit 2', run('--quest').status === 2);
}

// broken fixture: a copy of the content tree with the 'bendRelay' area removed
const tmp = mkdtempSync(join(tmpdir(), 'questsim-'));
try {
  for (const d of ['quests', 'dialogue', 'worlds']) cpSync(join(ROOT, 'content', d), join(tmp, 'content', d), { recursive: true });
  const ap = join(tmp, 'content/quests/areas.json'), areas = JSON.parse(readFileSync(ap, 'utf8'));
  delete areas.areas.bendRelay; writeFileSync(ap, JSON.stringify(areas));
  const r = run('--quest', 'burl.road', '--root', tmp);
  ok('broken fixture exit 1', r.status === 1, 'status ' + r.status + ' ' + r.stderr.slice(0, 300));
  ok('broken fixture names the failing step', /FAIL at 5 objectives: area 'bendRelay'/.test(r.stdout), r.stdout.slice(-300));
  const j = run('--quest', 'burl.road', '--root', tmp, '--json');
  let o = null; try { o = JSON.parse(j.stdout); } catch { /* checked below */ }
  const al = run('--all', '--root', tmp);
  ok('--all on broken fixture: exit 1 + FAIL burl.road line', al.status === 1 && /^FAIL burl\.road at /m.test(al.stdout), al.stdout.slice(-300));
  ok('broken fixture --json firstFail', j.status === 1 && o && o.firstFail && o.firstFail.name === '5 objectives', j.stdout.slice(0, 200));
} finally { rmSync(tmp, { recursive: true, force: true }); }

console.log(`quest-sim-cli.test: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of failures) console.error(f); process.exit(1); }
