// ENV-01a2 (37.4). Load-time master words; camera-local, allocation-free feed.
import { createInstanceBuffer, writeUnitInstance, touchInstances, INSTANCE_STRIDE, INST_FLAGS, INST_OBJECT_ID,
  MAX_INSTANCE_GROUPS, MAX_INSTANCES_PER_FRAME } from './instances.js';
import { resolveGfxKnobs, keepPlacement } from './gfxKnobs.js';
import { INST_FLAG_SWAY } from './sway.js';
import { vegTintObjectId } from './vegTint.js';

export const DETAIL_OBJECT_BASE = 0x40000;

/** @param {{scatterDensity?:number, lodScale?:number, tuftDrawScale?:number}} [gfx] GFX-03 knobs (gfxKnobs.js), defaults = unchanged */
export function bindDetailInstances(detail, instances, cfg, treeInstances = 0, gfx = undefined, meshes = null) {
  const knobs = resolveGfxKnobs(gfx);
  const maxDraw = cfg.maxDraw ?? 768, refeedM = cfg.refeedM ?? 4;
  if (!Number.isInteger(maxDraw) || maxDraw <= 0 || treeInstances + maxDraw > MAX_INSTANCES_PER_FRAME) {
    throw new Error(`bindDetailInstances: detail.maxDraw exceeds ${MAX_INSTANCES_PER_FRAME} with trees`);
  }
  if (!Number.isFinite(refeedM) || refeedM <= 0) throw new Error('bindDetailInstances: detail.refeedM');
  const counts = new Uint32Array(detail.speciesDefs.length);
  const keep = knobs.scatterDensity < 1 ? new Uint8Array(detail.count) : null; // GFX-03: thinned by a per-placement hash (null = keep all)
  let maxR2 = 0;
  for (let i = 0; i < detail.count; i++) {
    if (keep) { if (!keepPlacement(detail.x[i], detail.y[i], i, knobs.scatterDensity)) continue; keep[i] = 1; }
    counts[detail.species[i]]++;
    if (detail.r2[i] > maxR2) maxR2 = detail.r2[i];
  }
  const renderKeys = new Map(), defs = [], groupCounts = [];
  const groupOf = new Uint8Array(counts.length).fill(255);
  for (let s = 0; s < counts.length; s++) {
    if (!counts[s]) continue;
    const def = detail.speciesDefs[s];
    if (def.mesh !== undefined) { // TREES-LP-c: kind-9 mesh species (World.load resolved it into world.detailMeshes)
      if (!meshes?.[def.mesh]) throw new Error(`bindDetailInstances: unresolved mesh ${def.mesh}`);
    } else if (!instances.pool?.models.has(def.model)) throw new Error(`bindDetailInstances: missing voxel model ${def.model}`);
    const key = (def.mesh !== undefined ? 'mesh:' + def.mesh : def.model) + '|' + def.shadow + '|' + def.lodCells;
    let g = renderKeys.get(key);
    if (g === undefined) {
      g = defs.length;
      renderKeys.set(key, g); defs.push(def); groupCounts.push(0);
    }
    groupOf[s] = g; groupCounts[g] += counts[s];
  }
  if (instances.groups.length + defs.length > MAX_INSTANCE_GROUPS) {
    throw new Error(`bindDetailInstances: detail.layers needs ${defs.length} deduped groups (${instances.groups.length + defs.length} total), over ${MAX_INSTANCE_GROUPS} groups`);
  }
  let maxDrawM = Math.sqrt(maxR2);
  for (const layer of cfg.layers || []) maxDrawM = Math.max(maxDrawM, layer.drawM);
  const drawScale = knobs.tuftDrawScale;
  maxDrawM *= drawScale;
  // One extra tile covers an eye anywhere inside its tile, including corners.
  const extent = Math.ceil(maxDrawM / detail.tileM) + 1, offsets = [];
  for (let dy = -extent; dy <= extent; dy++) {
    for (let dx = -extent; dx <= extent; dx++) offsets.push({ dx, dy, d2: dx * dx + dy * dy });
  }
  offsets.sort((a, b) => a.d2 - b.d2 || a.dy - b.dy || a.dx - b.dx);
  const offsetX = new Int32Array(offsets.length), offsetY = new Int32Array(offsets.length);
  for (let i = 0; i < offsets.length; i++) { offsetX[i] = offsets[i].dx; offsetY[i] = offsets[i].dy; }
  const master = createInstanceBuffer(detail.count), groups = [];
  for (let g = 0; g < defs.length; g++) {
    const def = defs[g], cap = Math.min(groupCounts[g], maxDraw);
    const group = def.mesh !== undefined ? instances.meshGroup(meshes[def.mesh], cap) : instances.group(def.model, cap);
    if (def.mesh === undefined) group.lodCells = def.lodCells / knobs.lodScale; // GFX-03; mesh groups: no LOD yet (37.15 item 6)
    group.castShadow = def.shadow;
    groups.push(group);
  }
  for (let i = 0; i < detail.count; i++) {
    if (keep && !keep[i]) continue;
    writeUnitInstance(master, i, detail.x[i], detail.y[i], detail.z[i], detail.yawDeg[i], DETAIL_OBJECT_BASE | i, 0);
    // FOLIAGE-SWAY-01 part 2: per-species sway bit, OR'd in after writeUnitInstance (keeps aligned/team bits already written).
    // feedDetail copies every word (incl. INST_FLAGS) verbatim per frame, so the bit survives the per-frame re-feed for free.
    if (detail.speciesDefs[detail.species[i]].sway) {
      master.u32[i * INSTANCE_STRIDE + INST_FLAGS] |= INST_FLAG_SWAY;
      // AUD-47: vegetation (= swaying species) gets a deterministic colour tint in the objectId (vegTint.js), computed once here
      master.u32[i * INSTANCE_STRIDE + INST_OBJECT_ID] = vegTintObjectId(DETAIL_OBJECT_BASE | i, i, detail.x[i], detail.y[i]);
    }
  }
  touchInstances(master); // one bump for the whole batch of raw-word ORs above (writeUnitInstance already bumped per changed row)
  return { detail, groups, groupOf, master, offsetX, offsetY, maxDraw, keep, drawR2Scale: drawScale * drawScale,
    maxDrawR2: maxDrawM * maxDrawM, refeedR2: refeedM * refeedM, lastX: NaN, lastY: NaN, fed: 0 };
}

export function feedDetail(binding, eyeX, eyeY, force = false) {
  const movedX = eyeX - binding.lastX, movedY = eyeY - binding.lastY;
  if (!force && movedX * movedX + movedY * movedY < binding.refeedR2) return binding.fed;
  const d = binding.detail, tileM = d.tileM;
  const eyeTx = Math.floor(eyeX / tileM), eyeTy = Math.floor(eyeY / tileM);
  const src = binding.master.u32, groups = binding.groups, keep = binding.keep, r2Scale = binding.drawR2Scale;
  for (let g = 0; g < groups.length; g++) groups[g].count = 0;
  let fed = 0;
  for (let o = 0; o < binding.offsetX.length; o++) {
    const tx = eyeTx + binding.offsetX[o], ty = eyeTy + binding.offsetY[o];
    const x = tx - d.tx0, y = ty - d.ty0;
    if (x < 0 || y < 0 || x >= d.tilesX || y >= d.tilesY) continue;
    const x0 = tx * tileM, y0 = ty * tileM;
    const dx = Math.max(x0 - eyeX, 0, eyeX - (x0 + tileM));
    const dy = Math.max(y0 - eyeY, 0, eyeY - (y0 + tileM));
    if (dx * dx + dy * dy >= binding.maxDrawR2) continue;
    const tile = y * d.tilesX + x;
    for (let i = d.tileStart[tile]; i < d.tileStart[tile + 1]; i++) {
      if (keep && !keep[i]) continue;
      const px = d.x[i] - eyeX, py = d.y[i] - eyeY;
      if (px * px + py * py >= d.r2[i] * r2Scale) continue;
      const group = groups[binding.groupOf[d.species[i]]], dst = group.ib.u32;
      const from = i * INSTANCE_STRIDE, to = group.count * INSTANCE_STRIDE;
      for (let word = 0; word < INSTANCE_STRIDE; word++) dst[to + word] = src[from + word];
      group.count++; fed++;
      if (fed === binding.maxDraw) break;
    }
    if (fed === binding.maxDraw) break;
  }
  for (let g = 0; g < groups.length; g++) touchInstances(groups[g].ib); // WG-4b(c): raw row copies above -> version bump (shadow dirty-skip)
  binding.lastX = eyeX; binding.lastY = eyeY; binding.fed = fed;
  return fed;
}

export function removeDetailInstances(binding, instances) {
  if (!binding) return;
  for (const group of binding.groups) instances.remove(group);
}
