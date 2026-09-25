#!/usr/bin/env node
// US-057: one-command test runner (docs/backlog.md row 30a).
//
//   node tools/run-tests.mjs [--filter <substr>] [--json <file>] [--timeout-ms <n>]
//
// Finds every `*.test.js` / `*.test.mjs` under engine/, game/, tools/
// (skipping node_modules, design/preview and .git), runs each in its own
// child `node` process with a timeout (default 60s, override with
// --timeout-ms or the KESTREL_TEST_TIMEOUT_MS env var - used by
// run-tests.test.mjs to test the TIMEOUT path without actually waiting
// 60s), plus runs `node tools/check-deps.mjs` as one more suite.
//
// Prints one line per suite:
//   PASS|FAIL|TIMEOUT|WARN <name> <ms>ms
// then a total summary line, and exits 1 if any suite FAILed or TIMEOUT'd
// (WARN does not fail the run by itself - see below).
//
// WARN: this project's suites are hand-rolled (no test framework) and most
// print a line starting with "FAIL" per failed check (see e.g.
// engine/core/behaviours.test.js: `console.error('FAIL:', f)`) while also
// correctly setting a nonzero exit code. A suite that exits 0 (or has an
// unset/zero exitCode) but printed such a line is almost certainly one that
// forgot to set its own exit code, so it is reported WARN rather than PASS
// - a real risk, not a hypothetical one, given how many suites in this repo
// follow this exact hand-rolled pattern.
//
// --filter <substr>: only run suites whose path contains the substring.
// --json <file>: write a JSON report - for each suite: name, status, ms,
//   and (on FAIL/TIMEOUT/WARN) the last 20 lines of its combined
//   stdout+stderr.
//
// Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = process.cwd();

const SKIP_DIRS = new Set(['node_modules', '.git']);
// path fragments (posix-style, relative to ROOT) that are skipped entirely.
const SKIP_PATH_FRAGMENTS = ['design/preview'];

function parseArgs(argv) {
  const opts = { filter: null, json: null, timeoutMs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--filter') opts.filter = argv[++i];
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
  }
  return opts;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Recursively find every *.test.js / *.test.mjs file under `dir`. */
function findTestFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // dir doesn't exist - fine, just skip it
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = toPosix(path.relative(ROOT, full));
    if (SKIP_PATH_FRAGMENTS.some((frag) => rel.includes(frag))) continue;
    if (entry.isDirectory()) {
      findTestFiles(full, out);
    } else if (entry.isFile() && /\.test\.(js|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function collectSuites(root, filter) {
  const dirs = ['engine', 'game', 'tools'].map((d) => path.join(root, d));
  let files = [];
  for (const d of dirs) files = files.concat(findTestFiles(d));
  files.sort();
  // check-deps.mjs is not itself a *.test.* file but is required by the ACs.
  const checkDeps = path.join(root, 'tools', 'check-deps.mjs');
  if (fs.existsSync(checkDeps)) files.push(checkDeps);
  if (filter) files = files.filter((f) => toPosix(path.relative(root, f)).includes(filter));
  return files;
}

/** Runs one suite as `node <file>`, capturing combined stdout+stderr,
 * honouring `timeoutMs`. Resolves with { status, ms, output }. */
function runSuite(file, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [file], { cwd: ROOT });
    let output = '';
    let settled = false;
    let timedOut = false;

    child.stdout.on('data', (d) => { output += d.toString(); });
    child.stderr.on('data', (d) => { output += d.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = Date.now() - start;
      if (timedOut) {
        resolve({ status: 'TIMEOUT', ms, output });
        return;
      }
      if (code !== 0) {
        resolve({ status: 'FAIL', ms, output });
        return;
      }
      // Exit 0: check for a suite that printed a FAIL-shaped line anyway.
      const printedFail = /(^|\n)\s*FAIL\b/.test(output);
      resolve({ status: printedFail ? 'WARN' : 'PASS', ms, output });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const ms = Date.now() - start;
      output += `\n[run-tests] failed to spawn: ${err.message}`;
      resolve({ status: 'FAIL', ms, output });
    });
  });
}

function lastLines(text, n) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const timeoutMs = opts.timeoutMs ?? (process.env.KESTREL_TEST_TIMEOUT_MS
    ? Number(process.env.KESTREL_TEST_TIMEOUT_MS)
    : 60000);

  const suites = collectSuites(ROOT, opts.filter);
  const results = [];
  let anyFail = false;

  for (const file of suites) {
    const name = toPosix(path.relative(ROOT, file));
    const { status, ms, output } = await runSuite(file, timeoutMs);
    if (status === 'FAIL' || status === 'TIMEOUT') anyFail = true;
    console.log(`${status} ${name} ${ms}ms`);
    results.push({ name, status, ms, output });
  }

  const counts = { PASS: 0, FAIL: 0, TIMEOUT: 0, WARN: 0 };
  for (const r of results) counts[r.status]++;
  console.log(
    `\n${results.length} suite(s): ${counts.PASS} PASS, ${counts.FAIL} FAIL, ` +
    `${counts.TIMEOUT} TIMEOUT, ${counts.WARN} WARN`
  );

  if (opts.json) {
    const report = results.map((r) => {
      const entry = { name: r.name, status: r.status, ms: r.ms };
      if (r.status === 'FAIL' || r.status === 'TIMEOUT' || r.status === 'WARN') {
        entry.output = lastLines(r.output, 20);
      }
      return entry;
    });
    fs.writeFileSync(opts.json, JSON.stringify(report, null, 2));
  }

  process.exit(anyFail ? 1 : 0);
}

main();
