// GI-SHIP-01 (D-107): baked content/gi/*.gi.bin ships in git; fail when a zone's file is missing or stale vs the current inputs.
// Fix: node tools/bake-gi.mjs (about 90 s for world_m1) and commit the .gi.bin files + manifest.json.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkGIDir, zonesOf, inputHash, WORLD_FILE } from './bake-gi.mjs';

const root = new URL('../', import.meta.url);
const def = JSON.parse(fs.readFileSync(new URL('content/' + WORLD_FILE, root), 'utf8'));
const r = checkGIDir(fileURLToPath(new URL('content/gi', root)), zonesOf(def), inputHash(fileURLToPath(root)));
const bad = r.filter((x) => x.status !== 'ok');
for (const x of r) console.log(`${x.status === 'ok' ? 'ok  ' : 'FAIL'} ${x.id}: ${x.status}`);
if (bad.length) { console.error(`GI bake out of date for ${bad.map((x) => x.id).join(', ')}: run node tools/bake-gi.mjs and commit content/gi/`); process.exit(1); }
