// engine/chargen/rigModel.js (RIG-02b, docs/architecture.md 38.32 items 2-3): riggedModelDef(partRig, opts?) -> {voxel: RiggedVoxelDef}.
// Load-time, pure. Converts a collapseRig PartRig (metres from the anchor) to the mesh-local CELL space of the voxel model
// path: local = posM / cellM + G, G = -min(posM / cellM) per axis, so every coordinate is >= 0 and the anchor sits at G.
import { MAX_PARTS } from './collapse.js';

const OFF_GRID = 1e-3;
const round3 = (v) => Math.round(v * 1000) / 1000;

export function riggedModelDef(partRig, opts = {}) {
  const { cellM, parts, mesh } = partRig;
  if (parts.length > MAX_PARTS) throw new Error(`riggedModelDef: ${parts.length} parts, max ${MAX_PARTS}`);
  const nv = 4 * mesh.quads;
  const min = [Infinity, Infinity, Infinity];
  for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) { const c = mesh.pos[3 * i + a] / cellM; if (c < min[a]) min[a] = c; }
  const G = nv ? min.map((m) => round3(-m)) : [0, 0, 0];

  // snap vertices to the integer grid (throws when off-grid)
  const pos = new Float32Array(12 * mesh.quads);
  for (let i = 0; i < nv; i++) {
    for (let a = 0; a < 3; a++) {
      const c = mesh.pos[3 * i + a] / cellM + G[a];
      const r = Math.round(c);
      if (Math.abs(c - r) > OFF_GRID) throw new Error(`riggedModelDef: not a voxel-grid mesh (vertex ${i} axis ${a} is ${c.toFixed(4)} cells)`);
      pos[3 * i + a] = r;
    }
  }
  const size = [1, 1, 1];
  for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) size[a] = Math.max(size[a], pos[3 * i + a]);

  const defParts = {};
  parts.forEach((p, pi) => {
    const r = mesh.ranges[pi];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 4 * r.start; v < 4 * (r.start + r.count); v++) for (let a = 0; a < 3; a++) { const c = pos[3 * v + a]; if (c < lo[a]) lo[a] = c; if (c > hi[a]) hi[a] = c; }
    const pivot = p.pivotM.map((m, a) => m / cellM + G[a]);
    const box = r.count ? [lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]] : pivot.map(Math.round).concat(pivot.map(Math.round));
    const d = { box, pivot };
    if (p.parent >= 0) d.parent = parts[p.parent].name;
    defParts[p.name] = d;
  });

  // mounts: grid cells -> local; part = override, else the part of the bone whose joint is nearest (ties: skeleton order)
  const anchorCells = partRig.anchorCells || [0, 0, 0];
  const mounts = {};
  for (const [name, m] of Object.entries(partRig.mounts || {})) {
    let part = opts.mountParts && opts.mountParts[name];
    if (!part) {
      let best = Infinity;
      for (const b of partRig.boneJoints) {
        const d = (b.jointCells[0] - m[0]) ** 2 + (b.jointCells[1] - m[1]) ** 2 + (b.jointCells[2] - m[2]) ** 2;
        if (d < best) { best = d; part = b.part; }
      }
    }
    if (!(part in defParts)) throw new Error(`riggedModelDef: mount "${name}" part "${part}" is not a part`);
    mounts[name] = { at: m.map((c, a) => c - anchorCells[a] + G[a]), part };
  }

  return {
    voxel: {
      version: 1, cellM, size, anchor: G.slice(), mats: {}, layers: [], meshOnly: true,
      parts: defParts,
      animations: partRig.clips,
      mounts,
      rig: { quads: mesh.quads, pos, nrm: mesh.nrm, mat: mesh.mat, ranges: mesh.ranges, matKeys: partRig.matKeys.slice() },
    },
  };
}
