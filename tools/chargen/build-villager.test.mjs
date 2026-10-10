// build-villager arg parsing + the checked-in Fen package (CH1-08a).  node tools/chargen/build-villager.test.mjs
import fs from 'node:fs';
import { parseBuildArgs } from './buildArgs.mjs';
let fail = 0;
const ok = (n, c, d = '') => { if (!c) { fail++; console.log('FAIL ' + n + ' ' + d); } };
const A = (...a) => ['node', 'x.mjs', ...a];
ok('default = seed mode, seed 7', JSON.stringify(parseBuildArgs(A())) === '{"mode":"seed","seed":7}');
ok('--seed 3', parseBuildArgs(A('--seed', '3')).seed === 3);
const r = parseBuildArgs(A('--recipe', 'r.json', '--id', 'villager.fen', '--name', 'Fen'));
ok('recipe mode defaults', r.mode === 'recipe' && r.assetId === 'fen' && r.out === 'content/packages/villager.fen-1.0.0.kestrel' && r.name === 'Fen');
ok('--out override', parseBuildArgs(A('--recipe', 'r.json', '--id', 'a.b', '--name', 'N', '--out', 'o.kestrel')).out === 'o.kestrel');
for (const bad of [A('--recipe', 'r.json'), A('--recipe', 'r.json', '--id', 'X Y', '--name', 'n')]) {
  let threw = false; try { parseBuildArgs(bad); } catch { threw = true; }
  ok('bad recipe args throw', threw);
}
const root = new URL('../../content/packages/', import.meta.url);
const idx = JSON.parse(fs.readFileSync(new URL('index.json', root), 'utf8'));
ok('index lists the Fen package', idx.packages.includes('villager.fen-1.0.0.kestrel'));
const bytes = fs.readFileSync(new URL('villager.fen-1.0.0.kestrel', root));
ok('Fen package is a zip containing kestrel.json + fen.glb', bytes[0] === 0x50 && bytes[1] === 0x4b && bytes.includes(Buffer.from('fen.glb')) && bytes.includes(Buffer.from('kestrel.json')));
console.log(fail ? fail + ' fail' : 'ALL PASS');
process.exit(fail ? 1 : 0);
