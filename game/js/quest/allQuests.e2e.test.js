// QUEST-E2E-ALL (OWNER PRIORITY 1, D-108/OB-156): one end-to-end check for EVERY quest id in the real content.
//   node game/js/quest/allQuests.e2e.test.js            (exit 1 while any quest breaks the rule)
//   node game/js/quest/allQuests.e2e.test.js --report   (only prints the table, exit 0; also env QUEST_E2E_REPORT=1)
// The rule: '!' over a CHARACTER (gold main / blue side) -> talk -> Accept/Exit -> objectives -> '?' same colour over a CHARACTER
// -> hand-in talk -> reward once -> both marks gone -> `next` offered, never auto-accepted (D-105). No exemption lists: a quest that
// breaks the rule fails with the first failing step. Quests are generated from content/quests (index.json legacy + packs).
// ED-QUI-07b1 (38.85): the step chain lives in questE2eRun.js (pure, shared with tools/quest-sim.mjs --quest and the editor SIM);
// tools/quest-e2e-content.mjs loads the content bundle from disk. This file walks every quest on ONE shared run and prints the table.
import assert from 'node:assert/strict';
import { createQuestE2e } from './questE2eRun.js';
import { loadQuestE2eBundle } from '../../../tools/quest-e2e-content.mjs';

const REPORT = process.argv.includes('--report') || process.env.QUEST_E2E_REPORT === '1';
const T0 = Date.now();

const bundle = await loadQuestE2eBundle();
const h = await createQuestE2e(bundle);
const { m1, defs, results } = h;
const loadedIds = new Set([m1.id, ...defs.map((d) => d.id)]);

// ---------------------------------------------------------------- run everything
const rows = [];
for (const def of defs) { const r = h.runQuest(def); rows.push({ id: def.id, ok: r.ok, step: r.step, msg: r.msg }); }
// m1: every section of the opening chain must END in a hand-in (a quest:<id>:done flag = a giver quest handed in at a character); a waypoint ending is a bug (OB-181/182)
h.advanceM1(m1.objectives[m1.objectives.length - 1].id);
{
  const secs = new Map();
  for (const o of m1.objectives) { const k = o.section || o.id; if (!secs.has(k)) secs.set(k, []); secs.get(k).push(o); }
  for (const [sid, list] of secs) {
    const last = list[list.length - 1], w = last.when, dep = w.type === 'flag' && /^quest\.(.+)\.done$/.exec(w.id);
    const owner = dep && defs.find((d) => d.id === dep[1]);
    if (!owner) rows.push({ id: 'm1:' + sid, ok: false, step: '6 mark-ready', msg: "chain section '" + sid + "' ends on '" + last.id + "' (" + w.type + ' ' + w.id + ') with no hand-in: completes at a waypoint, no "?" over a character' });
    else rows.push({ id: 'm1:' + sid, ok: results.get(owner.id) && results.get(owner.id).ok, step: results.get(owner.id) ? results.get(owner.id).step : '?', msg: 'hand-in via ' + owner.id });
  }
}
for (const id of bundle.onDiskIds) if (!loadedIds.has(id)) rows.push({ id, ok: false, step: '0 loaded', msg: 'quest file on disk is not loaded (index.json legacy/packs)' });

// Main chain has no dead end (QL-MAIN-01): every main quest has `next`, or a later quest requires it, or it is the one declared chain end.
{
  const reqd = new Set(defs.flatMap((d) => (d.requires || []).map((r) => r.quest)));
  const ends = defs.filter((d) => d.main && !d.next && !reqd.has(d.id));
  for (const d of ends) if (!d.chainEnd) rows.push({ id: 'chain:' + d.id, ok: false, step: '8 dead-end', msg: 'main quest ' + d.id + ' has no next and nothing requires it (declare chainEnd or add a next)' });
  const declared = defs.filter((d) => d.chainEnd);
  if (declared.length !== 1) rows.push({ id: 'chain:end', ok: false, step: '8 dead-end', msg: 'expected exactly 1 declared chainEnd, got ' + declared.length });
}
// ---------------------------------------------------------------- report
const bad = rows.filter((r) => !r.ok), good = rows.filter((r) => r.ok);
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
for (const r of rows) console.log((r.ok ? 'PASS ' : 'FAIL ') + pad(r.id, 34) + (r.ok ? '' : ' | ' + r.step + ' | ' + String(r.msg).slice(0, 170)));
const bySteps = {}; for (const r of bad) bySteps[r.step] = (bySteps[r.step] || 0) + 1;
console.log('\nQUEST-E2E-ALL summary: ' + rows.length + ' quests (' + defs.length + ' giver + m1 sections), ' + good.length + ' passing, ' + bad.length + ' failing, ' + (Date.now() - T0) + ' ms');
console.log('failing by first failing step: ' + (Object.entries(bySteps).sort().map(([k, v]) => k + '=' + v).join(', ') || 'none'));
if (!REPORT) {
  assert.equal(bad.length, 0, bad.length + ' of ' + rows.length + ' quests break the rule (first failing steps above; QUEST-HANDIN-ALL fixes them)');
  console.log('allQuests.e2e ok');
}
