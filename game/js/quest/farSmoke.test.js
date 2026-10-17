// game/js/quest/farSmoke.test.js (OB-020). Run: node game/js/quest/farSmoke.test.js
// The far "smoke means people" plumes: preset farSmoke validates + defines, stays cheap, and the 3 anchors carry it.
import fs from 'node:fs';
import { createParticles } from '../../../engine/index.js';
import particlesMod from '../../../design/models/particles.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';
import paletteMod from '../../../design/palette.js';

paletteMod; particlesMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
const PS = globalThis.ASSETS.particles;

const def = PS.toEmitterDef('farSmoke', assets.palette.rgb);
const p = createParticles();
let threw = null;
try { p.defineEmitter('farSmoke', def); } catch (e) { threw = e; }
ok('farSmoke defineEmitter ok', threw === null, threw && threw.message);
ok('plume billows (sizeM 0.8..2 -> sizeEndM 3..12, VISQA-23 thinner, maxLive <= 64, rate <= 8)', def.sizeM >= 0.8 && def.sizeM <= 2 && def.sizeEndM >= 3 && def.sizeEndM <= 12 && def.maxLive <= 64 && def.rate <= 8);
ok('plume drifts with the wind and rises', def.wind === 1 && def.accelZ > 0);

const world = JSON.parse(fs.readFileSync('content/worlds/world_m1.world.json', 'utf8'));
const ents = world.entities || [];
for (const id of ['smoke1', 'smoke2', 'smoke3']) {
  const e = ents.find((x) => x.id === id);
  const em = e && e.components && e.components.emitters;
  ok(`${id} carries a farSmoke emitter`, Array.isArray(em) && em.length === 1 && em[0].preset === 'farSmoke' && em[0].on === true, JSON.stringify(e));
}

console.log(`farSmoke: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
