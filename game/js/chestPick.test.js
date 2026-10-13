// OB-106: every world_m1 chest registers a crosshair target "[E] Open chest" (it had none: no prompt ever showed).
// Real World + real chest defs; aim from 1.3 m in front of each chest at its centre -> target = that chest; 1 m to the side -> none;
// beyond the 1.8 m ray reach -> none; an opened chest hides it. Run: node game/js/chestPick.test.js
import { World } from '../../engine/index.js';
import { findInteractTarget } from '../../engine/index.js';
import paletteMod from '../../design/palette.js';
import detailPassMod from '../../design/detail-pass.js';
import terrainMod from '../../design/levels/overworld_far.js';
import m0 from '../../design/models/lantern.js';
import m1 from '../../design/models/lever.js';
import m2 from '../../design/models/boulder.js';
import m3 from '../../design/models/rubble.js';
import m4 from '../../design/models/wreckage.js';
import m5 from '../../design/models/relay.js';
import m6 from '../../design/models/sword.js';
import m7 from '../../design/models/m3_props.js';
import m8 from '../../design/models/notes.js';
import m9 from '../../design/models/far_tower.js';
import m10 from '../../design/models/ferrum_lights.js';
import chestMod from '../../design/models/chest.js';
import '../../design/items.js';
import '../../design/models/title.js';
import '../../design/models/inventory_ui.js';
import '../../design/models/menu_ui.js';
import { loadTestAssets } from '../../tools/testing/content-node.mjs';
import { makeOk } from '../../engine/test/assert.js';
import { createChestHook } from './chestHook.js';
import { buildChestDefs } from './quest/sim/chestDefs.js';
import { ensureInventory } from './quest/sim/inventory.js';

paletteMod; m0; m1; m2; m3; m4; m5; m6; m7; m8; m9; m10; detailPassMod; terrainMod; chestMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));

const A = globalThis.ASSETS;
const rgb = Object.fromEntries(Object.entries(A.palette.colors).map(([k, h]) => [k, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]));
const world = World.load(assets.world('world_m1'), assets, { physics: 'mesh' });
const playerData = { transform: { x: 0, y: 0, z: 0 }, components: {} };
const inv = ensureInventory(playerData, { pack: [], left: null, right: null });
const hook = createChestHook({ defs: [], items: A.items, style: A.uiStyle.itemGetCard, rgb, openedChestsOf: () => [], seed: 1 });
hook.onBoot({ world, player: playerData, events: { emit() {} }, inventory: inv, state: {} });

const defs = buildChestDefs(world);
ok('1: world_m1 has chests (' + defs.length + ')', defs.length >= 10);
const eyeToward = (ex, ey, ez, tx, ty, tz) => { // compass yaw (0 = -y, clockwise) + pitch from the eye to a point
  const dx = tx - ex, dy = ty - ey, dz = tz - ez, h = Math.hypot(dx, dy);
  return { x: ex, y: ey, z: ez, yawDeg: Math.atan2(dx, -dy) * 180 / Math.PI, pitchDeg: Math.atan2(dz, h) * 180 / Math.PI };
};
const out = { targetKey: null, prompt: '', dist: 0, angleDeg: 0 };
const bad = [];
for (const d of defs) {
  const key = 'chest.' + d.id, rec = world.interactables.find((r) => r.key === key);
  if (!rec) { bad.push(d.id + ' not registered'); continue; }
  const e = world.entity(d.id), ya = (e.transform.yawDeg || 0) * Math.PI / 180;
  const fx = Math.sin(ya), fy = -Math.cos(ya), sx = -fy, sy = fx; // front (local -y rotated by yaw ... compass forward) and a side vector
  const c = rec.pickShapes[0];
  const fxs = [[fx, fy], [-fx, -fy]]; // either long side: try both fronts, one must work (the player walks round)
  let hit = false, side = false;
  for (const [ax, ay] of fxs) {
    const ex = d.x + ax * 1.3, ey = d.y + ay * 1.3, ez = d.z + 1.6;
    out.targetKey = null; findInteractTarget(world, eyeToward(ex, ey, ez, c.cx, c.cy, c.cz), null, out);
    if (out.targetKey === key && out.prompt === '[E] Open chest') hit = true;
    out.targetKey = null; findInteractTarget(world, eyeToward(ex, ey, ez, c.cx + sx, c.cy + sy, c.cz), null, out);
    if (out.targetKey === null) side = true;
  }
  if (!hit) bad.push(d.id + ' aimed at centre from 1.3 m: no target');
  if (!side) bad.push(d.id + ' aimed 1 m to the side still targets');
  out.targetKey = null; findInteractTarget(world, eyeToward(d.x + fx * 3, d.y + fy * 3, d.z + 1.6, c.cx, c.cy, c.cz), null, out);
  if (out.targetKey === key) bad.push(d.id + ' targeted from 3 m');
}
ok('2: every chest: centre hit, side miss, 3 m miss' + (bad.length ? ' ' + JSON.stringify(bad) : ''), bad.length === 0);
const gone = !world.interactables.some((r) => r.key === 'chest.' + defs[0].id) ;
ok('3: sanity: first chest still registered while closed', !gone);

// 4: opening the chest (E in front, facing it) removes its target; a chest saved as opened never registers.
{
  const d = defs.find((q) => q.id === 'chestHidden'), e = world.entity(d.id), ya = (e.transform.yawDeg || 0) * Math.PI / 180;
  const fx = Math.sin(ya), fy = -Math.cos(ya);
  const st = { interactPressed: true, interactRaw: true, playerYawDeg: Math.atan2(-fx, fy) * 180 / Math.PI };
  playerData.transform.x = d.x + fx * 1.0; playerData.transform.y = d.y + fy * 1.0; playerData.transform.z = d.z;
  const ev = [];
  const h2 = createChestHook({ defs: [], items: A.items, style: A.uiStyle.itemGetCard, rgb, openedChestsOf: () => [], seed: 1 });
  h2.onBoot({ world, player: playerData, events: { emit(n) { ev.push(n); } }, inventory: inv, state: st });
  h2.onTick(0.016); h2.onTick(0.016);
  ok('4a: opened chest -> E target removed (events ' + ev.join(',') + ')', ev.includes('chest:opening') && !world.interactables.some((r) => r.key === 'chest.chestHidden'));
  const h3 = createChestHook({ defs: [], items: A.items, style: A.uiStyle.itemGetCard, rgb, openedChestsOf: () => ['chestForge'], seed: 1 });
  h3.onBoot({ world, player: playerData, events: { emit() {} }, inventory: inv, state: {} });
  ok('4b: chest saved as opened has no target', !world.interactables.some((r) => r.key === 'chest.chestForge'));
}
console.log(`chestPick: ${pass} ok, ${fail} fail`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
