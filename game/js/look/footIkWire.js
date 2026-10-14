// ANIM-IK-01b (B1-MAIN hooks 3): game wiring of the foot-placement planner (engine createFootIk) for split-leg kit characters.
// After VoxelPool.collect: every queued instance whose packed model has a legRig and an entity gets a footIk slot; clip feet are read on the
// legs-null pose, io is filled, update() runs and the LegPose goes to pool.legInstance. `?footik=0` / capture = never created (today's poses).
export function resolveFootIk(params, isCaptureOrBench) { return params.get('footik') !== '0' && !isCaptureOrBench; }

/**
 * deps: {pool, createFootIk, voxelPointWorld, footCells (per leg [x,y,z] cells, e.g. HUMANOID_SPLIT_LEG_RIG foot of the def), ground ({groundAt}),
 * offFor(entity) -> true while airborne/swimming}. step(dtMs) once per rendered frame.
 */
export function createFootIkWire(deps) {
  const { pool, voxelPointWorld, footCells, ground, offFor } = deps;
  const drv = deps.createFootIk(8), slots = new Map(), pt = new Float64Array(3);
  let frameNo = 0;
  return {
    drv,
    step(dtMs) {
      frameNo++;
      const n = pool._rawCount;
      for (let i = 0; i < n; i++) {
        const inst = pool.raw[i], pm = inst.model, ent = inst.entity;
        if (!pm || !pm.legRig || !ent || pm.legRig.n !== footCells.length) continue; // kit rigs only: D-101 animals (4 legs) have their own leg drivers
        let rec = slots.get(ent);
        if (!rec || rec.pm !== pm) {
          if (rec) drv.release(rec.slot);
          rec = { slot: drv.attach(pm), pm, stamp: 0 }; slots.set(ent, rec);
        }
        if (rec.slot < 0) continue;
        rec.stamp = frameNo;
        const io = drv.io, lr = pm.legRig, saved = inst.legs;
        inst.legs = null; // clip feet on the authored pose
        for (let k = 0; k < lr.n; k++) {
          const c = footCells[k];
          voxelPointWorld(pm, inst, lr.lower[k], c[0], c[1], c[2], pt);
          io[6 + 3 * k] = pt[0]; io[7 + 3 * k] = pt[1]; io[8 + 3 * k] = pt[2];
        }
        inst.legs = saved;
        io[0] = inst.x; io[1] = inst.y; io[2] = inst.z; io[3] = inst.yawDeg; io[4] = dtMs; io[5] = offFor && offFor(ent) ? 1 : 0;
        drv.update(rec.slot, pm, ground);
        const pose = drv.poseOf(rec.slot);
        if (pose[0] > 0) pool.legInstance(i, pose);
      }
      for (const [ent, rec] of slots) if (rec.stamp !== frameNo) { drv.release(rec.slot); slots.delete(ent); }
    },
  };
}
