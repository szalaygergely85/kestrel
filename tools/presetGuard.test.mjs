// PERF-LOWPRESET-GUARD-01: fails when gfx-presets.json drifts from the measured perf budget
// (docs/test-reports/perf-2026-10-15-presets.json). Pure Node, no GPU.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { HIDDEN_QUALITIES } from '../game/js/ui/gfxPresets.js';

const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const CAO_KEYS = ['cao', 'contactAo'];
const POST_KEYS = ['post', 'postGrade'];
const on = (v) => v != null && v !== false && v !== 0 && v !== 'off' && !(typeof v === 'object' && v.on === false);

export function keySetHash(presets) {
  const lines = Object.keys(presets).sort().map((n) => n + ':' + Object.keys(presets[n]).sort().join(','));
  return crypto.createHash('sha1').update(lines.join('|')).digest('hex').slice(0, 12);
}

// Returns a list of plain-language failures.
export function checkPresets(presets, budget, hiddenList) {
  const bad = [];
  const fix = ' -> either revert the preset change or re-measure and update docs/test-reports/perf-2026-10-15-presets.json (+ the .md table).';
  if (!hiddenList.includes('extreme')) bad.push(`preset "extreme": HIDDEN_QUALITIES in game/js/ui/gfxPresets.js lacks 'extreme' (must stay URL-only, D-107)${fix}`);
  for (const [name, p] of Object.entries(presets)) {
    if (budget.noShafts.includes(name) && (p.shaftSteps || 0) > 0) bad.push(`preset "${name}" key "shaftSteps"=${p.shaftSteps}: light shafts must be off at ${name}${fix}`);
    for (const k of CAO_KEYS) if (budget.noCaoPost.includes(name) && on(p[k])) bad.push(`preset "${name}" key "${k}": contact AO must be off at ${name}${fix}`);
    for (const k of POST_KEYS) if (budget.noCaoPost.includes(name) && on(p[k])) bad.push(`preset "${name}" key "${k}": post grade must be off at ${name}${fix}`);
    if (budget.occlOff.includes(name) && on(p.occl)) bad.push(`preset "${name}" key "occl"=${JSON.stringify(p.occl)}: measured table has occlusion off${fix}`);
  }
  const h = keySetHash(presets);
  if (h !== budget.keySetHash) bad.push(`preset key set changed (hash ${h}, sidecar ${budget.keySetHash}): a preset or key was added/removed; re-measure and update keySetHash in perf-2026-10-15-presets.json`);
  return bad;
}

const presets = read('content/settings/gfx-presets.json').presets;
const budget = read('docs/test-reports/perf-2026-10-15-presets.json');
const real = checkPresets(presets, budget, HIDDEN_QUALITIES);
assert.deepEqual(real, [], '\n' + real.join('\n'));

// Fixtures: one hand-broken in-memory copy per rule.
const clone = () => JSON.parse(JSON.stringify(presets));
const cases = {
  hidden: () => checkPresets(clone(), budget, []),
  shafts: () => { const c = clone(); c.medium.shaftSteps = 4; return checkPresets(c, budget, HIDDEN_QUALITIES); },
  cao: () => { const c = clone(); c.low.cao = true; return checkPresets(c, budget, HIDDEN_QUALITIES); },
  post: () => { const c = clone(); c.low.post = { on: true }; return checkPresets(c, budget, HIDDEN_QUALITIES); },
  occl: () => { const c = clone(); c.high.occl = { on: true }; return checkPresets(c, budget, HIDDEN_QUALITIES); },
  keyAdded: () => { const c = clone(); c.low.newKey = 1; return checkPresets(c, budget, HIDDEN_QUALITIES); },
  keyRemoved: () => { const c = clone(); delete c.ultra.decorDensity; return checkPresets(c, budget, HIDDEN_QUALITIES); },
  presetAdded: () => { const c = clone(); c.insane = c.extreme; return checkPresets(c, budget, HIDDEN_QUALITIES); },
};
for (const [n, f] of Object.entries(cases)) assert.ok(f().length >= 1, `fixture "${n}" should fail the guard`);
console.log('presetGuard ok (' + Object.keys(cases).length + ' fixtures)');
