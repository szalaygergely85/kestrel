// game/js/quest/sim/regionalBeasts.js (WM-12). Data-driven beast herds/packs for the opened regions: NOT hand-placed, NOT in
// world json. `generateRegionalBeasts` is pure + deterministic (seeded; same seed + geo + terrain -> same ids/homes);
// `spawnRegionalBeasts(world, geo)` adds them to a loaded World BEFORE createBeastSim (slots follow entity order).
// Ids are stable `<species>.<region>.<n>` ('boar.downs.1'); quest.js kindOf() reads the leading lowercase run -> boar/wolf/bear.
// Tier comes from band.js at the home (createBeastSim band option), so nothing tier-related is stored here.
// Dormancy: homes are far from the player, so beastSim's WM-04 tile dormancy parks them (a dormant slot is skipped in step()).

/** Per-region rule. `rect` overrides the geo region rect (Whitecombs foot only); groups x size = count. */
export const REGION_RULES = Object.freeze([
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
]);

export const REGIONAL_BEAST_COUNT = REGION_RULES.reduce((n, r) => n + r.groups * r.size, 0);

import { WOLF_MODEL } from './wolfBrain.js';
export const MODEL = { boar: 'boarPlaceholder', wolf: WOLF_MODEL, bear: 'bearBlack', croc: 'crocodile' }; // BEAST-02: wolf packs use the real voxel_wolf model ('wolf')
export const BODY = { boar: { height: 0.7, radius: 0.45 }, wolf: { height: 0.7, radius: 0.45 }, bear: { height: 1.1, radius: 0.7 }, croc: { height: 0.5, radius: 0.7 } };
export const SPECIES_BEAST_KIND = { croc: 'river_crocodile' }; // brain.beastKind of species that are not the 3 legacy ones (kindOfEntity)
/** World_m1 beast nav rect in metres [x0,y0,x1,y1] (nav.area is in cells x cell 2): water slots outside it cannot init (initSwimmer) and would stay land crocs. */
export const WATER_NAV_AREA = Object.freeze([790, 860, 1700, 1840]);
export const CROC_DEEP_M = 0.6; // = beastNav.WATER_DEEP_M (mask 1)
// 32 literal unit directions (rule 15: no trig in sim code); same 2 rng draws per try as the old angle pick.
const DIRS = [[1,0],[0.980785,0.19509],[0.92388,0.382683],[0.83147,0.55557],[0.707107,0.707107],[0.55557,0.83147],[0.382683,0.92388],[0.19509,0.980785],[0,1],[-0.19509,0.980785],[-0.382683,0.92388],[-0.55557,0.83147],[-0.707107,0.707107],[-0.83147,0.55557],[-0.92388,0.382683],[-0.980785,0.19509],[-1,0],[-0.980785,-0.19509],[-0.92388,-0.382683],[-0.83147,-0.55557],[-0.707107,-0.707107],[-0.55557,-0.83147],[-0.382683,-0.92388],[-0.19509,-0.980785],[0,-1],[0.19509,-0.980785],[0.382683,-0.92388],[0.55557,-0.83147],[0.707107,-0.707107],[0.83147,-0.55557],[0.92388,-0.382683],[0.980785,-0.19509]];
const EDGE = 12, MIN_GROUP_GAP = 45, AUTHORED_GAP = 40, MAX_SLOPE = 0.3, TRIES = 600;

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
export function makeWalkable(terrain, bounds) {
  const e = 2;
  return (x, y) => {
    if (bounds && !inPolygon(bounds.pts, x, y)) return false;
    if (terrain.typeAt(x, y) === 2) return false; // TYPE_IDS.water
    const dx = (terrain.heightAt(x + e, y) - terrain.heightAt(x - e, y)) / (2 * e);
    const dy = (terrain.heightAt(x, y + e) - terrain.heightAt(x, y - e)) / (2 * e);
    return dx * dx + dy * dy <= MAX_SLOPE * MAX_SLOPE; // squared: no Math.hypot (rule 15)
  };
}

/**
 * @param {{geo:any, terrain:{heightAt:Function,typeAt:Function}, seed?:number, avoid?:Array<[number,number]>, water?:{deep:(x:number,y:number)=>boolean, area?:number[]}}} o
 *   geo = world_geo (regions, bounds); avoid = authored beast homes to keep AUTHORED_GAP clear of;
 *   water = BEAST-09a probe for `water` rules (deep(x,y) = deep water here, area = metres rect the home must lie in); absent -> water rules produce nothing.
 * @returns {Array<{id:string, species:string, region:string, x:number, y:number, group:number}>}
 */
export function generateRegionalBeasts(o) {
  const { geo, terrain } = o, seed = o.seed ?? 12, avoid = o.avoid || [];
  const walkable = makeWalkable(terrain, geo.bounds);
  const wat = o.water, wa = wat && wat.area;
  const deepHome = (x, y) => { // deep at the point and 1 m around it, so the 2 m mask cell holding it is mask 1 too
    if (!inPolygon(geo.bounds.pts, x, y) || (wa && !(x > wa[0] + 2 && x < wa[2] - 2 && y > wa[1] + 2 && y < wa[3] - 2))) return false;
    return wat.deep(x, y) && wat.deep(x + 1, y) && wat.deep(x - 1, y) && wat.deep(x, y + 1) && wat.deep(x, y - 1);
  };
  const out = [], centres = [];
  for (const rule of REGION_RULES) {
    const reg = geo.regions.find((g) => g.id === rule.region);
    if (!reg || (rule.water && !wat)) continue;
    const r = rule.rect || reg.r;
    const rng = mulberry32(seed ^ strHash(rule.key));
    let n = 0;
    for (let g = 0; g < rule.groups; g++) {
      let c = null;
      for (let t = 0; t < TRIES && !c; t++) {
        const x = Math.round((r[0] + EDGE + rng() * (r[2] - r[0] - 2 * EDGE)) * 2) / 2;
        const y = Math.round((r[1] + EDGE + rng() * (r[3] - r[1] - 2 * EDGE)) * 2) / 2;
        if (!(rule.water ? deepHome(x, y) : walkable(x, y))) continue;
        let clear = true;
        for (const p of centres) if ((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < MIN_GROUP_GAP * MIN_GROUP_GAP) { clear = false; break; }
        for (const p of avoid) if (clear && (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < AUTHORED_GAP * AUTHORED_GAP) clear = false;
        if (clear) c = [x, y];
      }
      if (!c) continue; // a region with no valid ground simply gets fewer groups (never an unwalkable home)
      centres.push(c);
      for (let k = 0; k < rule.size; k++) {
        let hx = c[0], hy = c[1];
        if (k > 0) { // members 3-7 m from the group centre; fall back to the centre if no walkable spot
          for (let t = 0; t < 40; t++) {
            const dir = DIRS[(rng() * 32) | 0], d = 3 + rng() * 4, x = Math.round((c[0] + dir[0] * d) * 2) / 2, y = Math.round((c[1] + dir[1] * d) * 2) / 2;
            if (x > r[0] && x < r[2] && y > r[1] && y < r[3] && (rule.water ? deepHome(x, y) : walkable(x, y))) { hx = x; hy = y; break; }
          }
        }
        out.push({ id: `${rule.species}.${rule.key}.${++n}`, species: rule.species, region: rule.region, x: hx, y: hy, group: g });
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

export function spawnRegionalBeasts(world, geo, seed, navArea) {
  const avoid = authoredHomes(world);
  const list = generateRegionalBeasts({ geo, terrain: world.terrain, seed, avoid, water: typeof world.waterAt === 'function' ? worldWaterProbe(world, navArea) : undefined });
  for (const b of list) {
    if (world.get(b.id)) continue; // WMP-09: a world restored from a save already holds the herd (saves keep all entities) - spawn only the missing ones
    const brain = { kind: 'beast', home: [b.x, b.y], temperament: 'wary' };
    if (SPECIES_BEAST_KIND[b.species]) brain.beastKind = SPECIES_BEAST_KIND[b.species]; // BEAST-09a: water slot via waterBrain (archetype medium 'water')
    else if (b.species !== 'boar') brain.species = b.species;
    world.spawn('beast', { x: b.x, y: b.y, z: world.terrain.heightAt(b.x, b.y) },
      { voxel: { anim: 'idle', loop: true, model: MODEL[b.species] }, brain, targetable: { ...BODY[b.species] } }, b.id);
  }
  return list;
}
