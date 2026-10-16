// VISQA-21/24: pure pose / entity pickers for tools/visqa-sweep.mjs. No imports, no closures: each function is also injected into the
// page as source via `${fn}` (so keep them self-contained). Node tests: tools/visqa-pick.test.mjs.

/** VISQA-21: scan a (2D) neighbourhood of (x,y) for the steepest slope and return a camera pose looking up at it.
 * h(x,y) -> height or null. Returns {x,y,z,yaw,pitch,slope,face:{x,y}} or null. yaw 0 = north (-y), 90 = east (as the sweep spots). */
export function pickCliffPose(h, x, y, radius, back, eye) {
  radius = radius || 60; back = back || 12; eye = eye || 1.6;
  let best = null;
  for (let dy = -radius; dy <= radius; dy += 2) for (let dx = -radius; dx <= radius; dx += 2) {
    const cx = x + dx, cy = y + dy, e = 2;
    const a = h(cx + e, cy), b = h(cx - e, cy), c = h(cx, cy + e), d = h(cx, cy - e);
    if (a == null || b == null || c == null || d == null) continue;
    const gx = (a - b) / (2 * e), gy = (c - d) / (2 * e), s = Math.hypot(gx, gy);
    if (!best || s > best.s) best = { s, cx, cy, gx, gy };
  }
  if (!best || best.s < 0.5) return null;
  const n = best.s, ux = best.gx / n, uy = best.gy / n; // uphill unit vector
  // face foot = go downhill until the slope relaxes (<0.3) or 10 m; camera `back` m further downhill
  let fx = best.cx, fy = best.cy;
  for (let t = 0; t < 10; t += 1) {
    const px = best.cx - ux * t, py = best.cy - uy * t, a = h(px + 1, py), b = h(px - 1, py), c = h(px, py + 1), d = h(px, py - 1);
    if (a == null || b == null || c == null || d == null) break;
    if (Math.hypot(a - b, c - d) / 2 < 0.3) break;
    fx = px; fy = py;
  }
  const camx = fx - ux * back, camy = fy - uy * back, gc = h(camx, camy), gf = h(fx, fy), gt = h(best.cx + ux * 4, best.cy + uy * 4);
  if (gc == null || gf == null || gt == null) return null;
  const aim = (gf + gt) / 2, pitch = Math.atan2(aim - (gc + eye), Math.hypot(fx - camx, fy - camy)) * 180 / Math.PI;
  return { x: camx, y: camy, z: gc, yaw: ((Math.atan2(ux, -uy) * 180 / Math.PI) % 360 + 360) % 360, pitch, slope: best.s, face: { x: fx, y: fy } };
}

/** VISQA-24: exact entity pick. entities: array (may contain holes); spec {kind?, id?}. kind matches brain.beastKind (or, when none is set, the
 * legacy species map wolf->grey_wolf) or the voxel model id by whole token (wolf_grey / grey-wolf yes, "skeleton_wolf_bones" no if it holds skel).
 * Returns {entity,index,model} or null (caller logs 'no <name> in range' and fails loudly). */
export function pickEntity(entities, spec) {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i]; if (!e || !e.transform) continue;
    const c = e.components || {}, br = c.brain, model = String((c.voxel && c.voxel.model) || '');
    if (spec.id != null) { if (e.id === spec.id) return { entity: e, index: i, model }; continue; }
    if (/skel|bone|undead/i.test(model)) continue;
    const species = br && br.species, bk = br && br.beastKind;
    const kindOk = bk ? bk === spec.kind || bk === 'grey_' + spec.kind : species === spec.kind;
    const modelOk = !bk && !species && model.toLowerCase().split(/[^a-z0-9]+/).includes(spec.kind);
    if (kindOk || modelOk) return { entity: e, index: i, model };
  }
  return null;
}
