// PLANT-SCALE-01 (owner 2026-10-10: "poor boar, he is smaller than flowers and plants"): Quaternius Nature plant meshes are authored
// 2-4x real size (tall grass 1.9 m, flower stems 2.1-2.4 m, clover 1.1 m, ferns 2.8 m wide, bushes 1.6 m) next to a 1.05 m boar.
// Uniform placement `scale` (MESH-SCALE-01) per mesh name -> real-world heights: bush ~0.95 m, grass 0.4-0.67 m, fern ~1.4 m wide,
// flowers ~0.5-0.6 m, clover ~0.3 m (0.25 = the MESH-SCALE-01 minimum), mushrooms ~0.18 m. Rocks, pebbles, path stones and trees stay 1.
// Used by tools/gen-meadow-meshes.mjs and tools/gen-roadside-meshes.mjs; world_m1 rows were scaled in place with the same table.
export const PLANT_SCALE = Object.freeze({
  Bush_Common: 0.6, Bush_Common_Flowers: 0.6,
  Grass_Common_Tall: 0.35, Grass_Common_Short: 0.3, Grass_Wispy_Tall: 0.4, Grass_Wispy_Short: 0.4,
  Fern_1: 0.5,
  Flower_3_Single: 0.32, Flower_4_Single: 0.32, Flower_3_Group: 0.32, Flower_4_Group: 0.32,   // owner 2026-10-10: "a little bit" bigger than 0.25
  Clover_1: 0.25, Clover_2: 0.25,
  Plant_1: 0.5, Plant_1_Big: 0.4, Plant_7: 0.6, Plant_7_Big: 0.5,
  Mushroom_Common: 0.4,
});
