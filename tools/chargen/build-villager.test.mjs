// build-villager arg parsing.  node tools/chargen/build-villager.test.mjs
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
console.log(fail ? fail + ' fail' : 'ALL PASS');
process.exit(fail ? 1 : 0);
