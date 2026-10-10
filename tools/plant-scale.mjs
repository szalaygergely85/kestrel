// PLANT-SCALE-01 (owner 2026-10-10: "poor boar, he is smaller than flowers and plants"): Quaternius Nature plant meshes are authored
// 2-4x real size (tall grass 1.9 m, flower stems 2.1-2.4 m, clover 1.1 m, ferns 2.8 m wide, bushes 1.6 m) next to a 1.05 m boar.
// Uniform placement `scale` (MESH-SCALE-01) per mesh name -> real-world heights: bush ~0.95 m, grass 0.4-0.67 m, fern ~1.4 m wide,
// flowers ~0.5-0.6 m, clover ~0.3 m (0.25 = the MESH-SCALE-01 minimum), mushrooms ~0.18 m. Rocks, pebbles, path stones and trees stay 1.
// Used by tools/gen-meadow-meshes.mjs and tools/gen-roadside-meshes.mjs; world_m1 rows were scaled in place with the same table.
export const PLANT_SCALE = Object.freeze({
  Bush_Common: 0.85, Bush_Common_Flowers: 0.85,   // PLANT-SIZE-RANDOM-01 (owner 2026-10-10): bigger bushes, ~1.3-1.4 m
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
export function plantScaleFor(name, id) {
  const base = PLANT_SCALE[name];
  if (!base) return undefined;
  let h = 2166136261 ^ 0x51ed27;               // FNV-1a over the id
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0; h ^= h >>> 16;
  const u = (h >>> 0) / 4294967296 * 2 - 1;     // -1..1
  const j = name.startsWith('Bush') ? BUSH_JITTER : PLANT_JITTER;
  const v = Math.max(SCALE_MIN, +(base * (1 + u * j)).toFixed(2));   // 2 decimals; exactly 1 is the 'unscaled' sentinel in saves, so nudge off it
  return v === 1 ? 0.99 : v;
}
