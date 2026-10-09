// engine/chargen/compose.js (CHARGEN-02, docs/architecture.md 38.29 item 4): composeCharacter(kit, recipe) -> CharGrid.
// Pure and deterministic: no randomness, no clock; the same kit + recipe give the same bytes.
//
// Order: base, then shells (legs, feet, top, outer), then attachments (hair, beard, hat); a later layer wins.
// An attachment's `hides` removes those slots from the build (same result as clearing them first).
// Height rows, age overlay and build are CHARGEN-05; this module builds the recipe's base as authored.
//
// CharGrid: size [sx,sy,sz], index = x + sx*(y + sy*z). mat: 0 = empty, otherwise matKeys[mat-1]
// (matKeys in first-use order, <= 255). bone: index into `bones` (skeleton order).
//
// Shell semantics: region voxels = filled voxels of the bone whose t = (boxTopZ + 1 - (z + 0.5)) / boxHeight
// (0 at the top of the bone box, 1 at the bottom) lies in [t0, t1). The body surface = region voxels with an
// empty (or out-of-grid) 6-neighbour. thick 0 repaints the surface. thick n repaints the surface and grows
// n 6-neighbour layers outward into empty cells; a grown voxel takes the bone of the voxel it grew from
// (the lowest source index wins a contested cell).
import { SHELL_ORDER, ATTACH_ORDER, MAX_MATERIALS, dyeGroupOf, isEmptyChar } from './kit.js';
import { validateRecipe, slotItems } from './recipe.js';

const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function composeCharacter(kit, recipe) {
  const { errors } = validateRecipe(kit, recipe);
  if (errors.length) throw new Error('composeCharacter: invalid recipe: ' + errors.join('; '));
  const base = kit.bases[recipe.base];
  const [sx, sy, sz] = base.size;
  const n = sx * sy * sz;
  const at = (x, y, z) => x + sx * (y + sy * z);
  const boneIndex = new Map(kit.skeleton.map((b, i) => [b.name, i]));
  const matKeys = [];
  const matIndex = new Map();
  const matOf = (key) => {
    let i = matIndex.get(key);
    if (i === undefined) {
      if (matKeys.length >= MAX_MATERIALS) throw new Error(`composeCharacter: more than ${MAX_MATERIALS} materials`);
      matKeys.push(key);
      i = matKeys.length;
      matIndex.set(key, i);
    }
    return i;
  };

  // Ramp id for a dye group: the layer's own pick, else the recipe (skin/eyes/pick), else the first ramp.
  const rampFor = (g, slot, pick) => {
    const set = kit.ramps[g];
    let id;
    if (pick && g === dyeGroupOf(slot)) id = pick.ramp;
    else if (g === 'skin' || g === 'eyes') id = recipe[g];
    else if (g === 'lips') id = recipe.skin;
    else if (g === 'hair') id = (recipe.hair || recipe.beard || {}).ramp;
    else id = recipe[g] ? recipe[g].ramp : undefined;
    return set[id] || set[Object.keys(set)[0]];
  };
  // char -> material index, honouring the pick that dyes the char's group for the layer being painted.
  const resolve = (ch, slot, pick) => {
    const s = kit.slots[ch];
    if (s.fixed !== undefined) return matOf(s.fixed);
    return matOf(rampFor(s.group, slot, pick)[s.shade]);
  };

  // ---- base
  const mat = new Uint8Array(n);
  const bone = new Uint8Array(n);
  const boxes = [];
  for (const b of kit.skeleton) { const d = base.bones[b.name]; if (d) boxes.push({ i: boneIndex.get(b.name), box: d.box }); }
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const ch = base.layers[z][y][x];
    if (isEmptyChar(ch)) continue;
    const hit = boxes.find(({ box: q }) => x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5]);
    if (!hit) throw new Error(`composeCharacter: base voxel (${x},${y},${z}) outside every bone box`);
    mat[at(x, y, z)] = resolve(ch, null, null);
    bone[at(x, y, z)] = hit.i;
  }

  // slots removed by a picked attachment's hides
  const hidden = new Set();
  for (const slot of ATTACH_ORDER) {
    const pick = recipe[slot];
    if (!pick) continue;
    for (const h of slotItems(kit, slot).find((i) => i.id === pick.id).hides || []) hidden.add(h);
  }

  // ---- shells
  const inGrid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const isEmpty = (x, y, z) => !inGrid(x, y, z) || !mat[at(x, y, z)];
  for (const slot of SHELL_ORDER) {
    const pick = recipe[slot];
    if (!pick || hidden.has(slot)) continue;
    const shell = slotItems(kit, slot).find((i) => i.id === pick.id);
    const m = resolve(shell.paint, slot, pick);
    const inRegion = new Uint8Array(n);
    for (const r of shell.regions) {
      const d = base.bones[r.bone];
      if (!d) continue; // this base has no such bone
      const q = d.box;
      const bi = boneIndex.get(r.bone);
      const h = q[5] - q[2] + 1;
      for (let z = q[2]; z <= q[5]; z++) {
        const t = (q[5] + 1 - (z + 0.5)) / h;
        if (t < r.t0 || t >= r.t1) continue;
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
          const i = at(x, y, z);
          if (mat[i] && bone[i] === bi) inRegion[i] = 1;
        }
      }
    }
    let frontier = [];
    for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
      const i = at(x, y, z);
      if (inRegion[i] && NB.some(([dx, dy, dz]) => isEmpty(x + dx, y + dy, z + dz))) frontier.push(i);
    }
    for (const i of frontier) mat[i] = m; // repaint the surface, bone kept
    for (let layer = 0; layer < shell.thick; layer++) {
      const grown = new Map(); // cell -> bone, first (lowest) source wins
      for (const i of frontier) {
        const x = i % sx, y = ((i / sx) | 0) % sy, z = (i / (sx * sy)) | 0;
        for (const [dx, dy, dz] of NB) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (inGrid(nx, ny, nz) && !mat[at(nx, ny, nz)]) {
            const j = at(nx, ny, nz);
            if (!grown.has(j)) grown.set(j, bone[i]);
          }
        }
      }
      const cells = [...grown.keys()].sort((a, b) => a - b);
      for (const j of cells) { mat[j] = m; bone[j] = grown.get(j); }
      frontier = cells;
    }
  }

  // ---- attachments
  for (const slot of ATTACH_ORDER) {
    const pick = recipe[slot];
    if (!pick || hidden.has(slot)) continue;
    const a = slotItems(kit, slot).find((i) => i.id === pick.id);
    const anc = base.anchors[a.anchor];
    const ox = anc[0] + a.offset[0], oy = anc[1] + a.offset[1], oz = anc[2] + a.offset[2];
    const bi = boneIndex.get(a.bone);
    for (let z = 0; z < a.box[2]; z++) for (let y = 0; y < a.box[1]; y++) for (let x = 0; x < a.box[0]; x++) {
      const ch = a.layers[z][y][x];
      if (isEmptyChar(ch)) continue;
      const gx = ox + x, gy = oy + y, gz = oz + z;
      if (!inGrid(gx, gy, gz)) continue;
      const i = at(gx, gy, gz);
      if (a.paintOnly && !mat[i]) continue; // paintOnly never adds voxels
      mat[i] = resolve(ch, slot, pick);
      if (!a.paintOnly) bone[i] = bi;
    }
  }

  return {
    cellM: kit.cellM ?? 0.025,
    size: [sx, sy, sz],
    anchor: base.anchor.slice(),
    mat, bone, matKeys,
    bones: kit.skeleton.map((b) => ({ name: b.name, parent: b.parent ?? null, joint: base.bones[b.name] ? base.bones[b.name].joint.slice() : null })),
    mounts: JSON.parse(JSON.stringify(base.mounts || base.anchors || {})),
    clips: JSON.parse(JSON.stringify(kit.clips || {})),
  };
}
