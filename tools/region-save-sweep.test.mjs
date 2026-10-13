// WMP-09: region save/load sweep (6 regions) in Node; see tools/region-save-sweep.mjs.
import { runSweep } from './region-save-sweep.mjs';
const r = await runSweep();
for (const f of r.fails) console.log('FAIL ' + f);
console.log(`region-save-sweep.test: ${r.rows.length} regions, ${r.fails.length} failures`);
if (r.fails.length || r.rows.length !== 6) process.exit(1);
