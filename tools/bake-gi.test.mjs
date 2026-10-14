// GI-PROBE-02b: bake-gi on a fixture zone. Run: node tools/bake-gi.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bakeZoneBytes, checkGIDir, zonesOf, inputHash } from './bake-gi.mjs';
import { readGIFile, readGIHeader } from '../engine/index.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('FAIL ' + n + ' ' + d); } };
const world = {
  groundAt: () => 0,
  raySegmentRay(s, o) { if (s[5] >= s[2]) return false; const t = -s[2] / (s[5] - s[2]); if (t > 1) return false; o.t = t; o.x = s[0]; o.y = s[1]; o.z = 0; return true; },
};
const zone = { id: 'gT_0', x0: 128, y0: 0, w: 4, h: 3 }, hash = inputHash(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));
const a = bakeZoneBytes(world, zone, hash), b = bakeZoneBytes(world, zone, hash);
ok('two runs identical bytes', Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
ok('header hash = input hash', readGIHeader(a).hash16 === hash.slice(0, 32));
const r = readGIFile(a);
ok('round trip zone meta', r.meta.zone === 'gT_0' && r.field.x0 === 128 && r.field.w === 4 && r.field.layers === 3);
ok('missing detected', checkGIDir(dir, [zone], hash)[0].status === 'missing');
fs.writeFileSync(path.join(dir, 'gT_0.gi.bin'), a);
ok('fresh detected', checkGIDir(dir, [zone], hash)[0].status === 'ok');
ok('stale detected (other hash)', checkGIDir(dir, [zone], 'ff'.repeat(32))[0].status === 'stale');
ok('input hash is deterministic', inputHash() === hash);
const zs = zonesOf(JSON.parse(fs.readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8')));
ok('world_m1 has 5 pinned zones of 80x48 columns', zs.length === 5 && zs.every((z) => z.w === 80 && z.h === 48), JSON.stringify(zs[0]));
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
console.log('ALL PASS');
