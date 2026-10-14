// ITEM-09 tests: requirement formula, meetsReq, card hint, -50 % rule, 2000-kit reachability. Run: node game/js/quest/sim/statsReq.test.js
import { reqValue, meetsReq, reqMul, reqHint, itemReqValue, rollAffix, createStatsRng } from './stats.js';
import { REQ_UNIQUE_MAX } from './statsConfig.js';

let bad = 0; const chk = (n, c, x = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${n} ${x}`); if (!c) bad++; };
const T = (str, dex, int) => ({ str, dex, int });

const table = []; for (let i = 1; i <= 10; i++) table.push(reqValue(i));
chk('req(iL) table', table.join() === '5,5,6,7,8,9,10,11,12,13', table.join());
chk('iL1-2 always met at base 5', meetsReq(T(5, 5, 5), { type: 'sword', iL: 2 }));
chk('sword/axe/spear STR, bow DEX, fireball/staff INT',
  !meetsReq(T(5, 20, 20), { type: 'axe', iL: 5 }) && !meetsReq(T(20, 5, 20), { type: 'bow', iL: 5 }) && !meetsReq(T(20, 20, 5), { type: 'staff', iL: 5 }) && meetsReq(T(8, 5, 5), { type: 'spear', iL: 5 }));
chk('armour/shield/cloak/belt/boots: none', ['armour', 'shield', 'cloak', 'belt', 'boots'].every((t) => meetsReq(T(0, 0, 0), { type: t, iL: 10 })));
chk('Steel Bow iL9 needs DEX 12', reqHint(T(5, 11, 5), { type: 'bow', iL: 9 }).text === 'Needs DEX 12' && !reqHint(T(5, 11, 5), { type: 'bow', iL: 9 }).met && reqHint(T(5, 12, 5), { type: 'bow', iL: 9 }).met);
chk('no hint without requirement', reqHint(T(5, 5, 5), { type: 'shield', iL: 5 }) === null);
chk('unmet = -50 %, met = full (live)', reqMul(T(5, 5, 5), { type: 'sword', iL: 5 }) === 0.5 && reqMul(T(8, 5, 5), { type: 'sword', iL: 5 }) === 1);
chk('unique hand-set, capped at 13', itemReqValue({ type: 'sword', iL: 10, req: { str: 11 } }) === 11 && itemReqValue({ type: 'sword', iL: 10, req: { str: 40 } }) === REQ_UNIQUE_MAX);
chk('legacy item without req/type loads', meetsReq(T(5, 5, 5), { id: 'old' }) && meetsReq(T(5, 5, 5), null));

// Reachability: nine Magic slots of iL n-1, each one random A8-A10 line; player picks the best attribute.
for (let n = 3; n <= 10; n++) {
  const rng = createStatsRng(9000 + n); let ok = 0;
  for (let k = 0; k < 2000; k++) {
    const s = [5, 5, 5];
    for (let sl = 0; sl < 9; sl++) s[Math.floor(rng() * 3)] += rollAffix('A8', n - 1, rng);
    if (Math.max(s[0], s[1], s[2]) >= reqValue(n)) ok++;
  }
  chk(`reachable iL${n} (req ${reqValue(n)})`, ok / 2000 >= 0.9, `${(ok / 20).toFixed(1)} %`);
}
if (bad) process.exitCode = 1;
