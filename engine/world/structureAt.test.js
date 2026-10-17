// SIM-PERF: structureAt (flat bbox scan) must equal the plain linear bbox scan over the grid structures of the real world_m1.
globalThis.window = globalThis;
import '../../design/levels/overworld_far.js';
import '../../design/levels/world_geo.js';
import '../../design/palette.js';
import '../../design/detail-pass.js';
import '../../design/levels/world_geo.js';
import '../../design/models/lantern.js';
import '../../design/models/lever.js';
import '../../design/models/voxel_props.js';
import '../../design/models/boulder.js';
import '../../design/models/rubble.js';
import '../../design/models/wreckage.js';
import '../../design/models/relay.js';
import '../../design/models/sword.js';
import '../../design/models/m3_props.js';
import '../../design/models/far_tower.js';
import '../../design/models/ferrum_lights.js';
import '../../design/models/title.js';
import '../../design/models/voxel_world.js';
import { World } from '../index.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
const { assets } = await loadTestAssets();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const gs = w.structures.filter((s) => s.kind !== 'mesh');
let bad = 0, hits = 0, n = 0;
const ref = (x, y) => { for (const s of gs) { const b = s.bbox; if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return s; } return null; };
const pts = [];
for (const s of gs) { const b = s.bbox; for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y1], [b.x1 - 1e-6, b.y1 - 1e-6], [b.x0 - 1e-6, b.y0], [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]]) pts.push([x, y]); }
for (let i = 0; i < 20000; i++) pts.push([(i * 7919) % 2000, (i * 104729) % 2000]);
for (const [x, y] of pts) { n++; const a = w.structureAt(x, y), r = ref(x, y); if (a !== r) bad++; if (r) hits++; }
console.log(`structureAt: ${gs.length} grid structures, ${n} points, ${hits} hits, ${bad} mismatches`);
if (bad || !hits) { console.log('FAIL'); process.exit(1); }
console.log('PASS'); process.exit(0);
