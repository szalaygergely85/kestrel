// OB-152 "chests are earned": one-off, idempotent patch of content/worlds/world_m1.world.json (like anchor-boards.mjs).
// Loose chests move into the nearest goblin camp (a fight guards them) or are removed. Generators (gen-poi-props / gen-secrets-*)
// have drifted from the world json; do NOT re-run them wholesale, re-apply this patch after any run.
// Run: node tools/anchor-chests.mjs   (then node tools/content-lint.mjs --only R15)
import fs from 'node:fs';
import { stringifyContent } from '../engine/index.js';
const F = new URL('../content/worlds/world_m1.world.json', import.meta.url);
const MOVE = { // id -> [x, y] inside campNorth (925,905) / campEast (965,975), clear of the goblin member spots
  chestMeadow: [917, 904], chestBend: [933, 902], secretOw3: [925, 896],
  chestCrossroads: [956, 977], secretOw1: [955, 982], secretRook: [966, 966],
};
const REMOVE = ['secretBend', 'secretField', 'secretBank']; // Ch1-2 arrow stashes: no camp near, cut (OB-152)
/** Pure + idempotent: returns a patched copy of `world` (loose chests moved into camps / removed). */
export function anchorChests(world) {
  const w = JSON.parse(JSON.stringify(world));
  w.entities = w.entities.filter((e) => !REMOVE.includes(e.id));
  for (const e of w.entities) if (MOVE[e.id]) {
    [e.x, e.y] = MOVE[e.id];
    if (typeof e.z === 'number') e.z = 'ground'; // crossroads sat on a stair platform; the camp spot is flat ground
    if (!/OB-152/.test(e.note)) e.note += ' | OB-152: moved into a goblin camp (earned, not loose)';
  }
  return w;
}
export { MOVE, REMOVE };

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) { // CLI only
  const w = anchorChests(JSON.parse(fs.readFileSync(F, 'utf8')));
  fs.writeFileSync(F, stringifyContent(w));
  console.log('anchor-chests: moved', Object.keys(MOVE).length, 'removed', REMOVE.length);
}
