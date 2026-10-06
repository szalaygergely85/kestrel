// Regression (owner 2026-10-06 "practice statue doesn't get damage"): since PROP-COLLIDE-01b the practice post has its
// own prism collider; the sword's world-ray gates must not treat that own shape as a wall. Real world_m1, mesh physics.
import assert from 'node:assert/strict';
import { World } from '../engine/index.js';
import { loadTestAssets } from './testing/content-node.mjs';
import { registerQuestBehaviours } from '../game/js/quest/index.js';
import { applyPropTargetables } from '../game/js/quest/practiceTarget.js';
import { createSwordSim } from '../game/js/quest/sim/sword.js';
import { SWORD_CFG } from '../game/js/quest/swordConfig.js';
import '../design/palette.js'; import '../design/detail-pass.js'; import '../design/models/title.js'; import '../design/models/lantern.js';
import '../design/models/brazier.js'; import '../design/models/lever.js'; import '../design/models/boulder.js'; import '../design/models/rubble.js';
import '../design/models/wreckage.js'; import '../design/models/relay.js'; import '../design/models/voxel_props.js'; import '../design/models/voxel_tower.js';
import '../design/models/voxel_world.js'; import '../design/models/sword.js'; import '../design/models/m3_props.js'; import '../design/models/far_tower.js';
import '../design/models/ferrum_lights.js'; import '../design/levels/overworld_far.js';

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const { assets } = await loadTestAssets();
registerQuestBehaviours();
const w = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
applyPropTargetables(w);
let post = null;
w.forEachEntity(e => { if (String(e.id).endsWith('.practiceTarget')) post = e; });
ok(post && post.components.targetable, 'practice post is targetable');
ok(w.colliders.some(c => c.id === 'props:static'), 'solid prop colliders present (the regression precondition)');
w.state['tower.sword.taken'] = true;

for (const hand of ['left', 'right']) {
  const hits = []; const listeners = new Map();
  const events = { on(n, fn) { let s = listeners.get(n); if (!s) listeners.set(n, s = new Set()); s.add(fn); return () => s.delete(fn); },
    emit(n, p) { if (n === 'combat:hit') hits.push(p); const s = listeners.get(n); if (s) for (const fn of [...s]) fn(p); } };
  const sim = createSwordSim(w, events, { ...SWORD_CFG, hand }, {});
  // stand 1.0 m in front of the post, facing it (+x/-x does not matter: aim straight at it)
  const px = post.transform.x - 1.0, py = post.transform.y;
  const player = { id: 'player', transform: { x: px, y: py, z: post.transform.z, yawDeg: 90 }, components: { body: { grounded: true, speedScale: 1, vx: 0, vy: 0, vz: 0, eyeH: 1.6 } } };
  sim.step(player, 1, 0, true); sim.step(player, 1, 0, false);
  for (let i = 0; i < 40; i++) sim.step(player, 1, 0, false);
  const onPost = hits.filter(h => (h.target || h.targetId || (h.entity && h.entity.id)) === post.id || JSON.stringify(h).includes('practiceTarget'));
  ok(onPost.length >= 1, `${hand}-hand light swing at 1 m hits the solid practice post (hits: ${hits.length})`);
}
console.log(`practice-hit: ${checks} checks`);
console.log('ALL PASS');
