// engine/chargen/compose.js (CHARGEN-02, docs/architecture.md 38.29 item 4): composeCharacter(kit, recipe) -> CharGrid.
// Pure and deterministic: no randomness, no clock; the same kit + recipe give the same bytes.
//
// Order: base, then shells (legs, feet, top, outer), then attachments (hair, beard, hat); a later layer wins.
// An attachment's `hides` removes those slots from the build (same result as clearing them first).
// Height rows, age overlay and build are CHARGEN-05; this module builds the recipe's base as authored.
//
// CharGrid also carries `blocks` (38.34): a region (the head) kept finer than the body is its own block
// {region, k, origin:[x,y,z] main cells, size, mat, bone}; each block cell is 1/k of a main cell. blocks: [] at res 1/1.
// CharGrid: size [sx,sy,sz], index = x + sx*(y + sy*z). mat: 0 = empty, otherwise matKeys[mat-1]
// (matKeys in first-use order, <= 255). bone: index into `bones` (skeleton order).
//
// Shell semantics: region voxels = filled voxels of the bone whose t = (boxTopZ + 1 - (z + 0.5)) / boxHeight
// (0 at the top of the bone box, 1 at the bottom) lies in [t0, t1). The body surface = region voxels with an
// empty (or out-of-grid) 6-neighbour. thick 0 repaints the surface. thick n repaints the surface and grows
// n 6-neighbour layers outward into empty cells; a grown voxel takes the bone of the voxel it grew from
// (the lowest source index wins a contested cell).
import { SHELL_ORDER, ATTACH_ORDER, MAX_MATERIALS, dyeGroupOf, isEmptyChar } from './kit.js';
import { validateRecipe, slotItems, effectiveHeight, ageTempo, effectiveRes } from './recipe.js';
import { downsample2 } from './downsample.js';
import { heightBase } from './height.js';

const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function composeCharacter(kit, recipe) {
  const { errors } = validateRecipe(kit, recipe);
  if (errors.length) throw new Error('composeCharacter: invalid recipe: ' + errors.join('; '));
  const base = heightBase(kit.bases[recipe.base], effectiveHeight(recipe), kit.regions);
  const [sx, sy, sz] = base.size;
  const res = effectiveRes(recipe);
  const B = res.body;
  if (B !== 1) throw new Error('composeCharacter: res.body > 1 needs authored body detail (CHARGEN-24)');
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

  // ---- grids: the main grid (level B) + one block per region kept finer than the body (38.34 item 2)
  const regionOf = new Map(); // bone name -> region name
  for (const [rn, r] of Object.entries(kit.regions || {})) for (const b of r.bones) regionOf.set(b, rn);
  const mkGrid = (size, level, org1) => ({
    size, level, org1, owns: new Set(), boxes: new Map(),
    mat: new Uint8Array(size[0] * size[1] * size[2]), bone: new Uint8Array(size[0] * size[1] * size[2]),
    at: (x, y, z) => x + size[0] * (y + size[1] * z),
  });
  const main = mkGrid([sx, sy, sz], B, [0, 0, 0]);
  const grids = [main];
  const gridOfBone = new Map();
  for (const b of kit.skeleton) {
    const rn = regionOf.get(b.name);
    if (rn === undefined || (res[rn] || B) <= B) { main.owns.add(boneIndex.get(b.name)); gridOfBone.set(b.name, main); }
  }
  for (const [rn, r] of Object.entries(kit.regions || {})) {
    const H = res[rn] || B;
    if (H <= B) continue;
    const q = (base.regionBoxes && base.regionBoxes[rn]) || r.box;
    const g = mkGrid([(q[3] - q[0] + 1) * H, (q[4] - q[1] + 1) * H, (q[5] - q[2] + 1) * H], H, [q[0], q[1], q[2]]);
    g.k = H / B; g.region = rn; g.origin = [q[0] * B, q[1] * B, q[2] * B];
    for (const bn of r.bones) {
      g.owns.add(boneIndex.get(bn)); gridOfBone.set(bn, g);
      const d = base.bones[bn];
      const det = base.detail && base.detail[rn] && base.detail[rn][H] && base.detail[rn][H].bones && base.detail[rn][H].bones[bn];
      if (det) g.boxes.set(bn, det.box);
      else if (d) g.boxes.set(bn, [(d.box[0] - q[0]) * H, (d.box[1] - q[1]) * H, (d.box[2] - q[2]) * H, (d.box[3] + 1 - q[0]) * H - 1, (d.box[4] + 1 - q[1]) * H - 1, (d.box[5] + 1 - q[2]) * H - 1]);
    }
    grids.push(g);
  }
  for (const [name, d] of Object.entries(base.bones)) if (gridOfBone.get(name) === main) main.boxes.set(name, d.box);
  const blocks = grids.slice(1);
  // main-grid cell covered by a filled block cell (the block owns that space)
  const blockFilled = (x, y, z) => {
    for (const g of blocks) {
      const o = g.origin, k = g.k;
      const bx = x - o[0], by = y - o[1], bz = z - o[2];
      if (bx < 0 || by < 0 || bz < 0 || bx * k >= g.size[0] || by * k >= g.size[1] || bz * k >= g.size[2]) continue;
      for (let dz = 0; dz < k; dz++) for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
        if (g.mat[g.at(bx * k + dx, by * k + dy, bz * k + dz)]) return true;
      }
    }
    return false;
  };

  // ---- base
  // layers of a region at level L: authored, else downsampled from the next finer authored level
  const regionLayers = (rn, L) => {
    const det = (base.detail && base.detail[rn]) || {};
    if (det[L]) return det[L].layers;
    const finer = [2, 4].filter((l) => l > L && det[l])[0];
    if (!finer) throw new Error(`composeCharacter: region ${rn} has no detail for level ${L}`);
    let layers = det[finer].layers;
    for (let l = finer; l > L; l /= 2) layers = downsample2(layers, kit.slots);
    return layers;
  };
  const fillBase = (g, layers) => {
    const [gx, gy, gz] = g.size;
    // first box in skeleton order wins; a voxel whose bone lives in another grid is not ours
    const boxes = [];
    for (const b of kit.skeleton) { const q = g.boxes.get(b.name) || (g === main && base.bones[b.name] && base.bones[b.name].box); if (q) boxes.push({ i: boneIndex.get(b.name), box: q }); }
    for (let z = 0; z < gz; z++) for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
      const ch = layers[z][y][x];
      if (isEmptyChar(ch)) continue;
      const hit = boxes.find(({ box: q }) => x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5]);
      if (!hit) throw new Error(`composeCharacter: base voxel (${x},${y},${z}) outside every bone box`);
      if (!g.owns.has(hit.i)) continue;
      g.mat[g.at(x, y, z)] = resolve(ch, null, null);
      g.bone[g.at(x, y, z)] = hit.i;
    }
  };
  fillBase(main, base.layers);
  for (const g of blocks) fillBase(g, regionLayers(g.region, g.level));

  // slots removed by a picked attachment's hides
  const hidden = new Set();
  for (const slot of ATTACH_ORDER) {
    const pick = recipe[slot];
    if (!pick) continue;
    for (const h of slotItems(kit, slot).find((i) => i.id === pick.id).hides || []) hidden.add(h);
  }

  // ---- shells (per grid, in that grid's own cells; thick is physical, so it grows thick * level layers)
  const growShell = (g, shell, m) => {
    const [gx, gy, gz] = g.size;
    const n = gx * gy * gz;
    const { mat, bone, at } = g;
    const inGrid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < gx && y < gy && z < gz;
    const isEmpty = (x, y, z) => (!inGrid(x, y, z) ? true : !mat[at(x, y, z)] && !(g === main && blocks.length && blockFilled(x, y, z)));
    const inRegion = new Uint8Array(n);
    let any = false;
    for (const r of shell.regions) {
      const bi = boneIndex.get(r.bone);
      const q = g.boxes.get(r.bone);
      if (!q || !g.owns.has(bi)) continue; // this base has no such bone / another grid owns it
      const h = q[5] - q[2] + 1;
      for (let z = q[2]; z <= q[5]; z++) {
        const t = (q[5] + 1 - (z + 0.5)) / h;
        if (t < r.t0 || t >= r.t1) continue;
        for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
          const i = at(x, y, z);
          if (mat[i] && bone[i] === bi) { inRegion[i] = 1; any = true; }
        }
      }
    }
    if (!any) return;
    let frontier = [];
    for (let z = 0; z < gz; z++) for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
      const i = at(x, y, z);
      if (inRegion[i] && NB.some(([dx, dy, dz]) => isEmpty(x + dx, y + dy, z + dz))) frontier.push(i);
    }
    for (const i of frontier) mat[i] = m; // repaint the surface, bone kept
    for (let layer = 0; layer < shell.thick * g.level; layer++) {
      const grown = new Map(); // cell -> bone, first (lowest) source wins
      for (const i of frontier) {
        const x = i % gx, y = ((i / gx) | 0) % gy, z = (i / (gx * gy)) | 0;
        for (const [dx, dy, dz] of NB) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (inGrid(nx, ny, nz) && isEmpty(nx, ny, nz)) {
            const j = at(nx, ny, nz);
            if (!grown.has(j)) grown.set(j, bone[i]);
          }
        }
      }
      const cells = [...grown.keys()].sort((a, b) => a - b);
      for (const j of cells) { mat[j] = m; bone[j] = grown.get(j); }
      frontier = cells;
    }
  };
  for (const slot of SHELL_ORDER) {
    const pick = recipe[slot];
    if (!pick || hidden.has(slot)) continue;
    const shell = slotItems(kit, slot).find((i) => i.id === pick.id);
    const m = resolve(shell.paint, slot, pick);
    for (const g of grids) growShell(g, shell, m);
  }

  // ---- attachments (+ the elder overlay: every kit item of slot 'overlay', painted last)
  // layers of attachment `a` resampled from its authored level (a.res, default 1) to the grid level
  const resampled = new Map();
  const attAt = (a, level) => {
    const from = a.res || 1;
    if (from === level) return a;
    const key = a.id + '@' + level;
    let r = resampled.get(key);
    if (r) return r;
    if (level > from) { // nearest-cell upsample
      const f = level / from;
      const [bx, by, bz] = a.box;
      const layers = [];
      for (let z = 0; z < bz * f; z++) {
        const pl = [];
        for (let y = 0; y < by * f; y++) {
          let row = '';
          for (let x = 0; x < bx * f; x++) row += a.layers[(z / f) | 0][(y / f) | 0][(x / f) | 0];
          pl.push(row);
        }
        layers.push(pl);
      }
      r = { ...a, layers, box: [bx * f, by * f, bz * f] };
    } else {
      let layers = a.layers;
      for (let l = from; l > level; l /= 2) layers = downsample2(layers, kit.slots);
      r = { ...a, layers, box: [layers[0][0].length, layers[0].length, layers.length] };
    }
    resampled.set(key, r);
    return r;
  };
  const place = (a0, slot, pick) => {
    const g = gridOfBone.get(a0.bone) || main;
    const a = attAt(a0, g.level);
    const { mat, bone, at } = g;
    const [gx, gy, gz] = g.size;
    const anc = base.anchors[a.anchor];
    const ox = anc[0] + a.offset[0], oy = anc[1] + a.offset[1], oz = anc[2] + a.offset[2];
    const bi = boneIndex.get(a.bone);
    const lv = g.level, o1 = g.org1;
    for (let z = 0; z < a.box[2]; z++) for (let y = 0; y < a.box[1]; y++) for (let x = 0; x < a.box[0]; x++) {
      const ch = a.layers[z][y][x];
      if (isEmptyChar(ch)) continue;
      const cx = Math.round((ox - o1[0]) * lv + x), cy = Math.round((oy - o1[1]) * lv + y), cz = Math.round((oz - o1[2]) * lv + z);
      if (cx < 0 || cy < 0 || cz < 0 || cx >= gx || cy >= gy || cz >= gz) continue; // outside the grid/block: clipped (the kit build warns)
      const i = at(cx, cy, cz);
      if (a.paintOnly && !mat[i]) continue; // paintOnly never adds voxels
      mat[i] = resolve(ch, slot, pick);
      if (!a.paintOnly) bone[i] = bi;
    }
  };
  for (const slot of ATTACH_ORDER) {
    const pick = recipe[slot];
    if (!pick || hidden.has(slot)) continue;
    place(slotItems(kit, slot).find((i) => i.id === pick.id), slot, pick);
  }
  if (recipe.age === 'elder') for (const a of slotItems(kit, 'overlay')) place(a, 'overlay', null);

  const { mat, bone } = main;
  return {
    cellM: (kit.cellM ?? 0.025) / B,
    size: [sx, sy, sz],
    anchor: base.anchor.map((v) => v * B),
    mat, bone, matKeys,
    blocks: blocks.map((g) => ({ region: g.region, k: g.k, origin: g.origin.slice(), size: g.size.slice(), mat: g.mat, bone: g.bone })),
    bones: kit.skeleton.map((b) => ({ name: b.name, parent: b.parent ?? null, joint: base.bones[b.name] ? base.bones[b.name].joint.map((v) => v * B) : null })),
    mounts: JSON.parse(JSON.stringify(base.mounts || base.anchors || {})),
    clips: JSON.parse(JSON.stringify(kit.clips || {})),
    tempo: ageTempo(recipe), // clip speed factor (elder 1.15); the caller multiplies the clip time
  };
}
