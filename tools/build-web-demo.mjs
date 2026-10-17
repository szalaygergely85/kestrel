// US-112: static itch.io / web-host demo bundle.  node tools/build-web-demo.mjs [--out dist/web-demo] [--zip]
// Reuses the Electron packer's filter (tools/desktop/pack-filter.mjs) so there is ONE list of what ships, then drops the
// dev/test pages. Only git-TRACKED files are copied (untracked licensed packs / content/local can never leak). dist/ is git-ignored.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shouldShip } from './desktop/pack-filter.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mb = n => (n / 1048576).toFixed(1) + ' MB';

/** Web-demo selection: the packer's runtime filter minus every html page except game/index.html (dev pages, harnesses). */
export function shouldShipWeb(rel) {
  const p = rel.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!shouldShip(p)) return false;
  if (/\.html?$/i.test(p) && p !== 'game/index.html') return false;
  return true;
}

/** Optional local-only scripts (`onerror="this.remove()"`, e.g. design/local/*) that are not shipped: strip the tag so the host logs no 404. */
export function stripOptionalScripts(html, shipped) {
  return html.replace(/[ \t]*<script[^>]*\bsrc="([^"]+)"[^>]*onerror="this\.remove\(\)"[^>]*><\/script>[ \t]*\r?\n?/g,
    (tag, src) => shipped.has(path.posix.normalize(path.posix.join('game', src))) ? tag : '');
}

export function selectFiles(tracked) { return tracked.filter(shouldShipWeb); }

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/** Minimal zip writer (deflate-raw, no zip64: fails loudly past 4 GB / 65535 entries). */
export function writeZip(zipPath, entries /* [{name, file}] */) {
  if (entries.length > 65535) throw new Error('zip: too many entries');
  const fd = fs.openSync(zipPath, 'w'); let pos = 0; const central = [];
  const write = b => { fs.writeSync(fd, b); pos += b.length; };
  for (const { name, file } of entries) {
    const data = fs.readFileSync(file), nameB = Buffer.from(name, 'utf8'), crc = crc32(data);
    let comp = zlib.deflateRawSync(data, { level: 6 }), method = 8;
    if (comp.length >= data.length) { comp = data; method = 0; }
    if (data.length > 0xFFFFFFFE || pos > 0xFFFFFFFE) throw new Error('zip: >4 GB not supported');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameB.length, 26);
    central.push({ nameB, crc, method, cs: comp.length, us: data.length, off: pos });
    write(h); write(nameB); write(comp);
  }
  const cdStart = pos;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(c.method, 10);
    h.writeUInt16LE(0, 12); h.writeUInt16LE(0x21, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.cs, 20); h.writeUInt32LE(c.us, 24);
    h.writeUInt16LE(c.nameB.length, 28); h.writeUInt32LE(c.off, 42);
    write(h); write(c.nameB);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length, 8); e.writeUInt16LE(central.length, 10);
  e.writeUInt32LE(pos - cdStart, 12); e.writeUInt32LE(cdStart, 16);
  write(e); fs.closeSync(fd);
}

const README = `ASCII Quest - browser demo (itch.io upload)
==========================================
1. Zip the CONTENTS of this folder so index.html is at the zip root (or use the .zip made with --zip).
2. itch.io > Edit game > Kind of project: HTML > upload the zip > tick "This file will be played in the browser".
3. Embed options: viewport 1280x720, enable the fullscreen button. No SharedArrayBuffer / cross-origin-isolation headers are
   needed (the game uses none), so the default itch.io hosting works.
Player requirements: a current desktop Chrome or Edge with hardware acceleration ON - the game needs WebGPU. Without it the page
shows "WebGPU required to play" and nothing else starts. Firefox/Safari and phones are not supported.
Size: itch allows up to 1 GB unzipped per HTML5 upload; build-web-demo.mjs warns above 500 MB (slow first load).
`;
const ROOT_INDEX = '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=game/index.html"><title>ASCII Quest</title><a href="game/index.html">Play</a>\n';

export function build({ out, zip }) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  const files = selectFiles(tracked).filter(r => fs.existsSync(path.join(repo, r)));
  fs.rmSync(out, { recursive: true, force: true });
  let bytes = 0;
  for (const rel of files) {
    const dst = path.join(out, rel); fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dst); bytes += fs.statSync(dst).size;
  }
  const idx = path.join(out, 'game/index.html');
  fs.writeFileSync(idx, stripOptionalScripts(fs.readFileSync(idx, 'utf8'), new Set(files)));
  fs.writeFileSync(path.join(out, 'index.html'), ROOT_INDEX);
  fs.writeFileSync(path.join(out, 'README-ITCH.txt'), README);
  const names = [...files, 'index.html', 'README-ITCH.txt'];
  console.log(`web demo: ${names.length} files, ${mb(bytes)} -> ${out}`);
  if (bytes > 500 * 1048576) console.warn(`WARNING: ${mb(bytes)} > 500 MB (itch HTML5 limit is 1 GB unzipped; large uploads load slowly)`);
  if (zip) {
    const zp = out.replace(/[\\/]+$/, '') + '.zip';
    writeZip(zp, names.map(n => ({ name: n, file: path.join(out, n) })));
    const zs = fs.statSync(zp).size; console.log(`zip: ${zp} (${mb(zs)})`);
    if (zs > 500 * 1048576) console.warn('WARNING: zip > 500 MB');
  }
  return { count: names.length, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2); const i = a.indexOf('--out');
  build({ out: path.resolve(repo, i >= 0 ? a[i + 1] : 'dist/web-demo'), zip: a.includes('--zip') });
}
