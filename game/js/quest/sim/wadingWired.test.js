// RIVER-04: wading is wired around the player's integrate in main.js, World#riverAt replaces the engine-internal reads, vitals honours wadeRescue.
import fs from 'node:fs';
import { World, createWater, collectWaterDefs } from '../../../../engine/index.js';
let fails = 0; const ok = (n, c, d) => { if (!c) { fails++; console.log('FAIL', n, d ?? ''); } };
const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const iB = main.indexOf('wading.before('), iI = main.indexOf('integrate(playerHandle.data, dt, controls'), iA = main.indexOf('wading.after(');
ok('main.js: wading.before < integrate < wading.after', iB > 0 && iB < iI && iI < iA, [iB, iI, iA]);
ok('main.js: wading built per world', /wading = createWading\(world\)/.test(main));
const wsrc = fs.readFileSync(new URL('./wading.js', import.meta.url), 'utf8');
ok('wading.js reads no engine internals (rv.loc / L_*)', !/\.loc\b|L_LAT|L_TX|L_TY|world.water[.[]/.test(wsrc.replace(/\/\/.*$/gm, '')));
const vsrc = fs.readFileSync(new URL('./vitals.js', import.meta.url), 'utf8');
ok('vitals: wadeRescue teleports back, void rule skipped while wading', /wadeRescue/.test(vsrc) && /wadeImm > 0/.test(vsrc));
const w = new World();
w.water = createWater(collectWaterDefs({ water: [{ id: 'r', shape: 'river', path: [[0, 0, 10, 20, 1], [60, 0, 10, 20, 1], [120, 0, 10, 20, 1]] }, { id: 'p', shape: 'rect', rect: [200, 0, 220, 20], z: 5 }] }, []));
const o = { lat: 0, hw: 0, tx: 0, ty: 0, v: 0, z: 0 };
ok('riverAt: inside', w.riverAt(50, 5, o) && Math.abs(o.lat - 5) < 1e-6 && o.hw === 20 && Math.abs(o.tx - 1) < 1e-9 && o.z === 10, JSON.stringify(o));
ok('riverAt: outside the channel / non-river region is false', !w.riverAt(50, 40, o) && !w.riverAt(210, 5, o));
console.log(`wadingWired: ${fails ? 'FAIL' : 'ok'}`); process.exit(fails ? 1 : 0);
