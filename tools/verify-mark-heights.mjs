// OB-155h/OB-164: prints the quest marker height (above the entity origin) for every quest anchor from its model bounds. Node only, no port needed.
//   node tools/verify-mark-heights.mjs        (browser look, if wanted: tools/capture-browser.mjs on {port} 9500-9574, not required)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { markHeight, modelTop, structureTop, MARK_MARGIN } from '../game/js/quest/markTop.js';
import { loadDesignAssets, loadQuestFiles, loadPackQuests } from './validate-content.mjs';
const assets = await loadDesignAssets();
const dir = fileURLToPath(new URL('../content/quests', import.meta.url));
const q = [...loadQuestFiles(dir).quests, ...(await loadPackQuests(dir, assets.items?.defs)).quests].map(x => x.def);
const world = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../content/worlds/world_m1.world.json', import.meta.url)), 'utf8'));
const ents = new Map(world.entities.map(e => [e.id, e]));
const A = { voxelModels: assets.voxelModels, models: assets.models, meshes: assets.meshes };
const ids = new Set(); for (const d of q) if (d.giver) for (const id of [d.giver.entity || d.giver.npc, d.giver.turnInEntity || d.giver.turnIn]) if (id) ids.add(id);
for (const id of [...ids].sort()) { const e = ents.get(id); if (!e) { console.log(id.padEnd(22), '(no world entity)'); continue; } const d = { components: e.components, transform: { scale: e.scale || 1 } }; const nm = !(e.components && (e.components.voxel || e.components.mesh)) ? structureTop(world.structures.map(s => ({ ...s, bbox: s.bbox })), e.x, e.y, typeof e.z === 'number' ? e.z : 0) : null; console.log(id.padEnd(22), nm !== null ? 'struct top ' + nm.toFixed(2) + ' marker ' + (nm + MARK_MARGIN).toFixed(2) : '', 'top', String(modelTop(d, A)?.toFixed(2)).padStart(5), 'marker', markHeight(d, A).toFixed(2)); }
