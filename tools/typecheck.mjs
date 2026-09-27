#!/usr/bin/env node
// ME-00: typed engine API without a build step (docs/backlog.md ME-00,
// PC-B QUEUE 3 item 10a). Runs `tsc --noEmit -p tools/tsconfig.json` against
// the handful of engine files that carry `// @ts-check` + JSDoc so far
// (see tools/tsconfig.json's `include`).
//
// TypeScript is a devDependency only (root package.json) - the game itself
// never needs `npm install` to run from a static server. This script tries
// the locally installed compiler first, falls back to `npx tsc` (which will
// itself fail offline/without install), and if neither is available prints
// a clear message and exits 0 so it degrades gracefully rather than
// crashing tools/run-tests.mjs's `typecheck` suite (reported WARN, never
// FAIL - see run-tests.mjs).
//
//   node tools/typecheck.mjs
//
// Exit code: whatever `tsc` returns (0 = clean, nonzero = type errors), or
// 0 if no compiler could be found at all.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const TSCONFIG = path.join(__dirname, 'tsconfig.json');

function localTscPath() {
  const bin = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  const p = path.join(ROOT, 'node_modules', '.bin', bin);
  return fs.existsSync(p) ? p : null;
}

function main() {
  const local = localTscPath();
  if (local) {
    const res = spawnSync(local, ['--noEmit', '-p', TSCONFIG], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    process.exit(res.status ?? 1);
  }

  // Fall back to npx, pinned to the `typescript` package (plain `npx tsc`
  // resolves to an unrelated, deprecated `tsc` npm package when TypeScript
  // isn't installed - `-p typescript` forces the right one). Needs
  // network/npm cache access; fine if it fails - the caller treats a
  // nonzero exit here as WARN, not FAIL.
  const npxRes = spawnSync('npx', ['--yes', '-p', 'typescript', 'tsc', '--noEmit', '-p', TSCONFIG], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (npxRes.error || npxRes.status === null) {
    console.log(
      '[typecheck] no local TypeScript install and npx unavailable - ' +
      'run `npm install` at the repo root to enable typechecking. Skipping (non-fatal).'
    );
    process.exit(0);
  }
  process.exit(npxRes.status ?? 1);
}

main();
