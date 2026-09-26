// Tests for tools/run-tests.mjs (US-057, docs/backlog.md row 30a). Plain
// Node ESM, no framework (matches tools/vox-import.test.mjs etc.) - run
// directly:
//   node tools/run-tests.test.mjs
//
// Builds a temp directory with fixture suites (pass / fail / hang / warn),
// plus check-deps.mjs and validate-content.mjs stand-ins (US-061), then
// runs the real tools/run-tests.mjs as a child process against that temp
// dir (via cwd) and asserts on its stdout, exit code and --json report.

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNNER = path.join(__dirname, 'run-tests.mjs');

let passed = 0;
const failures = [];

function test(name, fn) {
  return fn()
    .then(() => { passed++; console.log(`ok - ${name}`); })
    .catch((e) => {
      failures.push(name);
      console.error(`FAIL - ${name}`);
      console.error(e.stack || e.message);
    });
}

/** Builds a temp fixture repo: tools/run-tests.mjs requires files under
 * engine/, game/ or tools/, so mirror that shape with just `tools/`. */
function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-run-tests-'));
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  // A minimal check-deps.mjs stand-in so the runner's "always add
  // tools/check-deps.mjs" step doesn't fail this fixture repo for
  // unrelated reasons - it just prints OK and exits 0.
  fs.writeFileSync(
    path.join(root, 'tools', 'check-deps.mjs'),
    "console.log('check-deps OK (0 files)');\n"
  );

  // US-061: a minimal validate-content.mjs stand-in, deliberately broken
  // (nonzero exit + a finding-shaped message) to prove run-tests.mjs wires
  // it in as a FAIL-able suite, same as check-deps.mjs above.
  fs.writeFileSync(
    path.join(root, 'tools', 'validate-content.mjs'),
    "console.error('finding: broken content fixture');\nprocess.exit(1);\n"
  );

  fs.writeFileSync(
    path.join(root, 'tools', 'good.test.js'),
    "console.log('ALL PASS');\nprocess.exit(0);\n"
  );

  fs.writeFileSync(
    path.join(root, 'tools', 'bad.test.js'),
    "console.error('FAIL: something broke');\nprocess.exit(1);\n"
  );

  // Exits 0 but prints a FAIL-shaped line - should be reported WARN, not PASS.
  fs.writeFileSync(
    path.join(root, 'tools', 'warn.test.js'),
    "console.error('FAIL: forgot to set exit code');\nprocess.exit(0);\n"
  );

  // Never exits on its own - only killed by the runner's timeout.
  fs.writeFileSync(
    path.join(root, 'tools', 'hang.test.js'),
    'setInterval(() => {}, 1000);\n'
  );

  // Also exercise design/preview and node_modules skipping: a *.test.js in
  // each must NOT show up in the run.
  fs.mkdirSync(path.join(root, 'design', 'preview'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'design', 'preview', 'skipped.test.js'),
    "console.log('should never run'); process.exit(1);\n"
  );
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'node_modules', 'pkg', 'skipped.test.js'),
    "console.log('should never run'); process.exit(1);\n"
  );

  return root;
}

function runRunner(root, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, ...args], { cwd: root });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

// A short override so the hang fixture doesn't actually wait 60s - the
// runner reads --timeout-ms (or KESTREL_TEST_TIMEOUT_MS) to decide how long
// to wait before killing a suite and reporting TIMEOUT.
const FIXTURE_TIMEOUT_MS = 500;

await test('reports PASS/FAIL/WARN/TIMEOUT correctly and exits 1 on failure', async () => {
  const root = makeFixtureRoot();
  try {
    const { code, stdout } = await runRunner(root, ['--timeout-ms', String(FIXTURE_TIMEOUT_MS)]);

    const lines = stdout.split(/\r?\n/);
    const line = (name) => lines.find((l) => l.includes(name));

    assert.ok(/^PASS tools\/good\.test\.js \d+ms$/.test(line('good.test.js') || ''), stdout);
    assert.ok(/^FAIL tools\/bad\.test\.js \d+ms$/.test(line('bad.test.js') || ''), stdout);
    assert.ok(/^WARN tools\/warn\.test\.js \d+ms$/.test(line('warn.test.js') || ''), stdout);
    assert.ok(/^TIMEOUT tools\/hang\.test\.js \d+ms$/.test(line('hang.test.js') || ''), stdout);
    assert.ok(/^PASS tools\/check-deps\.mjs \d+ms$/.test(line('check-deps.mjs') || ''), stdout);
    assert.ok(/^FAIL tools\/validate-content\.mjs \d+ms$/.test(line('validate-content.mjs') || ''), stdout);

    // design/preview and node_modules fixtures must never appear.
    assert.ok(!stdout.includes('skipped.test.js'), stdout);

    // Exactly 6 suites: good, bad, warn, hang, check-deps, validate-content
    // (good + check-deps PASS, bad + validate-content FAIL).
    assert.ok(stdout.includes('6 suite(s): 2 PASS, 2 FAIL, 1 TIMEOUT, 1 WARN'), stdout);

    assert.strictEqual(code, 1, `expected exit code 1, got ${code}\n${stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await test('--filter only runs matching suites', async () => {
  const root = makeFixtureRoot();
  try {
    const { code, stdout } = await runRunner(root, ['--filter', 'good', '--timeout-ms', String(FIXTURE_TIMEOUT_MS)]);
    assert.ok(stdout.includes('good.test.js'), stdout);
    assert.ok(!stdout.includes('bad.test.js'), stdout);
    assert.ok(!stdout.includes('check-deps.mjs'), stdout);
    assert.ok(!stdout.includes('validate-content.mjs'), stdout);
    assert.ok(stdout.includes('1 suite(s): 1 PASS, 0 FAIL, 0 TIMEOUT, 0 WARN'), stdout);
    assert.strictEqual(code, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await test('--filter validate matches the validate-content suite', async () => {
  const root = makeFixtureRoot();
  try {
    const { code, stdout } = await runRunner(root, ['--filter', 'validate', '--timeout-ms', String(FIXTURE_TIMEOUT_MS)]);
    assert.ok(stdout.includes('validate-content.mjs'), stdout);
    assert.ok(!stdout.includes('good.test.js'), stdout);
    assert.ok(!stdout.includes('check-deps.mjs'), stdout);
    assert.ok(stdout.includes('1 suite(s): 0 PASS, 1 FAIL, 0 TIMEOUT, 0 WARN'), stdout);
    assert.strictEqual(code, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await test('--json writes a report with name/status/ms and last-20-lines output on failure', async () => {
  const root = makeFixtureRoot();
  const jsonPath = path.join(root, 'report.json');
  try {
    await runRunner(root, ['--filter', 'tools/bad', '--json', jsonPath, '--timeout-ms', String(FIXTURE_TIMEOUT_MS)]);
    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.strictEqual(report.length, 1);
    assert.strictEqual(report[0].name, 'tools/bad.test.js');
    assert.strictEqual(report[0].status, 'FAIL');
    assert.ok(typeof report[0].ms === 'number');
    assert.ok(Array.isArray(report[0].output));
    assert.ok(report[0].output.some((l) => l.includes('something broke')));
    assert.ok(report[0].output.length <= 20);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await test('--json omits output for a PASS suite', async () => {
  const root = makeFixtureRoot();
  const jsonPath = path.join(root, 'report.json');
  try {
    await runRunner(root, ['--filter', 'tools/good', '--json', jsonPath, '--timeout-ms', String(FIXTURE_TIMEOUT_MS)]);
    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.strictEqual(report.length, 1);
    assert.strictEqual(report[0].status, 'PASS');
    assert.strictEqual(report[0].output, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} test(s) passed`);
if (failures.length) {
  console.error(`${failures.length} test(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
