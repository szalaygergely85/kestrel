// engine/core/behaviours.test.js (US-010). Headless Node ESM, no framework.
// Run: node engine/core/behaviours.test.js
// Covers `validateBehaviours` over a fake world shape (no game code, no
// content pack - the engine never knows the names, so these are made up).
import { registerBehaviour, unregisterBehaviour, getBehaviour, validateBehaviours, listBehaviours } from './behaviours.js';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ' - ' + detail : ''}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fakeWorld(defs) {
  return { structures: defs.map((def) => ({ level: { def } })) };
}

const def = {
  interactables: [
    { id: 'a', interact: 't.alpha' },
    { id: 'b', interact: 't.beta' },
    { id: 'noName', x: 1 }, // no `interact`: skipped, not a finding
  ],
  triggers: [
    { id: 'end', type: 'end', trigger: 't.end' },
    { id: 'hint', type: 'hint', trigger: 't.hint' },
    { id: 'dupe', type: 'end', trigger: 't.end' }, // duplicate name: reported once
  ],
};

// --- nothing registered: every referenced name, unique + sorted ------------
ok('nothing registered -> all names, unique, sorted',
  same(validateBehaviours(fakeWorld([def])), ['t.alpha', 't.beta', 't.end', 't.hint']),
  JSON.stringify(validateBehaviours(fakeWorld([def]))));

// --- registering removes names; unregistering brings one back ---------------
for (const n of ['t.alpha', 't.beta', 't.end', 't.hint']) registerBehaviour(n, () => false);
ok('all registered -> empty', same(validateBehaviours(fakeWorld([def])), []));
unregisterBehaviour('t.beta');
ok('one removed -> exactly that name', same(validateBehaviours(fakeWorld([def])), ['t.beta']));
registerBehaviour('t.beta', () => false);

// --- multiple structures are merged; defs without extension fields are fine --
const def2 = { interactables: [{ id: 'z', interact: 't.zeta' }] };
ok('two structures merged', same(validateBehaviours(fakeWorld([def, def2, {}])), ['t.zeta']));
ok('structure without def is tolerated', same(validateBehaviours({ structures: [{ level: {} }] }), []));
ok('empty/absent world is tolerated', same(validateBehaviours(null), []) && same(validateBehaviours({}), []));

// --- getBehaviour still behaves (unknown -> undefined, no throw) -------------
const origErr = console.error; let errs = 0; console.error = () => { errs++; };
ok('getBehaviour(unknown) -> undefined', getBehaviour('t.nope') === undefined);
getBehaviour('t.nope');
ok('unknown name is reported once', errs === 1, `errs=${errs}`);
console.error = origErr;
ok('getBehaviour(known) -> the function', typeof getBehaviour('t.alpha') === 'function');

for (const n of ['t.alpha', 't.beta', 't.end', 't.hint']) unregisterBehaviour(n);

// --- listBehaviours (US-069, 24.12 item 5): sorted, a copy ------------------
{
  ok('listBehaviours: empty registry -> []', same(listBehaviours(), []));
  registerBehaviour('z.last', () => {});
  registerBehaviour('a.first', () => {});
  registerBehaviour('m.mid', () => {});
  ok('listBehaviours: sorted', same(listBehaviours(), ['a.first', 'm.mid', 'z.last']), JSON.stringify(listBehaviours()));
  const copy = listBehaviours();
  copy.push('bogus');
  ok('listBehaviours: returns a COPY, not the live registry', same(listBehaviours(), ['a.first', 'm.mid', 'z.last']));
  unregisterBehaviour('z.last'); unregisterBehaviour('a.first'); unregisterBehaviour('m.mid');
  ok('listBehaviours: reflects unregistration', same(listBehaviours(), []));
}

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
