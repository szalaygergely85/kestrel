// Build the portable Windows zip: node tools/desktop/pack.mjs [--no-zip] [--skip-download]
// Output: tools/desktop/dist/ASCII-Quest-win-x64/ (+ .zip). Only the runtime game files ship (see pack-filter.mjs).
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldShip } from './pack-filter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const dist = path.join(here, 'dist');
const name = 'ASCII-Quest-win-x64';
const out = path.join(dist, name);
const zip = path.join(dist, `${name}.zip`);
const args = new Set(process.argv.slice(2));
const mb = n => (n / 1048576).toFixed(1) + ' MB';

// 1. Electron runtime (pinned in package-lock; official install script downloads the binary).
const electronDist = path.join(here, 'node_modules/electron/dist');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  if (args.has('--skip-download')) throw new Error('electron.exe missing and --skip-download given');
  if (!fs.existsSync(path.join(here, 'node_modules/electron'))) {
    console.log('npm ci (tools/desktop) ...');
    execSync('npm ci', { cwd: here, stdio: 'inherit' });
  }
  console.log('Downloading the pinned Electron binary via electron/install.js (official script) ...');
  execFileSync(process.execPath, ['node_modules/electron/install.js'], { cwd: here, stdio: 'inherit' });
}

// 2. Fresh output folder = Electron dist, renamed exe, no default app.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(electronDist, out, { recursive: true });
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'ASCII Quest.exe'));
fs.rmSync(path.join(out, 'resources/default_app.asar'), { force: true });

// 3. resources/app = shell files + the tracked runtime game files that pass the filter.
const app = path.join(out, 'resources/app');
fs.mkdirSync(app, { recursive: true });
for (const f of ['main.cjs', 'preload.cjs', 'probe.cjs']) fs.copyFileSync(path.join(here, f), path.join(app, f));
let version = '0.1.0';
try { version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version || version; } catch { /* keep default */ }
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'ascii-quest', productName: 'ASCII Quest', version, main: 'main.cjs' }, null, 2) + '\n');
// git ls-files = tracked files only, so untracked local packs can never leak in.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
let files = 0, bytes = 0;
for (const rel of tracked) {
  if (!shouldShip(rel)) continue;
  const src = path.join(repo, rel);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(app, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  files++; bytes += fs.statSync(src).size;
}
fs.copyFileSync(path.join(here, 'README-PLAYER.txt'), path.join(out, 'README-PLAYER.txt'));
console.log(`game files: ${files} (${mb(bytes)}), folder: ${out}`);

// 4. Zip with Windows' bundled tar.exe (bsdtar), no npm packages.
if (!args.has('--no-zip')) {
  fs.rmSync(zip, { force: true });
  execFileSync(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/tar.exe'), ['-a', '-c', '-f', zip, '-C', dist, name], { stdio: 'inherit' });
  console.log(`zip: ${zip} (${mb(fs.statSync(zip).size)})`);
}
