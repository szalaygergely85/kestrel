// tools/export/mixamoPose.js (OB-070): T-pose a rest-pose RiggedModel for Mixamo's auto-rigger.
// The kit stands with arms hanging; Mixamo wants T- or A-pose. Each arm chain (UpperArm, LowerArm, Hand, found by bone name) is rotated
// 90 degrees about the UpperArm joint, in authoring axes (x right, y front = -y, z up), so the arms point sideways (left -x, right +x).
// Returns a new model (pos/nrm copied, the rest untouched); bones/joints are NOT updated (the Mixamo FBX is static, no skeleton).
export function tposeModel(model) {
  const { bones, mesh } = model;
  const pos = Float32Array.from(mesh.pos), nrm = Float32Array.from(mesh.nrm);
  for (const side of ['Left', 'Right']) {
    const sgn = side === 'Left' ? -1 : 1;
    const up = bones.find((b) => b.name === side + 'UpperArm');
    if (!up) throw new Error('tposeModel: no ' + side + 'UpperArm bone');
    const [px, , pz] = up.joint;
    for (const part of ['UpperArm', 'LowerArm', 'Hand']) {
      const i = bones.findIndex((b) => b.name === side + part);
      if (i < 0) throw new Error('tposeModel: no ' + side + part + ' bone');
      const r = mesh.ranges[i], first = r.start ?? r.first ?? r.offset ?? 0;
      for (let v = 4 * first; v < 4 * (first + r.count); v++) {
        const o = 3 * v;
        const dx = pos[o] - px, dz = pos[o + 2] - pz;
        // down (0,-1) -> outward (sgn,0); a quarter turn about y
        pos[o] = px + sgn * -dz; pos[o + 2] = pz + sgn * dx;
        const nx = nrm[o], nz = nrm[o + 2];
        nrm[o] = sgn * -nz; nrm[o + 2] = sgn * nx;
      }
    }
  }
  return { ...model, mesh: { ...mesh, pos, nrm } };
}
