// DOOR-TOGGLE-01 (game/js/quest/doorToggle.js). Headless Node ESM. Run: node game/js/quest/doorToggle.test.js
import { World, serialize, deserialize } from '../../../engine/index.js';
import { registerQuestBehaviours } from './index.js';
import { applyDoorState, DOOR_KEY } from './doorToggle.js';
import paletteMod from '../../../design/palette.js';
import detailPassMod from '../../../design/detail-pass.js';
import lanternMod from '../../../design/models/lantern.js';
import leverMod from '../../../design/models/lever.js';
import boulderMod from '../../../design/models/boulder.js';
import rubbleMod from '../../../design/models/rubble.js';
import wreckageMod from '../../../design/models/wreckage.js';
import relayMod from '../../../design/models/relay.js';
import swordMod from '../../../design/models/sword.js';
import m3PropsMod from '../../../design/models/m3_props.js';
import notesMod from '../../../design/models/notes.js';
import farTowerMod from '../../../design/models/far_tower.js';
import ferrumLightsMod from '../../../design/models/ferrum_lights.js';
import terrainMod from '../../../design/levels/overworld_far.js';
import { loadTestAssets } from '../../../tools/testing/content-node.mjs';
import { makeOk } from '../../../engine/test/assert.js';

paletteMod; detailPassMod; terrainMod; lanternMod; leverMod; boulderMod; rubbleMod; wreckageMod; relayMod; swordMod; m3PropsMod; notesMod; farTowerMod; ferrumLightsMod;
const { assets } = await loadTestAssets();
let pass = 0, fail = 0; const failures = [];
const ok = makeOk(() => pass++, () => fail++, (m) => failures.push(m));
registerQuestBehaviours();

const def = assets.world('world_m1');
const w = World.load(def, assets, { physics: 'mesh' });
const voxel = (world) => world.get('tower.doorBar').getComponent('voxel');
const rec = (world) => world.interactables.find((r) => r.key === 'tower.door');
const propColliderTris = (world) => world.colliders.find((c) => c.id === 'props:static').bvh.triCount;
const fire = (world) => world.fireInteraction('door.toggle', { structId: 'tower', entity: world.get('tower.doorBar') });

ok('1a: starts closed (clip closed, state unset, prompt [E] Open)', voxel(w).anim === 'closed' && !w.state[DOOR_KEY] && rec(w).prompt === '[E] Open');
const tris0 = propColliderTris(w);
ok('1b: door.toggle opens: variant open, clip opening, state true, prompt [E] Close, collider dropped', fire(w) === true
  && voxel(w).variant === 'open' && voxel(w).anim === 'opening' && w.state[DOOR_KEY] === true && rec(w).prompt === '[E] Close' && propColliderTris(w) === tris0 - 12);
ok('1c: toggling again closes: variant closed, clip closing, prompt [E] Open, collider back', fire(w) === true
  && voxel(w).variant === 'closed' && voxel(w).anim === 'closing' && !w.state[DOOR_KEY] && rec(w).prompt === '[E] Open' && propColliderTris(w) === tris0);
ok('1d: no Esc text in prompts', !/esc/i.test(rec(w).def.openPrompt + rec(w).def.closePrompt + rec(w).prompt));

// save round trip (open) + applyDoorState on 'world:loaded'
fire(w);
const re = deserialize(serialize(w), assets, { physics: 'mesh' });
applyDoorState(re);
ok('2a: reload shows the saved open state (variant, clip, state, prompt, collider)', voxel(re).variant === 'open' && voxel(re).anim === 'open' && re.state[DOOR_KEY] === true
  && rec(re).prompt === '[E] Close' && propColliderTris(re) === tris0 - 12);
fire(re);
const re2 = deserialize(serialize(re), assets, { physics: 'mesh' });
applyDoorState(re2);
ok('2b: reload shows the saved closed state', voxel(re2).variant === 'closed' && voxel(re2).anim === 'closed' && !re2.state[DOOR_KEY] && rec(re2).prompt === '[E] Open' && propColliderTris(re2) === tris0);

// state-only: a fresh world given state open (e.g. a state-only save) is fixed up by applyDoorState
// (also: a level whose prop starts at the collider-off variant has no collider at load - World honours colliderOffVariant)
const fresh = World.load(def, assets, { physics: 'mesh' });
fresh.state[DOOR_KEY] = true; applyDoorState(fresh);
ok('3: applyDoorState on a fresh world with state open opens it', voxel(fresh).variant === 'open' && propColliderTris(fresh) === tris0 - 12 && rec(fresh).prompt === '[E] Close');

// never close the door on the player standing in the doorway
const wp = World.load(def, assets, { physics: 'mesh' });
fire(wp);
const door = wp.get('tower.doorBar').data.transform, pl = wp.get('player').data.transform;
pl.x = door.x; pl.y = door.y + 0.1; pl.z = door.z;
ok('4: closing is refused while the player stands in the doorway', fire(wp) === false && voxel(wp).variant === 'open' && wp.state[DOOR_KEY] === true);
pl.y = door.y - 1.2;
ok('4b: closing works once the player stepped aside', fire(wp) === true && voxel(wp).variant === 'closed');

console.log(`${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n' + failures.join('\n')); process.exit(1); }
