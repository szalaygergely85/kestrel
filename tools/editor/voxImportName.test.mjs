// tools/editor/voxImportName.test.mjs - OWN-REQ-011 ("Import .vox" button,
// PC-B QUEUE 4 filler item). Pure naming/dedup logic, no DOM - the one part
// of `doImportVox()`'s pipeline that had zero coverage (only reachable via a
// live browser click before this extraction).
import { deriveVoxModelName } from './voxImportName.js';

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}

const noKeys = () => false;

ok('plain filename: strips extension', deriveVoxModelName('lantern.vox', noKeys) === 'lantern');
ok('multi-dot filename: strips only the last extension', deriveVoxModelName('my.model.vox', noKeys) === 'my_model');
ok('spaces/punctuation become underscores', deriveVoxModelName('old bridge (v2).vox', noKeys) === 'old_bridge__v2_');
ok('leading digit gets a vox_ prefix', deriveVoxModelName('123_crate.vox', noKeys) === 'vox_123_crate');
ok('leading underscore gets a vox_ prefix (not a letter)', deriveVoxModelName('_prop.vox', noKeys) === 'vox__prop');
ok('empty/falsy filename falls back to vox_model', deriveVoxModelName('', noKeys) === 'vox_model');
ok('empty/falsy filename (undefined) falls back to vox_model', deriveVoxModelName(undefined, noKeys) === 'vox_model');
// A filename whose base is empty after stripping the extension (".vox") does
// NOT hit the `s || 'vox_model'` fallback: the empty base fails the
// starts-with-a-letter check first and gets a "vox_" prefix, which is
// already non-empty (that fallback line only ever fires for a falsy
// `filename` itself, handled earlier by `String(filename || 'vox_model')`).
ok('extension-only filename: empty base gets the vox_ prefix, not the vox_model fallback',
  deriveVoxModelName('.vox', noKeys) === 'vox_', `got ${deriveVoxModelName('.vox', noKeys)}`);

{
  // Dedup: first name taken, next free numeric suffix wins.
  const taken = new Set(['lantern', 'lantern_2', 'lantern_3']);
  const name = deriveVoxModelName('lantern.vox', (k) => taken.has(k));
  ok('dedup: first free numeric suffix', name === 'lantern_4', `got ${name}`);
}
{
  // Dedup starts checking at _2, not _1 or _0.
  const taken = new Set(['crate']);
  const name = deriveVoxModelName('crate.vox', (k) => taken.has(k));
  ok('dedup: starts at _2', name === 'crate_2', `got ${name}`);
}
{
  // hasKey is called with exactly the candidate strings, in order, stopping
  // at the first miss (no wasted probes).
  const calls = [];
  const hasKey = (k) => { calls.push(k); return k === 'lantern' || k === 'lantern_2'; };
  const name = deriveVoxModelName('lantern.vox', hasKey);
  ok('dedup: probes in order and stops at the first free key',
    name === 'lantern_3' && calls.join(',') === 'lantern,lantern_2,lantern_3', `got ${name}, calls=${calls.join(',')}`);
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
