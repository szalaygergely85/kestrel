// PLANT-SCALE-01 (owner 2026-10-10: "poor boar, he is smaller than flowers and plants"): Quaternius Nature plant meshes are authored
// 2-4x real size (tall grass 1.9 m, flower stems 2.1-2.4 m, clover 1.1 m, ferns 2.8 m wide, bushes 1.6 m) next to a 1.05 m boar.
// Uniform placement `scale` (MESH-SCALE-01) per mesh name -> real-world heights: bush ~0.95 m, grass 0.4-0.67 m, fern ~1.4 m wide,
// flowers ~0.5-0.6 m, clover ~0.3 m (0.25 = the MESH-SCALE-01 minimum), mushrooms ~0.18 m. Rocks, pebbles, path stones and trees stay 1.
// Used by tools/gen-meadow-meshes.mjs and tools/gen-roadside-meshes.mjs; world_m1 rows were scaled in place with the same table.
export const PLANT_SCALE = Object.freeze({
  Bush_Common: 1.1, Bush_Common_Flowers: 1.1,   // DRESS-01 (owner 2026-10-10 "even bigger bushes"): ~1.75 m, jitter +-25 % -> ~1.3-2.2 m
  Grass_Common_Tall: 0.35, Grass_Common_Short: 0.3, Grass_Wispy_Tall: 0.4, Grass_Wispy_Short: 0.4,
  Fern_1: 0.5,
  Flower_3_Single: 0.32, Flower_4_Single: 0.32, Flower_3_Group: 0.32, Flower_4_Group: 0.32,   // owner 2026-10-10: "a little bit" bigger than 0.25
  Clover_1: 0.25, Clover_2: 0.25,
  Plant_1: 0.5, Plant_1_Big: 0.4, Plant_7: 0.6, Plant_7_Big: 0.5,
  Mushroom_Common: 0.4,
});

// PLANT-SIZE-RANDOM-01: deterministic per-placement size jitter (own hash stream keyed by the placement id, so layout/RNG of the
// generators is untouched): +-20 % plants, +-25 % bushes, clamped to the MESH-SCALE-01 validator minimum 0.25.
export const PLANT_JITTER = 0.20, BUSH_JITTER = 0.25, SCALE_MIN = 0.25;
function idHash(id) {
  let h = 2166136261 ^ 0x51ed27;               // FNV-1a over the id
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;                // 0..1
}
export function plantScaleFor(name, id) {
  const base = PLANT_SCALE[name];
  if (!base) return undefined;
  const u = idHash(id) * 2 - 1;                 // -1..1
  const j = name.startsWith('Bush') ? BUSH_JITTER : PLANT_JITTER;
  const v = Math.max(SCALE_MIN, +(base * (1 + u * j)).toFixed(2));   // 2 decimals; exactly 1 is the 'unscaled' sentinel in saves, so nudge off it
  return v === 1 ? 0.99 : v;
}

// DRESS-01 (owner 2026-10-10 "different trees"): mesh tree species by area + per-placement size 0.85..1.2 (same id hash stream, salted).
export const TREE_SCALE_MIN = 0.85, TREE_SCALE_MAX = 1.2;
export function treeScaleFor(id) {
  const v = +(TREE_SCALE_MIN + idHash('tree:' + id) * (TREE_SCALE_MAX - TREE_SCALE_MIN)).toFixed(2);
  return v === 1 ? 0.99 : v;
}
/** Species weights by ground: 'slope' = higher/rocky ground (pines), 'near' = beside the meadow/road (broadleaf), else 'wild'. */
export const TREE_MIX = Object.freeze({
  near:  { CommonTree: 62, TwistedTree: 12, Pine: 22, DeadTree: 4 },
  wild:  { CommonTree: 45, TwistedTree: 10, Pine: 40, DeadTree: 5 },
  slope: { CommonTree: 18, TwistedTree: 8, Pine: 68, DeadTree: 6 },
});
/** Picks a tree mesh name with the generator's own rng R. Full-detail trunks beside the road (`near`), the LOD1 cut further out
 *  (placed structures have no runtime LOD); TwistedTree is always LOD1 (9.5k tris full). DeadTree has no LOD1. */
export function pickTree(R, area) {
  const w = TREE_MIX[area] || TREE_MIX.wild; let t = 0; for (const k in w) t += w[k];
  let r = R() * t, sp = 'CommonTree'; for (const k in w) { if ((r -= w[k]) < 0) { sp = k; break; } }
  const name = sp + '_' + (1 + Math.floor(R() * 5));
  if (sp === 'DeadTree') return name;
  return sp === 'TwistedTree' || area !== 'near' || R() < 0.5 ? name + '_LOD1' : name;
}
