// MESH-FULL-01 (architecture 37.19): REPORT-ONLY. Budgets are warn thresholds, not targets; imported art keeps its authored detail
// (reimport-quaternius.mjs --full never simplifies). `--budget` / `--simplify` stay as opt-in tool flags (far LODs, after an owner preview).
// MESH-SIMP-01: per-mesh triangle budgets for imported Quaternius meshes. First matching rule wins (matched on the
// mesh id's basename). `gltf-import.mjs --budget` uses it as the --simplify target; `reimport-quaternius.mjs` applies it
// to every mesh in content/meshes/quaternius/ that is above its budget.
export const MESH_BUDGETS = [
  { re: /^Pebble/, tris: 80, label: 'pebbles' },
  { re: /^Grass/, tris: 60, label: 'grass tufts' },
  { re: /^Mushroom/, tris: 250, label: 'mushrooms' },
  { re: /^RockPath/, tris: 250, label: 'path stones' },
  { re: /^Rock/, tris: 400, label: 'rocks' },
  { re: /^tree_/, tris: 600, label: 'Kenney low-poly trees (TREES-LP-a)' },
  { re: /Tree|Pine/, tris: 2000, label: 'trees' },
];

/** Triangle budget for a mesh id (e.g. "quaternius/Rock_Medium_3"), or null when no rule matches. */
export function budgetFor(id) {
  const base = String(id).split('/').pop();
  const rule = MESH_BUDGETS.find((r) => r.re.test(base));
  return rule ? rule.tris : null;
}
