// CUR-05 COIN-01: rewards.coin per quest vs the band table (design/epics/currency.md section 2).
// Pure: coinLint(defs) -> [{rule, severity:'error'|'warn', quest, msg}]. Missing coin and out-of-band = warn; non-integer or outside 0..200 = error.
// CLI: node tools/coin-lint.mjs  (warnings only, exit 1 on errors).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BANDS = { errand: [5, 15], side: [15, 40], main: [20, 50], elite: [40, 100] };
export const COIN_MAX = 200;
export const bandOf = (d) => (BANDS[d.rewardBand] ? d.rewardBand : String(d.id).startsWith('mq.') ? 'main' : 'side');
const coinOf = (d) => (d.rewards && d.rewards.coin !== undefined ? d.rewards.coin : d.reward ? d.reward.coin : undefined);

export function coinLint(defs) {
  const out = [];
  for (const d of defs) {
    if (!d || !d.id || d.internal) continue; // internal trackers (m1) are not player quests
    const band = bandOf(d), [lo, hi] = BANDS[band], c = coinOf(d);
    if (c === undefined) { out.push({ rule: 'COIN-01', severity: 'warn', quest: d.id, msg: `no rewards.coin (band ${band} ${lo}-${hi})` }); continue; }
    if (!Number.isInteger(c) || c < 0 || c > COIN_MAX) { out.push({ rule: 'COIN-01', severity: 'error', quest: d.id, msg: `rewards.coin ${c} must be an integer 0..${COIN_MAX}` }); continue; }
    if (c < lo || c > hi) out.push({ rule: 'COIN-01', severity: 'warn', quest: d.id, msg: `rewards.coin ${c} outside band ${band} ${lo}-${hi}` });
  }
  return out;
}

export function loadQuestDefs(root) {
  const defs = [], walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.quest.json')) defs.push(JSON.parse(fs.readFileSync(p, 'utf8')));
      else if (e.name === 'pack.json') defs.push(...(JSON.parse(fs.readFileSync(p, 'utf8')).quests || []));
    }
  };
  walk(root); return defs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hits = coinLint(loadQuestDefs(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'quests')));
  for (const h of hits) console.log(`${h.severity.toUpperCase()} ${h.rule} ${h.quest}: ${h.msg}`);
  const errs = hits.filter((h) => h.severity === 'error').length;
  console.log(`coin-lint: ${errs} error(s), ${hits.length - errs} warning(s)`);
  process.exit(errs ? 1 : 0);
}
