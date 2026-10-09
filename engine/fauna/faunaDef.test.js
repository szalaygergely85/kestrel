// Run: node engine/fauna/faunaDef.test.js
import { compileFaunaDef } from './faunaDef.js';
import { FIXTURE_FX, fixtureModels } from './wildlifeFx.fixture.js';

let fail = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const clone = () => JSON.parse(JSON.stringify(FIXTURE_FX));
const throwsMsg = (fn, ...parts) => { try { fn(); return false; } catch (e) { return parts.every((p) => e.message.includes(p)); } };
const models = fixtureModels();

const def = compileFaunaDef(FIXTURE_FX, models);
ok(def.species.length === 2 && def.species[0].name === 'rabbit' && def.species[1].name === 'deer', 'two species in order');
const r = def.species[0], d = def.species[1];
ok(r.clipFor.move === 2 && r.clipFor.flee === 3 && r.enter.alert === 5 && r.once[5] === 4, 'rabbit clip indices resolved');
ok(r.gaits[1].clip === 3 && d.gaits[2].clip === 4 && d.extra.trot === 3, 'gait/extra clip indices');
ok(r.habitatMask === 3 && r.cellChance === 0.35 && r.spawnMinM === 35, 'spawn defaults (habitats, chance, min)');
ok(r.spawnMaxM === 60 && r.despawnM === 75 && r.drawM === 35 && r.cap === 10 && r.kind === 'ground', 'rabbit name defaults');
ok(d.spawnMaxM === 120 && d.despawnM === 150 && d.drawM === 90 && d.cap === 8, 'deer name defaults');
ok(d.models.length === 2 && d.buckChance === 0.3 && r.groupSize[1] === 3, 'models, buck, group');

// the object form of `models` works too
ok(compileFaunaDef(FIXTURE_FX, { rabbit: models('rabbit'), deer: models('deer'), deerBuck: models('deerBuck') }).species.length === 2, 'object resolver');

// missing clip names species + clip
const badModels = (n) => (n === 'rabbit' ? { clipIndex: { idle: 0, graze: 1, hop: 2, alert: 4, sitUp: 5 } } : models(n)); // no "run"
ok(throwsMsg(() => compileFaunaDef(FIXTURE_FX, badModels), 'rabbit', 'run'), 'missing clip throws naming species + clip');
ok(throwsMsg(() => compileFaunaDef(FIXTURE_FX, () => undefined), 'rabbit', 'rabbit'), 'missing model throws');

// dist order
let a = clone(); a.animals.deer.dist.alert = 40; // alert > notice
ok(throwsMsg(() => compileFaunaDef(a, models), 'deer', 'flee < alert < notice < safe'), 'dist order enforced');
a = clone(); a.animals.rabbit.dist.fleeIfRunning = 2;
ok(throwsMsg(() => compileFaunaDef(a, models), 'rabbit', 'fleeIfRunning'), 'fleeIfRunning >= flee');
// gait gap
a = clone(); a.animals.deer.gaits[1].minMps = 2.0;
ok(throwsMsg(() => compileFaunaDef(a, models), 'deer', 'gap'), 'gait gap rejected');
// spawn block
a = clone(); a.animals.rabbit.spawn = { habitats: ['meadow', 'swamp'] };
ok(throwsMsg(() => compileFaunaDef(a, models), 'rabbit', 'swamp'), 'unknown habitat');
a = clone(); a.animals.rabbit.spawn = { spawnMinM: 80 };
ok(throwsMsg(() => compileFaunaDef(a, models), 'rabbit', 'spawnMinM'), 'min >= max');
a = clone(); a.animals.rabbit.spawn = { habitats: ['forest', 'edge'], cap: 4, cellChance: 0.9, kind: 'ground' };
const c4 = compileFaunaDef(a, models).species[0];
ok(c4.habitatMask === 6 && c4.cap === 4 && c4.cellChance === 0.9, 'spawn overrides');
// unknown keys warn once
const warns = [];
a = clone(); a.animals.rabbit.bogusKey = 1; a.animals.rabbit.spawn = { wat: 1 };
compileFaunaDef(a, models, { warn: (m) => warns.push(m) });
compileFaunaDef(a, models, { warn: (m) => warns.push(m) });
ok(warns.length === 2 && warns[0].includes('bogusKey') && warns[1].includes('wat'), 'unknown keys warn once each');

console.log(`faunaDef.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
