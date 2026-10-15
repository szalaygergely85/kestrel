// UNDER-03 test helper: loads the real world_m1 (terrain + structures) headless, like tools/content-lint.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
export async function loadM1(physics = 'mesh') {
  const { World } = await import('../../../../engine/index.js');
  await import('../../../../design/palette.js'); await import('../../../../design/detail-pass.js'); await import('../../../../design/levels/overworld_far.js'); await import('../../../../design/levels/world_geo.js');
  for (const m of ['lantern', 'lever', 'boulder', 'rubble', 'wreckage', 'relay', 'voxel_props', 'voxel_tower', 'pickups_voxel', 'sword', 'm3_props', 'far_tower', 'ferrum_lights', 'voxel_beast', 'voxel_bear']) await import(`../../../../design/models/${m}.js`);
  const { loadTestAssets } = await import('../../../../tools/testing/content-node.mjs');
  const G = globalThis.ASSETS.levels.world_geo, T = globalThis.ASSETS.levels.overworld_far;
  G.util.installGeo(T.util);
  const strip = (o, keys) => { const r = { ...(o || {}) }; for (const k of keys) delete r[k]; return r; };
  const names = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length));
  Object.assign(globalThis.ASSETS, { levels: strip(globalThis.ASSETS.levels, names('content/levels', '.level.json')), worlds: strip(globalThis.ASSETS.worlds, names('content/worlds', '.world.json')) });
  const { assets } = await loadTestAssets();
  (await import('../index.js')).registerQuestBehaviours();
  const w = World.load(assets.world('world_m1'), assets, { physics, events: { on() { return () => {}; }, emit() {} } });
  const gz = (x, y) => { w.ensureBandFor(x, y); return w.terrain.groundAt(x, y); };
  return { world: w, assets, groundAt: gz };
}
