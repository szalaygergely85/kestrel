#!/usr/bin/env node
// tools/reach-check.mjs (QL-B2 follow-up): every quest area centre and every quest giver / pickup entity must lie inside the
// world walk bounds (static, fast; used by quest-sim + a test). `--walk` also walks a seek-walker from the tower meadow to each
// point on the real mesh physics (slow, ~1 min). Usage: node tools/reach-check.mjs [--walk] [--json]
import { readFileSync } from 'node:fs';

const R = 0.3; // player capsule radius
// Ch2 scenery that is outside the M1 walk bounds by design (footpath north of the ford, MAP-25); not a quest objective.
const ALLOW = new Set(['hiddenScrawl', 'sealedGate']) // sealedGate: West Fells pass, outside the M4 walk bounds by design (Part II);
// Signed distance past the walk bound for a capsule body (<= 0 inside). Local copy of engine/physics/bounds.js (circle / capsule / union;
// tools may not deep-import the engine). A polygon bound is not supported here.
function partOver(p, x, y, rad) {
  if (p.shape === 'circle') return Math.hypot(x - p.x, y - p.y) - (p.r - rad);
  if (p.shape === 'capsule') {
    const dx = p.bx - p.ax, dy = p.by - p.ay, t = Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - p.ax - t * dx, y - p.ay - t * dy) - (p.r - rad);
  }
  throw new Error('reach-check: unsupported bounds shape ' + p.shape);
}
const boundsOvershoot = (b, x, y, rad) => (b.shape === 'union' ? Math.min(...b.parts.map((p) => partOver(p, x, y, rad))) : partOver(b, x, y, rad));
const rd = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

/** Returns [{kind,id,x,y,over}] for every point that is outside the walk bounds. */
export function staticReach(world = rd('../content/worlds/world_m1.world.json'), areas = rd('../content/quests/areas.json').areas) {
  const pts = [];
  for (const [id, a] of Object.entries(areas)) {
    if (a.world !== 'world_m1' || !a.trigger) continue;
    const t = world.triggers.find((q) => q.id === a.trigger || q.key === 'world.' + a.trigger);
    if (!t) { pts.push({ kind: 'area', id, x: NaN, y: NaN, over: Infinity, missing: true }); continue; }
    pts.push({ kind: 'area', id, x: t.x, y: t.y, r: t.r });
  }
  for (const e of world.entities || []) {
    const q = e.components && e.components.questPickup;
    if ((q || e.type === 'npc' || e.components?.inspect) && e.transform == null && e.x !== undefined) pts.push({ kind: q ? 'pickup' : 'giver', id: e.id, x: e.x, y: e.y });
    else if (q && e.transform) pts.push({ kind: 'pickup', id: e.id, x: e.transform.x, y: e.transform.y });
  }
  const bad = [];
  for (const p of pts) {
    p.over = p.missing ? Infinity : boundsOvershoot(world.bounds, p.x, p.y, R);
    if (!(p.over <= 0) && !ALLOW.has(p.id)) bad.push(p);
  }
  return { points: pts, bad };
}


// ---- --walk: seek-walker on the real mesh physics (same step order as tools/route-walk.mjs) from the tower meadow.
const ROAD = [[1470, 1029], [1428, 1040], [1420, 1032], [1350, 1050], [1270, 1042], [1180, 1062], [1090, 1070], [1046, 1069]];
async function walkReach(points, worldDef) {
  globalThis.window = globalThis.window || globalThis;
  for (const m of ['palette', 'detail-pass', 'levels/overworld_far', 'levels/world_geo']) await import(`../design/${m}.js`);
  globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
  for (const m of ['lantern', 'lever', 'voxel_props', 'voxel_tower', 'voxel_world', 'boulder', 'rubble', 'wreckage', 'relay', 'sword', 'voxel_beast', 'chest', 'm3_props', 'far_tower', 'ferrum_lights', 'title', 'voxel_bear', 'voxel_wildlife', 'voxel_tower_crown']) { try { await import(`../design/models/${m}.js`); } catch { /* optional */ } }
  const E = { ...(await import('../engine/index.js')), Events: (await import('../engine/dev.js')).Events }, { loadTestAssets } = await import('./testing/content-node.mjs');
  const { assets } = await loadTestAssets();
  const P = E.PHYSICS_DEFAULTS, DT = P.fixedDt;
  const world = E.World.load(worldDef, assets, { physics: 'mesh', events: new E.Events() });
  const player = { id: 'probe', type: 'player', transform: { x: 1470, y: 1029, z: 0, yawDeg: 0, pitchDeg: 0 },
    components: { body: { radius: P.radius, height: P.height, eyeH: P.eyeHeight, vx: 0, vy: 0, vz: 0, grounded: true, coyote: 0, buffer: 0, jumpHeldPrev: false, peakZ: 0 } } };
  const controls = { forward: 1, strafe: 0, run: true, jump: false, yawDeg: 0 };
  const tr = player.transform, b = player.components.body;
  const stones = worldDef.structures.filter((q) => /^fordS[0-9]+$/.test(q.id)).sort((p, q) => q.origin.x - p.origin.x).map((q) => [q.origin.x, q.origin.y]);
  const fords = [...stones, [1010, 1069], [998, 1075]];
  const res = [];
  for (const p of points) {
    world.ensureBandFor?.(1470, 1029);
    tr.x = 1470; tr.y = 1029; tr.z = world.floorAt(1470, 1029) + 0.3; b.vx = b.vy = b.vz = 0; b.grounded = true; b.peakZ = tr.z;
    // road prefix up to the road point nearest the target (west bank: the whole road + ford stones), then straight in
    let k = 0, bd = Infinity; ROAD.forEach((r, i) => { const d = Math.hypot(r[0] - p.x, r[1] - p.y); if (d < bd) { bd = d; k = i; } });
    const wps = ROAD.slice(1, k + 1); if (p.x < 1040) wps.push(...fords);
    wps.push([p.x, p.y]);
    let ok = true, steps = 0;
    for (const [wx, wy] of wps) {
      let best = Infinity, bestAt = 0, bias = 0, biasLeft = 0, tries = 0;
      for (let n = 0; ; n++) {
        const dx = wx - tr.x, dy = wy - tr.y, d = Math.hypot(dx, dy);
        if (d < (wx === p.x && wy === p.y ? (p.kind === 'area' ? Math.max(1, (p.r || 3) - 0.8) : 2.5) : 0.6)) break;
        if (n > 3000) { ok = false; break; }
        if (d < best - 0.3) { best = d; bestAt = n; }
        if (biasLeft <= 0 && n - bestAt > 60) { tries++; bias = (tries % 2 ? 1 : -1) * 50 * Math.ceil(tries / 2); biasLeft = 45; bestAt = n; }
        if (biasLeft > 0) biasLeft--; else bias = 0;
        controls.yawDeg = Math.atan2(dx, -dy) * 180 / Math.PI + bias;
        controls.jump = false;
        E.stepSectorAnims(world, DT); E.integrate(player, DT, controls, world, P); E.stepRollers(world, DT, P);
        E.stepAnimations(world, DT * 1000); E.resolveBodyContacts(world, player, P); world.streamBand?.(tr.x, tr.y, 2); steps++;
      }
      if (!ok) break;
    }
    res.push({ ...p, reached: ok, steps, end: { x: +tr.x.toFixed(1), y: +tr.y.toFixed(1) } });
  }
  return res;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('reach-check.mjs')) {
  const r = staticReach();
  if (process.argv.includes('--walk')) {
    const walked = await walkReach(r.points.filter((p) => !ALLOW.has(p.id) && p.over <= 0 && p.kind !== 'pickup' || p.kind === 'pickup' && p.over <= 0), rd('../content/worlds/world_m1.world.json'));
    for (const w of walked) { console.log((w.reached ? 'ok   ' : 'STUCK') + ` ${w.kind} ${w.id} (${w.x}, ${w.y}) ${w.steps} steps, end ${w.end.x},${w.end.y}`); if (!w.reached) process.exitCode = 1; }
  }
  for (const b of r.bad) console.error(`UNREACHABLE ${b.kind} ${b.id} (${b.x}, ${b.y}) outside walk bounds by ${b.over.toFixed(1)} m`);
  console.log(`${r.points.length} quest point(s) checked, ${r.bad.length} outside the walk bounds`);
  if (r.bad.length) process.exitCode = 1;
}
