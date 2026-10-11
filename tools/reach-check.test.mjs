// Every quest area centre / pickup / giver must be inside the world walk bounds (tools/reach-check.mjs).
import { staticReach } from './reach-check.mjs';
const r = staticReach();
if (r.bad.length) { console.error('FAIL unreachable: ' + r.bad.map((b) => `${b.kind} ${b.id} (${b.x},${b.y})`).join('; ')); process.exit(1); }
if (r.points.length < 30) { console.error('FAIL only ' + r.points.length + ' points checked'); process.exit(1); }
// a point far outside must be flagged
const w = JSON.parse((await import('node:fs')).readFileSync(new URL('../content/worlds/world_m1.world.json', import.meta.url), 'utf8'));
const t = staticReach(w, { far: { world: 'world_m1', trigger: 'wallowOld' } });
if (t.bad.length !== 1) { console.error('FAIL missing trigger not flagged'); process.exit(1); }
console.log('reach-check: ' + r.points.length + ' points inside the walk bounds');
