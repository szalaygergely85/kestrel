// game/js/quest/sim/targetables.js (SPELL-01a1, docs/architecture.md 37.14). Shared SoA list of every entity with a
// `targetable` component (<= 16), rebuilt on load/add/remove (the 30.1 convention). `refresh()` copies the live
// positions once per step; an entity with `health.hp <= 0` gets `r = -1` and every query must skip `r < 0`.
export const MAX_TARGETABLES = 16;

/** @param {any} world @param {{on:(n:string,f:Function)=>()=>void}} events */
export function createTargetables(world, events) {
  const t = {
    count: 0,
    x: new Float64Array(MAX_TARGETABLES), y: new Float64Array(MAX_TARGETABLES), z: new Float64Array(MAX_TARGETABLES),
    r: new Float64Array(MAX_TARGETABLES), h: new Float64Array(MAX_TARGETABLES),
    /** @type {any[]} */ ent: [],
    refresh() {
      const n = t.count;
      for (let i = 0; i < n; i++) {
        const e = t.ent[i], tr = e.transform, tg = e.components.targetable, hp = e.components.health;
        t.x[i] = tr.x; t.y[i] = tr.y; t.z[i] = tr.z;
        t.r[i] = hp && hp.hp <= 0 ? -1 : tg.radius;
        t.h[i] = tg.height;
      }
    },
    dispose() { offA(); offR(); },
  };
  function rebuild() {
    const all = [];
    world.forEachEntity((e) => { if (e.components && e.components.targetable) all.push(e); });
    if (all.length > MAX_TARGETABLES) console.warn(`createTargetables: ${all.length} targetables, only ${MAX_TARGETABLES} usable.`);
    t.ent = all.slice(0, MAX_TARGETABLES);
    t.count = t.ent.length;
    t.refresh();
  }
  rebuild();
  const offA = events.on('entity:added', rebuild);
  const offR = events.on('entity:removed', rebuild);
  return t;
}
