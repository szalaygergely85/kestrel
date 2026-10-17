// node tools/export/png.test.mjs - CHARGEN-06: PNG writer round-trips through tools/png-read.mjs, deterministic.
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { encodePng, paletteTexture, texelUv, crc32, zlibStored } from './png.js';
import { readPng } from '../png-read.mjs';
import { makeOk } from '../../engine/test/assert.js';

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const cols = [[255, 0, 0], [0, 255, 0], [12, 34, 56], [200, 201, 202]];
const tex = paletteTexture(cols);
const img = readPng(Buffer.from(tex.png));
ok('palette png is 16x16', img.width === 16 && img.height === 16);
let same = true;
cols.forEach((c, i) => { for (let k = 0; k < 3; k++) if (img.data[4 * i + k] !== c[k]) same = false; if (img.data[4 * i + 3] !== 255) same = false; });
ok('palette texels decode exactly (alpha 255)', same);
ok('unused texels are transparent black', img.data[4 * 4 + 3] === 0 && img.data[4 * 255 + 3] === 0);
ok('deterministic bytes', createHash('sha256').update(paletteTexture(cols).png).digest('hex') === createHash('sha256').update(tex.png).digest('hex'));
// big image: more than one stored block (65535) round-trips
const w = 200, h = 150, rgba = new Uint8Array(4 * w * h);
for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7 + (i >> 8)) & 255;
const big = readPng(Buffer.from(encodePng(w, h, rgba)));
ok('multi-block png round-trips', big.width === w && big.height === h && Buffer.compare(Buffer.from(big.data), Buffer.from(rgba)) === 0);
ok('crc32 / zlibStored agree with node zlib', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926 && zlib.inflateSync(Buffer.from(zlibStored(new Uint8Array(70000).fill(9)))).length === 70000);
ok('empty zlib stream', zlib.inflateSync(Buffer.from(zlibStored(new Uint8Array(0)))).length === 0);
const uv = texelUv(17);
ok('texel uv = texel centre', uv[0] === 1.5 / 16 && uv[1] === 1.5 / 16);
let threw = false; try { paletteTexture(Array(257).fill([0, 0, 0])); } catch { threw = true; }
ok('257 colours throws', threw);
threw = false; try { encodePng(2, 2, new Uint8Array(3)); } catch { threw = true; }
ok('bad rgba length throws', threw);

console.log(`png export test: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
