// R6d (architecture.md 38.60, D-075 step 5): quality preset -> tree card impostors on the running instance groups.
// Game-side glue only: the bake (engine/mesh/impostorBake.js) and the group opt-in (enableGroupImpostor) are engine code.
// Called from the OB-109 loading-bar pre-bake (bake once per mesh id, cached) and again on a Settings quality change (cheap: no re-bake).
import { bakeImpostor, enableGroupImpostor, resolveGroupLod1, createInstanceBuffer } from '../../../engine/index.js';

export const IMPOSTOR_BUDGET_BYTES = 2 * 1024 * 1024; // 38.60 item 3: <= 2 MB of atlases in total
const cache = new Map(); // mesh id -> imp (baked) | null (skipped: over budget / no source mesh)
let cacheBytes = 0;

export function resetImpostorCache() { cache.clear(); cacheBytes = 0; }
export function impostorCacheBytes() { return cacheBytes; }

/** Mesh ids of the species that opted in (`impostor: true`), from a trees.species list. */
export function impostorSpecies(species) {
  return (species || []).filter((s) => s && s.impostor === true && typeof s.mesh === 'string').map((s) => s.mesh);
}

const groupMeshId = (g) => (g.mesh && (g.mesh.id || g.mesh.name)) || g.modelKey || '';
const matches = (id, want) => id === want || id.endsWith('/' + want) || want.endsWith('/' + id);

/**
 * @param {{instances:{groups:any[],_meshLookup?:any}}|{engine:any}} world the engine (or an object holding it as `.engine`)
 * @param {{impM:number, impMaxDistM:number}} knobs preset knobs (gfxPresets); impM 0 = off (medium/low)
 * @param {{species?:any[], log?:(m:string)=>void, budget?:number, deps?:object}} [opts] species = trees.species rows
 * @returns {{on:boolean, groups:number, baked:number, skipped:number, bytes:number}}
 */
export function applyImpostorPreset(world, knobs, opts = {}) {
  const eng = world && world.engine ? world.engine : world, log = opts.log || (() => {}), budget = opts.budget ?? IMPOSTOR_BUDGET_BYTES;
  const d = { bakeImpostor, enableGroupImpostor, resolveGroupLod1, createInstanceBuffer, ...(opts.deps || {}) };
  const groups = (eng && eng.instances && eng.instances.groups) || [];
  const on = !!knobs && knobs.impM > 0 && knobs.impMaxDistM > knobs.impM;
  const want = impostorSpecies(opts.species);
  const out = { on, groups: 0, baked: 0, skipped: 0, bytes: cacheBytes };
  for (const g of groups) {
    if (!g.mesh) continue;
    if (!on) { if (g.imp) { g.impM = 0; if (g._impBaseMaxDistM !== undefined) g.maxDistM = g._impBaseMaxDistM; } continue; } // restore the group's own cut (arch fix R6d) // off: byte-identical frame (impM 0), the atlas stays cached
    const id = groupMeshId(g);
    if (!want.some((w) => matches(id, w))) continue;
    let imp = cache.get(id);
    if (imp === undefined) {
      const src = d.resolveGroupLod1(g, eng.instances._meshLookup) || g.mesh;
      const data = src && (src.data || src);
      const est = data && data.triCount > 0 ? 86016 : 0; // IMP_BYTES per species (38.60 item 3)
      if (!est) { cache.set(id, null); log(`impostor: ${id} skipped (no source mesh)`); }
      else if (cacheBytes + est > budget) { cache.set(id, null); log(`impostor: ${id} skipped (over ${budget} B budget)`); }
      else { imp = d.bakeImpostor(data); cache.set(id, imp); cacheBytes += imp.bytes.length; out.baked++; }
      imp = cache.get(id);
    }
    if (!imp) { out.skipped++; continue; }
    if (g._impBaseMaxDistM === undefined) g._impBaseMaxDistM = g.maxDistM; // group's own cut, kept for the off path
    if (!g.imp) d.enableGroupImpostor(g, imp, knobs.impM, d.createInstanceBuffer);
    g.impM = knobs.impM;
    g.maxDistM = knobs.impMaxDistM; // 38.60 item 4: the card is drawn out to maxDistM (cut runs first)
    out.groups++;
  }
  out.bytes = cacheBytes;
  return out;
}

// R6-WIRE: boot + Settings glue. `?imp=0` forces impM 0 (bench), `?imp=1` is the normal enable path (preset knobs decide).
let remembered = { species: [], log: undefined, imp: null, knobs: null };

/** Pure: preset knobs, with impM zeroed when the `imp` URL param is '0'. */
export function impostorKnobs(knobs, impParam) {
  if (!knobs) return knobs;
  return impParam === '0' ? { ...knobs, impM: 0 } : knobs;
}

/** Boot call (after the OB-109 pre-bake): remembers species/log/imp param for later quality changes, then applies once. */
export function applyImpostorBoot(engine, knobs, { species, log, imp, deps } = {}) {
  remembered = { species: species || [], log, imp: imp ?? null, knobs: knobs || null, deps };
  return applyImpostorPreset(engine, impostorKnobs(knobs, remembered.imp), { species: remembered.species, log, deps });
}

/** Settings quality change: same call with the new preset's knobs (cache hit, no re-bake). No-op before boot applied once. */
export function reapplyImpostorPreset(engine, knobs) {
  if (!remembered.species.length) return null;
  remembered.knobs = knobs || null;
  return applyImpostorPreset(engine, impostorKnobs(knobs, remembered.imp), { species: remembered.species, log: remembered.log, deps: remembered.deps });
}

/** R6-WIRE: re-created groups (world:scatter / world:loaded) get the remembered knobs back (cache hit, no re-bake). */
export function reapplyRememberedImpostors(engine) {
  if (!remembered.species.length || !remembered.knobs) return null;
  return applyImpostorPreset(engine, impostorKnobs(remembered.knobs, remembered.imp), { species: remembered.species, log: remembered.log, deps: remembered.deps });
}
