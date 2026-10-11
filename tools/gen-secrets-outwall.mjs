// US-104b (M5 sprint 4): three hidden chests along the Outwall track (ford west bank -> owPathPost -> owGate), built on the US-104a generator (buildSecrets with a cfg).
// Same rules: 8..25 m from the track, >= 8 m from every route-walk line (incl. leg 10o), >= 3 m from other placements, on plain ground, flat, terrain LOS from the nearest
// track point, 1 m grid path from it, inside the walk bounds. Table OUTWALL_SECRET_TABLE (chestDefs.js): 4 arrows + 8 % gear roll forced to T3 = 'fine' (US-129a band 5).
// Writes entities secretOw1..3 into content/worlds/world_m1.world.json (in place of the old ones; US-104a chests stay byte-identical). Deterministic.
// Usage: node tools/gen-secrets-outwall.mjs [--seed N] [--dry-run] [--json]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringifyContent } from '../engine/index.js';
import { buildSecrets, LINES } from './gen-secrets-ch12.mjs';

const argv = process.argv.slice(2);
const argN = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? Number(argv[i + 1]) : d; };
const SEED = argN('--seed', 20261013), FILE = 'content/worlds/world_m1.world.json';
export const OW_IDS = ['secretOw1', 'secretOw2', 'secretOw3'];
// the Outwall track (leg 10o inward waypoints, from owPathPost to the gate gap)
export const OW_PATH = [[1000, 1066], [985, 1040], [978, 1010], [966, 985], [956, 962], [954, 940], [950, 927], [944, 925.3]];
const OW_LINES = [ // leg 10o (tools/route-walk.mjs): inward track, round the palisade to the goose farm
  [[1010, 1066], [1010.5, 1049], [1011.5, 1041], [1013.5, 1035], [1004, 1031], [992, 1033], [988, 1038], [978, 1010], [966, 985], [956, 962], [954, 940], [950, 927], [944, 925.3], [935, 926.5], [920, 927], [905, 927], [903, 940], [905, 948], [910.5, 950.5]],
  [[905, 940], [905, 927], [935, 926.5], [946, 925.5], [952, 915], [930, 912], [890, 912], [865, 925], [852, 955], [855, 978], [874, 990], [862, 990]],
];
const OW_ZONES = [
  { id: 'secretOw1', c: [993, 1005], r: 14, note: 'east of the track, north of the post' },
  { id: 'secretOw2', c: [940, 985], r: 14, note: 'west of the track in the scrub, between the ford and the palisade' },
  { id: 'secretOw3', c: [978, 945], r: 12, note: 'east of the track below the palisade' },
];
export const OW_CFG = { ids: OW_IDS, zones: OW_ZONES, path: OW_PATH, lines: [...LINES, ...OW_LINES], tag: 'US-104b Outwall track hidden chest', table: 'OUTWALL_SECRET_TABLE' };
export const buildOutwallSecrets = (data, seed = SEED) => buildSecrets(data, seed, OW_CFG);

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const dry = argv.includes('--dry-run');
  const { data, log } = await buildOutwallSecrets(JSON.parse(fs.readFileSync(FILE, 'utf8')), SEED);
  console.log(argv.includes('--json') ? JSON.stringify(log) : log.map((l) => `${l.id} (${l.x}, ${l.y}) track ${l.roadDist} m @ ${l.roadPoint}`).join('\n'));
  if (!dry) { fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('wrote', FILE); }
}
