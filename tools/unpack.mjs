#!/usr/bin/env node
// KPKG-03: extract a `.kestrel` package (reverse of tools/pack.mjs).
//   node tools/unpack.mjs <file.kestrel> [outDir]     (default outDir = <file without extension>)
// The result holds kestrel.json + the tree and can be re-packed with `node tools/pack.mjs <outDir>`.
// readZip rejects zip-slip paths; the startsWith check below is a second guard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPackage } from '../engine/index.js';

/** @returns {Promise<string[]>} the zip paths written */
export async function unpackBytes(bytes, outDir) {
  const pkg = await openPackage(bytes);
  const root = path.resolve(outDir);
  for (const p of pkg.paths) {
    const dest = path.resolve(root, p);
    if (!dest.startsWith(root + path.sep)) throw new Error(`unsafe path ${p}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, await pkg.readBytes(p));
  }
  return [...pkg.paths];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, out] = process.argv.slice(2);
  if (!file) { console.error('usage: node tools/unpack.mjs <file.kestrel> [outDir]'); process.exit(2); }
  const dir = out || file.replace(/\.[^.\\/]+$/, '');
  try {
    const n = (await unpackBytes(new Uint8Array(fs.readFileSync(file)), dir)).length;
    console.log(`${n} files -> ${dir}`);
  } catch (e) { console.error(`unpack ${file}: ${e.message}`); process.exit(1); }
}
