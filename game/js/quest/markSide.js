// OB-125: side-quest markers. Main chain = the gold '!' / '?' (design/models/quest_mark.js); side quests (region errands, relay
// offers, other giver quests) = a light-blue twin built here from the same model record, only the gold/shine materials swapped
// for an existing palette material (team.teal #30c8f0). No new art, palette untouched; same size, clips and fx as the gold pair.
export const SIDE_MATS = { C: 'team.teal', S: 'team.teal' }; // body + shine; the outline 'O' stays brass_dark
export const SIDE_MODELS = { questMark: 'questMarkSide', questMarkReady: 'questMarkReadySide' };
// D-098: grey '?' = the ready-'?' model with neutral bone-grey (team.a) materials: quest accepted, objectives not done yet.
export const GREY_MATS = { C: 'team.a', S: 'team.a' };

/** Clone one marker model record with the side materials; returns null when the source is missing. */
export function sideVariant(def, key, mats = SIDE_MATS) {
  if (!def || !def.voxel) return null;
  const c = structuredClone(def);
  c.name = key; c.voxel.mats = { ...c.voxel.mats, ...mats };
  return c;
}

/** Registers questMarkSide / questMarkReadySide on ASSETS (voxelModels + models) before the AssetRegistry is built. Returns the count added. */
export function addSideMarks(A) {
  if (!A || !A.voxelModels) return 0;
  let n = 0;
  for (const [from, to] of Object.entries(SIDE_MODELS)) {
    const v = sideVariant(A.voxelModels[from], to); if (!v) continue;
    A.voxelModels[to] = v; (A.models = A.models || {})[to] = v; n++;
  }
  const g = sideVariant(A.voxelModels.questMarkReady, 'questMarkGrey', GREY_MATS);
  if (g) { A.voxelModels.questMarkGrey = g; (A.models = A.models || {}).questMarkGrey = g; n++; }
  return n;
}
