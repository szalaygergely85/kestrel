// game/js/quest/sim/regionalBeasts.js (WM-12). Data-driven beast herds/packs for the opened regions: NOT hand-placed, NOT in
// world json. `generateRegionalBeasts` is pure + deterministic (seeded; same seed + geo + terrain -> same ids/homes);
// `spawnRegionalBeasts(world, geo)` adds them to a loaded World BEFORE createBeastSim (slots follow entity order).
// Ids are stable `<species>.<region>.<n>` ('boar.downs.1'); quest.js kindOf() reads the leading lowercase run -> boar/wolf/bear.
// Tier comes from band.js at the home (createBeastSim band option), so nothing tier-related is stored here.
// Dormancy: homes are far from the player, so beastSim's WM-04 tile dormancy parks them (a dormant slot is skipped in step()).

/** Per-region rule. `rect` overrides the geo region rect (Whitecombs foot only); groups x size = count. */
export const REGION_RULES = Object.freeze([
  // OB-153: placed first so the rare kinds find ground before the OB-185 filler crowds the region
  { region: 'alpine', key: 'highPasturesWhite', species: 'whitewolf', groups: 3, size: 3, slope: 0.6 },
  { region: 'whitecombs', key: 'whitecombsCave', species: 'cavebear', groups: 2, size: 1, slope: 0.6, rect: [0, 0, 2048, 330] },
  { region: 'glasswater', key: 'glasswater', species: 'boar', groups: 1, size: 3 },
  { region: 'northwood', key: 'northwood', species: 'wolf', groups: 1, size: 4 },
  { region: 'alpine', key: 'highPastures', species: 'bear', groups: 2, size: 1 },
  { region: 'ashMile', key: 'ashMile', species: 'boar', groups: 1, size: 2 },
  { region: 'downs', key: 'downs', species: 'boar', groups: 2, size: 3 },
  { region: 'signalHill', key: 'signalHill', species: 'wolf', groups: 1, size: 3 },
  { region: 'westHeath', key: 'heath', species: 'boar', groups: 1, size: 3 },
  { region: 'reedmire', key: 'reedmire', species: 'boar', groups: 2, size: 2 },
  { region: 'whitecombs', key: 'whitecombsFoot', species: 'bear', groups: 2, size: 1, rect: [0, 200, 2048, 330] },
  // BEAST-09a: river crocodiles (ep-bestiary row croc: ford, river, reedmire). `water`: homes on deep water (mask-1 cells) inside the nav area; skipped when no water probe is given.
  // The river has no own region id in world_geo (it is the 'heartland' fallback north of the ford), so its rule carries a rect over the deep reach x 1000-1050, y 900-1050; rect trimmed to it.
  { region: 'ford', key: 'ford', species: 'croc', groups: 1, size: 1, water: true },
  { region: 'heartland', key: 'river', species: 'croc', groups: 1, size: 1, water: true, rect: [970, 880, 1090, 1030] },
  { region: 'reedmire', key: 'reedmireWater', species: 'croc', groups: 2, size: 1, water: true },
  // strand: none (open beach, ambient fauna only)
  // OB-185: density floor 50 enemies/km2 per region (more in forests). Extra groups (key suffix keeps ids/rng streams apart).
  { region: 'whitecombs', key: 'whitecombsBears', species: 'bear', groups: 6, size: 2, slope: 0.6, rect: [0, 0, 2048, 330] },
  { region: 'whitecombs', key: 'whitecombsWolves', species: 'wolf', groups: 5, size: 3, slope: 0.6, rect: [0, 0, 2048, 330] },
  { region: 'westFells', key: 'westFells', species: 'wolf', groups: 8, size: 3 },
  { region: 'northwood', key: 'northwoodPack', species: 'wolf', groups: 2, size: 4 },
  { region: 'glasswater', key: 'glasswaterBoars', species: 'boar', groups: 2, size: 3 },
  { region: 'glasswater', key: 'glasswaterWolves', species: 'wolf', groups: 1, size: 3 },
  { region: 'alpine', key: 'highPasturesBears', species: 'bear', groups: 3, size: 2, slope: 0.6 },
  { region: 'alpine', key: 'highPasturesWolves', species: 'wolf', groups: 3, size: 3, slope: 0.6 },
  { region: 'thornwood', key: 'thornwood', species: 'wolf', groups: 2, size: 3 },
  { region: 'downs', key: 'downsMore', species: 'boar', groups: 2, size: 2 },
  { region: 'reedmire', key: 'reedmireMore', species: 'boar', groups: 3, size: 2 },
  { region: 'strand', key: 'strand', species: 'boar', groups: 1, size: 2 },
  { region: 'heartland', key: 'heartlandBoars', species: 'boar', groups: 1, size: 3 },
  { region: 'heartland', key: 'heartlandWolves', species: 'wolf', groups: 2, size: 3, rect: [0, 330, 1000, 1700] },
  // OB-153: fantasy bestiary. species = id prefix (letters only), KIND_OF[species] = kinds.json kind (brain.beastKind). Replaces some boars/wolves above.
  { region: 'downs', key: 'downsDeer', species: 'deer', groups: 2, size: 3 },
  { region: 'downs', key: 'downsFox', species: 'fox', groups: 2, size: 1 },
  { region: 'heartland', key: 'heartlandDeer', species: 'deer', groups: 2, size: 3 },
  { region: 'heartland', key: 'heartlandFox', species: 'fox', groups: 2, size: 2 },
  { region: 'glasswater', key: 'glasswaterDeer', species: 'deer', groups: 1, size: 3 },
  { region: 'northwood', key: 'northwoodFox', species: 'fox', groups: 2, size: 2 },
  { region: 'reedmire', key: 'reedmireTurtle', species: 'turtle', groups: 2, size: 2 },
  { region: 'strand', key: 'strandTurtle', species: 'turtle', groups: 1, size: 2 },
  { region: 'alpine', key: 'highPasturesGoats', species: 'goat', groups: 2, size: 2, slope: 0.6 },
  { region: 'whitecombs', key: 'whitecombsGoats', species: 'goat', groups: 2, size: 3, slope: 0.6, rect: [0, 0, 2048, 330] },
  { region: 'whitecombs', key: 'whitecombsWhite', species: 'whitewolf', groups: 3, size: 3, slope: 0.6, rect: [0, 0, 2048, 330] },
  { region: 'westFells', key: 'westFellsArchers', species: 'archer', groups: 2, size: 2 },
  { region: 'thornwood', key: 'thornwoodShaman', species: 'shaman', groups: 1, size: 2 },
  { region: 'thornwood', key: 'thornwoodTorch', species: 'torch', groups: 1, size: 2 },
  { region: 'westHeath', key: 'westHeathChief', species: 'chief', groups: 1, size: 1 },
  { region: 'northwood', key: 'northwoodLynx', species: 'lynx', groups: 2, size: 2 },
  { region: 'westFells', key: 'westFellsLynx', species: 'lynx', groups: 1, size: 2 },
  { region: 'downs', key: 'downsAurochs', species: 'aurochs', groups: 1, size: 4 },
  { region: 'heartland', key: 'heartlandAurochs', species: 'aurochs', groups: 1, size: 3 },
]);

/** OB-185: species of the roadside groups per region (default boar). Roads get a group wherever the walk would go > ROAD_GAP m without one. */
export const ROAD_SPECIES = Object.freeze({ whitecombs: 'wolf', westFells: 'wolf', northwood: 'wolf', thornwood: 'wolf', alpine: 'wolf', signalHill: 'wolf' });
export const ROAD_SLOPE = 0.85, ROAD_GAP = 140, COVER_R = 60, SAFE_R = 40, GROUP_GAP = 120;
/** Fixed safe spots [x, y, r] besides npc/relay/post entities: the tower interior + start meadow. */
export const FIXED_SAFE = Object.freeze([[1497, 1027, 70]]);

export const REGIONAL_BEAST_COUNT = REGION_RULES.reduce((n, r) => n + r.groups * r.size, 0);

import { WOLF_MODEL } from './wolfBrain.js';
import { UNDER_SITES, CEMETERY_TIER } from './underSkeletons.js'; // UNDER-01
export const MODEL = { boar: 'boarPlaceholder', wolf: WOLF_MODEL, bear: 'bearBlack', croc: 'crocodile', deer: 'deer', fox: 'fox', turtle: 'tortoise', goat: 'goat', whitewolf: WOLF_MODEL, cavebear: 'bearBlack', archer: 'goblin', shaman: 'goblin', chief: 'goblin', torch: 'goblinTorch', skelwar: 'skeleton', skelarch: 'skeletonArcher', lynx: 'lynx', aurochs: 'aurochs' }; // BEAST-02: wolf packs use the real voxel_wolf model ('wolf')
export const BODY = { boar: { height: 0.7, radius: 0.45 }, wolf: { height: 0.7, radius: 0.45 }, bear: { height: 1.1, radius: 0.7 }, croc: { height: 0.5, radius: 0.7 },
  deer: { height: 1.2, radius: 0.5 }, fox: { height: 0.6, radius: 0.35 }, turtle: { height: 0.5, radius: 0.5 }, goat: { height: 0.9, radius: 0.45 }, whitewolf: { height: 0.8, radius: 0.5 }, cavebear: { height: 1.3, radius: 0.8 }, archer: { height: 1.0, radius: 0.4 }, shaman: { height: 1.0, radius: 0.4 }, chief: { height: 1.3, radius: 0.5 }, torch: { height: 1.0, radius: 0.4 }, skelwar: { height: 1.8, radius: 0.35 }, skelarch: { height: 1.8, radius: 0.35 }, lynx: { height: 0.8, radius: 0.45 }, aurochs: { height: 1.5, radius: 0.8 } };
/** OB-153: id-prefix species -> kinds.json kind for the non-legacy species (boar/wolf/bear keep their legacy brains). */
export const KIND_OF = Object.freeze({ deer: 'red_deer', fox: 'fox', turtle: 'snapping_turtle', goat: 'mountain_goat', whitewolf: 'white_wolf', cavebear: 'cave_bear', archer: 'goblin_archer', shaman: 'goblin_shaman', chief: 'goblin_chief', torch: 'goblin_torch_bearer', skelwar: 'skeleton_warrior', skelarch: 'skeleton_archer', lynx: 'lynx', aurochs: 'aurochs' });
export const SPECIES_BEAST_KIND = { croc: 'river_crocodile' }; // brain.beastKind of species that are not the 3 legacy ones (kindOfEntity)
/** World_m1 beast nav rect in metres [x0,y0,x1,y1] (nav.area is in cells x cell 2): water slots outside it cannot init (initSwimmer) and would stay land crocs. */
export const WATER_NAV_AREA = Object.freeze([790, 860, 1700, 1840]);
export const CROC_DEEP_M = 0.6; // = beastNav.WATER_DEEP_M (mask 1)
// 32 literal unit directions (rule 15: no trig in sim code); same 2 rng draws per try as the old angle pick.
const DIRS = [[1,0],[0.980785,0.19509],[0.92388,0.382683],[0.83147,0.55557],[0.707107,0.707107],[0.55557,0.83147],[0.382683,0.92388],[0.19509,0.980785],[0,1],[-0.19509,0.980785],[-0.382683,0.92388],[-0.55557,0.83147],[-0.707107,0.707107],[-0.83147,0.55557],[-0.92388,0.382683],[-0.980785,0.19509],[-1,0],[-0.980785,-0.19509],[-0.92388,-0.382683],[-0.83147,-0.55557],[-0.707107,-0.707107],[-0.55557,-0.83147],[-0.382683,-0.92388],[-0.19509,-0.980785],[0,-1],[0.19509,-0.980785],[0.382683,-0.92388],[0.55557,-0.83147],[0.707107,-0.707107],[0.83147,-0.55557],[0.92388,-0.382683],[0.980785,-0.19509]];
const EDGE = 12, AUTHORED_GAP = 40, MAX_SLOPE = 0.3, TRIES = 600;

function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Even-odd point-in-polygon over [[x,y],...]. */
export function inPolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Walkable ground: inside the bounds polygon (EDGE m clear of it is the caller's job via the rect), not water, gentle slope. */
export function makeWalkable(terrain, bounds, maxSlope = MAX_SLOPE) {
  const e = 2;
  return (x, y) => {
    if (bounds && !inPolygon(bounds.pts, x, y)) return false;
    if (terrain.typeAt(x, y) === 2) return false; // TYPE_IDS.water
    const dx = (terrain.heightAt(x + e, y) - terrain.heightAt(x - e, y)) / (2 * e);
    const dy = (terrain.heightAt(x, y + e) - terrain.heightAt(x, y - e)) / (2 * e);
    return dx * dx + dy * dy <= maxSlope * maxSlope; // squared: no Math.hypot (rule 15)
  };
}

/**
 * @param {{geo:any, terrain:{heightAt:Function,typeAt:Function}, seed?:number, avoid?:Array<[number,number]>, water?:{deep:(x:number,y:number)=>boolean, area?:number[]}}} o
 *   geo = world_geo (regions, bounds); avoid = authored beast homes to keep AUTHORED_GAP clear of;
 *   water = BEAST-09a probe for `water` rules (deep(x,y) = deep water here, area = metres rect the home must lie in); absent -> water rules produce nothing.
 * @returns {Array<{id:string, species:string, region:string, x:number, y:number, group:number}>}
 */
export function generateRegionalBeasts(o) {
  const { geo, terrain } = o, seed = o.seed ?? 12, avoid = o.avoid || [], safe = o.safe || FIXED_SAFE;
  const wat = o.water, wa = wat && wat.area;
  const deepHome = (x, y) => { // BEAST-09a: deep at the point and 1 m around it, so the 2 m mask cell holding it is mask 1 too
    if (!inPolygon(geo.bounds.pts, x, y) || (wa && !(x > wa[0] + 2 && x < wa[2] - 2 && y > wa[1] + 2 && y < wa[3] - 2))) return false;
    return wat.deep(x, y) && wat.deep(x + 1, y) && wat.deep(x - 1, y) && wat.deep(x, y + 1) && wat.deep(x, y - 1);
  };
  const walkable = makeWalkable(terrain, geo.bounds), walkRoad = makeWalkable(terrain, geo.bounds, ROAD_SLOPE); // roads climb: roadside groups accept slopes up to ROAD_SLOPE
  const out = [], centres = [], wcentres = [], nextGroup = {}, nextWGroup = {}, G2 = GROUP_GAP * GROUP_GAP;
  const regionAt = (x, y) => { for (const g of geo.regions) if (x >= g.r[0] && x < g.r[2] && y >= g.r[1] && y < g.r[3]) return g.id; return geo.regions[geo.regions.length - 1].id; };
  const nearSafe = (x, y) => { for (const s of safe) { const d = SAFE_R + (s[2] || 0); if ((s[0] - x) * (s[0] - x) + (s[1] - y) * (s[1] - y) < d * d) return true; } return false; };
  const clearOfW = (x, y) => { for (const p of wcentres) if ((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < 40 * 40) return false; return true; };
  const clearOf = (x, y) => { // group gap to other regional groups + authored gap + safe spots/givers
    for (const p of centres) if ((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < G2) return false;
    for (const p of avoid) if ((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < AUTHORED_GAP * AUTHORED_GAP) return false;
    return !nearSafe(x, y);
  };
  const emit = (rule, region, r, c, rng, n0) => { // members 3-7 m from the group centre; fall back to the centre if no walkable spot
    const ng = rule.water ? nextWGroup : nextGroup, g = ng[region] || 0; ng[region] = g + 1; (rule.water ? wcentres : centres).push(c); // BEAST-09a: crocs never shift land groups (land list is the same with or without a water probe)
    let n = n0;
    for (let k = 0; k < rule.size; k++) {
      let hx = c[0], hy = c[1];
      if (k > 0) {
        for (let t = 0; t < 40; t++) {
          const dir = DIRS[(rng() * 32) | 0], d = 3 + rng() * 4, x = Math.round((c[0] + dir[0] * d) * 2) / 2, y = Math.round((c[1] + dir[1] * d) * 2) / 2;
          if (x > r[0] && x < r[2] && y > r[1] && y < r[3] && (rule.water ? deepHome(x, y) : walkable(x, y)) && !nearSafe(x, y)) { hx = x; hy = y; break; }
        }
      }
      out.push({ id: `${rule.species}.${rule.key}.${++n}`, species: rule.species, region, x: hx, y: hy, group: g });
    }
    return n;
  };
  for (const rule of REGION_RULES) {
    const reg = geo.regions.find((g) => g.id === rule.region);
    if (!reg || (rule.water && !wat)) continue;
    const r = rule.rect || reg.r;
    const rng = mulberry32(seed ^ strHash(rule.key)), wk = rule.slope ? makeWalkable(terrain, geo.bounds, rule.slope) : walkable;
    let n = 0;
    for (let g = 0; g < rule.groups; g++) {
      let c = null;
      for (let t = 0; t < TRIES && !c; t++) {
        const x = Math.round((r[0] + EDGE + rng() * (r[2] - r[0] - 2 * EDGE)) * 2) / 2;
        const y = Math.round((r[1] + EDGE + rng() * (r[3] - r[1] - 2 * EDGE)) * 2) / 2;
        if (!(rule.water ? deepHome(x, y) : wk(x, y)) || (!rule.water && regionAt(x, y) !== rule.region) || !(rule.water ? clearOfW(x, y) : clearOf(x, y))) continue;
        c = [x, y];
      }
      if (!c) continue; // a region with no valid ground simply gets fewer groups (never an unwalkable home)
      n = emit(rule, rule.region, r, c, rng, n);
    }
  }
  // OB-185: roadside groups. Walk every road every 10 m; a point is covered when any home is within COVER_R. After ROAD_GAP m uncovered, put a pair
  // 25-50 m beside the road (both sides tried, deterministic order). All homes so far (authored + generated) count as cover.
  const homes = avoid.slice(); let landCount = 0; for (const o2 of out) if (o2.species !== 'croc') { homes.push([o2.x, o2.y]); landCount++; }
  const covered = (x, y) => { for (const p of homes) if ((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < COVER_R * COVER_R) return true; return false; };
  const roadN = {};
  for (const road of geo.roads || []) {
    let run = 0, px = null, py = null;
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const a = road.pts[i], b = road.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len;
      for (let s = 0; s < len; s += 10) {
        const x = a[0] + ux * s, y = a[1] + uy * s;
        if (!inPolygon(geo.bounds.pts, x, y)) { run = 0; continue; }
        if (px !== null) run += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        px = x; py = y;
        if (covered(x, y)) { run = 0; continue; }
        if (run < ROAD_GAP) continue;
        const region = regionAt(x, y); if (region === 'east') continue;
        let c = null;
        for (let k = 0; k < 8 && !c; k++) { // lateral offsets 25..50 m, alternating sides
          const off = (25 + (k >> 1) * 8) * (k & 1 ? -1 : 1), cx = Math.round((x - uy * off) * 2) / 2, cy = Math.round((y + ux * off) * 2) / 2;
          if (walkRoad(cx, cy) && clearOf(cx, cy)) c = [cx, cy];
        }
        if (!c) { continue; }
        const sp = ROAD_SPECIES[region] || 'boar', key = 'road' + region[0].toUpperCase() + region.slice(1);
        const rule = { species: sp, key, size: sp === 'boar' ? 2 : 3 };
        const rg = (geo.regions.find((q) => q.id === region) || {}).r || [0, 0, 2048, 2048];
        roadN[key] = emit(rule, region, rg, c, mulberry32(seed ^ strHash(key + landCount)), roadN[key] || 0);
        homes.push(c); landCount += rule.size; run = 0;
      }
    }
  }
  return out;
}

/** Add the generated beasts to a loaded World (before createBeastSim). Returns the list. */
export const GENERATED_ID = /^[A-Za-z]+\.[A-Za-z]+\.\d+$/; // regional herd '<species>.<key>.n' and far-camp members 'gobF.<key>.n'

/** Homes of AUTHORED beasts only (never generated ids): the generators are pure in (geo, terrain, seed, authored homes), so a world restored from a save regenerates the same defs. */
export function authoredHomes(world) {
  const avoid = [];
  world.forEachEntity((e) => { const b = e.components && e.components.brain; if (b && b.kind === 'beast' && b.home && !GENERATED_ID.test(String(e.id))) avoid.push([b.home[0], b.home[1]]); });
  return avoid;
}

/** BEAST-09a: deep-water probe over World.waterAt (depth >= 0.6 m = water-mask cell 1). */
export function worldWaterProbe(world, area = WATER_NAV_AREA) {
  const q = { surfaceZ: 0, flatZ: 0, depth: 0, region: '', index: 0, look: 0 };
  return { area, deep: (x, y) => !!world.waterAt(x, y, q) && q.depth >= CROC_DEEP_M };
}

/** OB-185: [x, y, r] of npcs / givers / relays (waystones) / the post, plus FIXED_SAFE; regional groups keep SAFE_R clear of them. */
export function safeSpots(world) {
  const out = FIXED_SAFE.slice();
  world.forEachEntity((e) => { const t = e.transform || e; if (typeof t.x === 'number' && (e.type === 'npc' || /^(relay|post|nest|warden|hesk|dorrin|rook|notePost)/.test(String(e.id)))) out.push([t.x, t.y, 0]); });
  return out;
}

export function spawnRegionalBeasts(world, geo, seed, navArea) {
  const avoid = authoredHomes(world);
  const list = generateRegionalBeasts({ geo, terrain: world.terrain, seed, avoid, safe: safeSpots(world), water: typeof world.waterAt === 'function' ? worldWaterProbe(world, navArea) : undefined });
  for (const b of list) {
    if (world.get(b.id)) continue; // WMP-09: a world restored from a save already holds the herd (saves keep all entities) - spawn only the missing ones
    const brain = { kind: 'beast', home: [b.x, b.y], temperament: 'wary' };
    const bk = SPECIES_BEAST_KIND[b.species] || KIND_OF[b.species]; // BEAST-09a croc water slot (waterBrain) / OB-153 kinds
    if (bk) brain.beastKind = bk; else if (b.species !== 'boar') brain.species = b.species;
    world.spawn('beast', { x: b.x, y: b.y, z: world.terrain.heightAt(b.x, b.y) },
      { voxel: { anim: 'idle', loop: true, model: MODEL[b.species] }, brain, targetable: { ...BODY[b.species] } }, b.id);
  }
  spawnUnderSkeletons(world);
  return list;
}

/** UNDER-01 (OB-191): the cemetery trio (reserve group, woken at night by underSkeletons.createUnderSpawner) + the idle pair in one ruin. Not in the returned list (the director does not own them). */
export function spawnUnderSkeletons(world) {
  for (const site of UNDER_SITES) for (const m of site.members) {
    if (world.get(m[0])) continue; // restored from a save: already there
    const x = site.anchor[0] + m[2], y = site.anchor[1] + m[3], brain = { kind: 'beast', home: [x, y], temperament: 'wary' }; if (KIND_OF[m[1]]) brain.beastKind = KIND_OF[m[1]]; else brain.species = m[1]; // UNDER-04: legacy 'bear' keeps its brain.species
    if (site.night) { brain.group = site.group; brain.reserve = true; brain.tier = CEMETERY_TIER; }
    world.spawn('beast', { x, y, z: site.z !== undefined ? site.z : world.terrain.heightAt(x, y) }, { voxel: { anim: 'idle', loop: true, model: MODEL[m[1]] }, brain, targetable: { ...BODY[m[1]] } }, m[0]);
  }
}
