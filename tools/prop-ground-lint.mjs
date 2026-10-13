// tools/prop-ground-lint.mjs (OB-059/OB-060): lists placed meshes that float above the ground or poke out of a steep slope.
//   node tools/prop-ground-lint.mjs [--world world_m1] [--all]   exit 1 if a checked prop is found (default: struts/beams/planks/wagons/crates only)
// float = lowest vertex of the placed mesh is > FLOAT_M above terrain.groundAt under that vertex;
// steep = prop sits on ground whose slope across its footprint is > STEEP_DEG (a beam through a slope looks stuck in the air).
import { pathToFileURL } from 'node:url';
import { World } from '../engine/index.js';
import { getAssets } from './coplanar-lint.mjs';

export const FLOAT_M = 0.15, STEEP_DEG = 20;
// deliberate: reviewed pieces that the rules flag (id -> why)
export const ALLOW = {
  poi072: 'ruin tie beam spans the room at wall-top height (MAP-23 roof deck)',
  poi073: 'second ruin tie beam, same as poi072',
  rs049: 'jetty plank sunk 0.85 m into the bank, only its end shows',
};
export const CHECKED = /Prop_Support|Roof_Support|Prop_Wagon|Prop_Crate|Prop_Barrel|Roof_Log|Floor_Wood|Wall_BottomCover|Plank|Beam/;

/** Checks one placed mesh; returns null (ok) or {kind, float, slopeDeg, minZ}. */
export function checkProp(s, mesh, groundAt, supports = []) {
  const sc = s.scale || 1, a = ((s.yawDeg || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), o = s.origin, p = mesh.pos;
  let lowest = Infinity, gMin = Infinity, gMax = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * sc, y = p[i + 1] * sc, z = p[i + 2] * sc + o.z, wx = c * x - sn * y + o.x, wy = sn * x + c * y + o.y;
    const g = groundAt(wx, wy), d = z - g;
    if (d < lowest) lowest = d;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
  }
  const ext = Math.max(x1 - x0, y1 - y0, 0.5), slopeDeg = (Math.atan2(gMax - gMin, ext) * 180) / Math.PI;
  const kinds = [];
  // a piece resting on another placed mesh (stacked crate, roof beam on a wall) is supported: some other box under its footprint whose top is within 0.3 m below its lowest vertex
  const base = lowestZ(p, sc, o.z), supported = supports.some((b) => b.id !== s.id && b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0 && base - b.z1 < 0.3 && base - b.z1 > -0.6);
  if (lowest > FLOAT_M && !supported) kinds.push('float');
  if (slopeDeg > STEEP_DEG) kinds.push('steep');
  return kinds.length ? { kind: kinds.join('+'), float: +lowest.toFixed(2), slopeDeg: +slopeDeg.toFixed(0) } : null;
}

function lowestZ(p, sc, oz) { let m = Infinity; for (let i = 2; i < p.length; i += 3) if (p[i] < m) m = p[i]; return m * sc + oz; }
/** World-space boxes of placed meshes (support candidates; trees/plants excluded). */
export function supportBoxes(structs, meshes) {
  const out = [];
  for (const s of structs) {
    const m = s.mesh && meshes[s.mesh];
    if (!m || !m.pos || m.lazy || /Tree|Pine|Bush|Grass|Fern|Plant|Flower|Clover|Mushroom|Pebble/.test(s.mesh)) continue;
    const sc = s.scale || 1, a = ((s.yawDeg || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), p = m.pos;
    const b = { id: s.id, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * sc, y = p[i + 1] * sc, wx = c * x - sn * y + s.origin.x, wy = sn * x + c * y + s.origin.y, z = p[i + 2] * sc + s.origin.z;
      if (wx < b.x0) b.x0 = wx; if (wx > b.x1) b.x1 = wx; if (wy < b.y0) b.y0 = wy; if (wy > b.y1) b.y1 = wy; if (z > b.z1) b.z1 = z;
    }
    out.push(b);
  }
  return out;
}
export async function lintWorld(worldId = 'world_m1', all = false) {
  // the ground the game shows = overworld_far + installed geography/river carving (main.js, every gen-*.mjs); coplanar-lint's loader lacks it
  globalThis.window = globalThis.window || globalThis;
  await import('../design/palette.js'); await import('../design/levels/overworld_far.js'); await import('../design/levels/world_geo.js');
  globalThis.ASSETS.levels.world_geo.util.installGeo(globalThis.ASSETS.levels.overworld_far.util);
  const { bundle, assets } = await getAssets();
  const w = World.load(assets.world(worldId), assets, { physics: 'mesh' });
  const g = (x, y) => w.terrain.groundAt(x, y), out = [], structs = bundle.worlds[worldId].structures || [], sup = supportBoxes(structs, bundle.meshes);
  for (const s of bundle.worlds[worldId].structures || []) {
    if (!s.mesh || (!all && !CHECKED.test(s.mesh))) continue;
    const m = bundle.meshes[s.mesh];
    if (!m || !m.pos || m.lazy) continue;
    w.ensureBandFor(s.origin.x, s.origin.y); // fine terrain band (the far/coarse height is metres off)
    if (ALLOW[s.id]) continue;
    const r = checkProp(s, m, g, sup);
    if (r) out.push({ id: s.id, mesh: s.mesh, x: s.origin.x, y: s.origin.y, z: s.origin.z, ...r });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--world');
  const res = await lintWorld(i > 0 ? process.argv[i + 1] : 'world_m1', process.argv.includes('--all'));
  for (const r of res) console.log(`${r.kind.padEnd(11)} ${r.id.padEnd(10)} ${r.mesh.padEnd(34)} (${r.x}, ${r.y}, ${r.z}) float ${r.float} m, slope ${r.slopeDeg} deg`);
  console.log(`prop-ground-lint: ${res.length} floating/steep prop(s)`);
  process.exit(res.length ? 1 : 0);
}
