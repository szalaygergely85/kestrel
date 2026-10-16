// QL-MAIN-03 CH3-REGION-HANDINS: the 10 sq.reg.* region quests (content/quests/regions/pack.json) each walk the shared runner
// (questE2eRun.js runQuestE2e): offer -> accept -> objectives -> hand-in -> reward once -> marks gone. The runner's step chain
// asserts the OB-156 mark rule ('!' before accept, '?' after objectives, none after hand-in); here we require those steps by name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runQuestE2e } from './questE2eRun.js';
import { loadQuestE2eBundle } from '../../../tools/quest-e2e-content.mjs';

const ids = JSON.parse(readFileSync(new URL('../../../content/quests/regions/pack.json', import.meta.url), 'utf8')).quests.map((q) => q.id);
assert.equal(ids.length, 10, 'regions pack has 10 quests');
assert.ok(ids.every((i) => i.startsWith('sq.reg.')));
const bundle = await loadQuestE2eBundle();
const bad = [];
for (const id of ids) {
  const r = await runQuestE2e(bundle, id);
  const names = r.steps.map((s) => s.name).join(' | ');
  console.log((r.ok ? 'PASS ' : 'FAIL ') + id + (r.ok ? '' : ' first fail: ' + r.firstFail.name + ' - ' + String(r.firstFail.detail).slice(0, 160)));
  if (!r.ok) bad.push(id + ': ' + r.firstFail.name);
  else for (const re of [/mark/i, /hand/i, /reward/i]) if (!re.test(names)) bad.push(id + ': runner steps lack ' + re + ' (' + names + ')');
}
assert.equal(bad.length, 0, bad.length + ' problem(s): ' + bad.join('; '));
console.log('regionQuests.e2e ok: ' + ids.length + '/' + ids.length);
