// OB-143 (owner 2026-10-14: "remove all this things hanging in the air"): placed meshes of world_m1 whose base floats > 0.25 m above the lowest
// ground under their footprint, or whose strut/beam/plank-class bounds poke out of a slope (prop-ground-lint rules). Trees are handled by
// tools/resnap-rocks.mjs --trees (OB-131) and plants/grass under 0.25 m are fine, so both are skipped here.
// Skipped: Laetiporus shelf mushrooms (OB-130), sealed-gate/outwall wall pieces (quest structures, reported only), strandStake* (stand in the sea; the lint measures the seabed).
// --remove also drops every non-strand Prop_Support (the crossed X-beam strut, OB-143: generators no longer emit it) and the marker-post planks nailed to them.
// Run: node tools/probe-floating-props.mjs [--remove]   (--remove deletes the listed structures + their orphaned child planks, canonical write)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stringifyContent } from '../engine/index.js';
import { lintWorld, CHECKED } from './prop-ground-lint.mjs';
export const FILE = 'content/worlds/world_m1.world.json', MAX_FLOAT = 0.25;
export async function floatingProps() {
  const r = await lintWorld('world_m1', true);
  return r.filter((p) => !/Tree|Pine|Mushroom_Laetiporus|Wall_/.test(p.mesh) && !p.id.startsWith('strandStake') && (p.float > MAX_FLOAT || (p.kind.includes('steep') && CHECKED.test(p.mesh))));
}
/** OB-155: placed meshes swallowed by the terrain (lowest vertex > SUNK_M under the ground at the origin). Rocks/trees/plants/walls/fences embed on purpose. */
export const SUNK_SKIP = /Tree|Pine|Rock|Boulder|Cliff|Stone|Bush|Grass|Fern|Plant|Flower|Clover|Mushroom|Pebble|Wall_|Fence|Path|Stump|Log/;
export const SUNK_ALLOW = { poi079: 'stairs descend into the rook ruin (nav floors)', ow035: 'ruin corner foundation, scale 1.9, sunk into the slope on purpose' };
export async function sunkProps() {
  const r = await lintWorld('world_m1', true, { sunk: true });
  return r.filter((p) => p.kind.includes('sunk') && !SUNK_SKIP.test(p.mesh) && !p.id.startsWith('strandStake') && !SUNK_ALLOW[p.id]);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bad = await floatingProps(), by = {};
  for (const p of bad) (by[p.mesh] ||= []).push(p.id + ':' + p.float + (p.kind.includes('steep') ? 's' : ''));
  for (const [k, v] of Object.entries(by)) console.log(k, v.length, v.slice(0, 24).join(' '));
  console.log('floating placed props', bad.length);
  if (process.argv.includes('--remove')) {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8')), n0 = data.structures.length, ids = new Set(bad.map((p) => p.id));
    const sup = data.structures.filter((s) => /Prop_Support/.test(s.mesh || '') && !/^strand/.test(s.id));
    for (const s of sup) ids.add(s.id);
    for (const s of data.structures) if (/Prop_WoodenFence_Single/.test(s.mesh || '') && !/^strand/.test(s.id) && sup.some((q) => Math.hypot(q.origin.x - s.origin.x, q.origin.y - s.origin.y) < 3)) ids.add(s.id);
    data.structures = data.structures.filter((s) => !ids.has(s.id));
    fs.writeFileSync(FILE, stringifyContent(data), 'utf8'); console.log('removed', n0 - data.structures.length, 'of', n0);
  }
}
