// engine/render/teamRemap.test.js (RE-06, docs/architecture.md 28.6 "Node tests" 4).
// Run: node engine/render/teamRemap.test.js
import { buildTeamRemap, remapTeamMat, TEAM_SLOTS, MAX_TEAMS } from './teamRemap.js';
import { bindShading } from './MaterialTable.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import { makeOk } from '../test/assert.js';

globalThis.window = globalThis.window || globalThis;
paletteMod; detailPassMod;

let pass = 0, fail = 0;
const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const P = globalThis.ASSETS.palette;
const DP = globalThis.ASSETS.detailPass;
const keys = Object.keys(P.materials).filter((k) => P.materials[k].kind !== 'sky');
// Placeholder materials until the designer adds `team.*` palette entries: any real keys will do.
const [kSlotA, kSlotB, kRed, kBlue, kGreen] = keys;
const spec = {
  slots: [kSlotA, kSlotB],
  teams: [null, { [kSlotA]: kRed, [kSlotB]: kBlue }, { [kSlotA]: kGreen }],
};

const table = bindShading(P, DP, 1);
ok('bindShading gives every table an identity `team` (zero slots)', table.team && table.team.slotIds.length === TEAM_SLOTS && table.team.mat.length === MAX_TEAMS * TEAM_SLOTS && table.team.slotIds.every((v) => v === 0));
ok('table.hasKey knows palette keys and rejects typos', table.hasKey(kSlotA) === true && table.hasKey('no.such.material') === false);

const r = buildTeamRemap(table, spec);
const idA = table.idFor(kSlotA), idB = table.idFor(kSlotB);
ok('slotIds resolved through the table', r.slotIds[0] === idA && r.slotIds[1] === idB && r.slotIds[2] === 0 && r.slotIds[3] === 0);
ok('team 0 = identity for every slot', [0, 1, 2, 3].every((s) => r.mat[s] === r.slotIds[s]));
ok('team 1 maps both slots', r.mat[1 * 4 + 0] === table.idFor(kRed) && r.mat[1 * 4 + 1] === table.idFor(kBlue));
ok('team 2 maps slot a, unlisted slot b stays identity', r.mat[2 * 4 + 0] === table.idFor(kGreen) && r.mat[2 * 4 + 1] === idB);
ok('teams beyond the spec (3..7) are identity', [3, 4, 5, 6, 7].every((t) => r.mat[t * 4] === idA && r.mat[t * 4 + 1] === idB));

ok('remapTeamMat: team 0 / non-slot / unresolved (0) materials unchanged',
  remapTeamMat(r, 0, idA) === idA && remapTeamMat(r, 1, table.idFor(kRed)) === table.idFor(kRed) && remapTeamMat(r, 1, 0) === 0);
ok('remapTeamMat: slot materials remapped per team', remapTeamMat(r, 1, idA) === table.idFor(kRed) && remapTeamMat(r, 1, idB) === table.idFor(kBlue) && remapTeamMat(r, 2, idA) === table.idFor(kGreen) && remapTeamMat(r, 2, idB) === idB);

let threw = 0;
try { buildTeamRemap(table, { slots: ['no.such.material'], teams: [] }); } catch (e) { threw++; }
try { buildTeamRemap(table, { slots: [kSlotA], teams: [null, { [kSlotA]: 'no.such.material' }] }); } catch (e) { threw++; }
try { buildTeamRemap(table, { slots: [kSlotA], teams: [null, { [kSlotB]: kRed }] }); } catch (e) { threw++; }
try { buildTeamRemap(table, { slots: [kSlotA, kSlotA, kSlotA, kSlotA, kSlotA], teams: [] }); } catch (e) { threw++; }
try { buildTeamRemap(table, { slots: [kSlotA], teams: new Array(9).fill(null) }); } catch (e) { threw++; }
ok('unknown key / unlisted slot / too many slots / too many teams all throw', threw === 5, String(threw));
ok('a null spec builds the empty remap', buildTeamRemap(table, null).slotIds.every((v) => v === 0));

// Rebuild after bindShading: a fresh table starts identity; re-applying the spec on it restores the remap.
const table2 = bindShading(P, DP, 1);
ok('a re-bound table starts identity (the engine re-applies its stored spec via attachMaterialTable)', table2.team.slotIds.every((v) => v === 0));
table2.team = buildTeamRemap(table2, spec);
ok('re-applying the spec on the new table gives the same remap', table2.team.slotIds[0] === table2.idFor(kSlotA) && table2.team.mat[4] === table2.idFor(kRed));

console.log(`${pass} passed, ${fail} failed.`);
if (fail) { failures.forEach((f) => console.error('FAIL:', f)); process.exit(1); }
console.log('ALL PASS');
