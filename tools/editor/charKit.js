// OB-218: the editor never registered the `char.kit` world model (Hesk, Dorrin, the player body), so NPCs using it drew nothing.
// Same recipe as game/js/main.js (static pose is enough here: no swim clips, no leg rig / look-at).
import { composeCharacter, meshCharacter, collapseRig, riggedModelDef } from '../../engine/index.js';

/** Builds the kit character model def from a parsed human.charkit.json. */
export function buildKitModelDef(kit) {
  const grid = composeCharacter(kit, kit.defaults);
  return riggedModelDef(collapseRig(meshCharacter(grid), kit.partMap));
}

/** Fetches the kit and registers `char.kit` in `assets` (no-op when present). Returns true when registered. Never throws. */
export async function registerKitChar(assets, url = '../../content/chargen/human.charkit.json', fetchFn = fetch) {
  if (assets.has('model', 'char.kit')) return false;
  try {
    const r = await fetchFn(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    assets.add('model', 'char.kit', buildKitModelDef(await r.json()));
    return true;
  } catch (e) { console.warn('[editor] char.kit not registered: ' + (e && e.message)); return false; }
}
