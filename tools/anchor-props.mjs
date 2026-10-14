// NPC-LOOKS-01: idempotent patch of content/worlds/world_m1.world.json. The 11 quest givers get their own char.<npcLooks id> model
// (design/chargen/npc_looks.js, registered at boot by giverNpcs.js registerGiverLooks) and the anchors notePost / knot / pierStone get the
// voxel props markerPost / standingStone (design/models/marker_props_voxel.js). Run: node tools/anchor-props.mjs
import fs from 'node:fs';
import { stringifyContent } from '../engine/index.js';
import { GIVER_LOOK } from '../game/js/quest/giverNpcs.js';
const FILE = 'content/worlds/world_m1.world.json';
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const ent = (id) => data.entities.find((e) => e.id === id);
const set = (id, model) => { const e = ent(id); if (!e) throw new Error('missing entity ' + id); e.components.voxel = { ...(e.components.voxel || {}), anim: 'idle', loop: true, model }; };
for (const [id, look] of Object.entries(GIVER_LOOK)) { set(id, 'char.' + look); const e = ent(id); if (e.note) e.note = e.note.replace('default kit look until design/chargen/npc_looks.js exists', 'own look ' + look + ' (npc_looks.js)'); }
set('notePost', 'markerPost'); set('knot', 'markerPost'); set('pierStone', 'standingStone');
fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('anchor-props: wrote', FILE);
