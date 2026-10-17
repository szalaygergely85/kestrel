// game/js/quest/sim/targetables.js (SPELL-01a1, docs/architecture.md 37.14). Shared SoA list of every entity with a
// `targetable` component (<= 16), rebuilt on load/add/remove (the 30.1 convention). `refresh()` copies the live
// positions once per step; an entity with `health.hp <= 0` gets `r = -1` and every query must skip `r < 0`.
export const MAX_TARGETABLES = 256; // OB-169: was 64 (OB-076: 16); world_m1 has 87. ONE source of truth for sword/targeting/targetables/fireball.
export const RESELECT_DIST = 8; // m the focus (player) must move before an overflowing list re-picks its nearest N

/** OB-169: preallocated nearest-N selector. `pick(all, fx, fy, outArr)` fills outArr with the `cap` entities nearest to
 *  (fx, fy) by insertion into scratch typed arrays (0 typed-array alloc; ties keep load order = deterministic). When
 *  all.length <= cap it is a plain copy in load order. Returns the count. */
export function createNearestSelector(cap) {
  const d = new Float64Array(cap), ix = new Int32Array(cap);
  return {
    cap,
    pick(all, fx, fy, out) {
      const n = all.length;
      out.length = 0;
      if (n <= cap) { for (let i = 0; i < n; i++) out.push(all[i]); return n; }
      let m = 0;
      for (let i = 0; i < n; i++) {
        const tr = all[i].transform, dx = tr.x - fx, dy = tr.y - fy, dd = dx * dx + dy * dy;
        if (m === cap && dd >= d[m - 1]) continue; // strict: equal distance keeps the earlier (load-order) entity
        let pos = m < cap ? m++ : cap - 1;
        while (pos > 0 && d[pos - 1] > dd) { d[pos] = d[pos - 1]; ix[pos] = ix[pos - 1]; pos--; }
        d[pos] = dd; ix[pos] = i;
      }
      for (let k = 0; k < m; k++) out.push(all[ix[k]]);
      return m;
    },
  };
}

/** @param {any} world @param {{on:(n:string,f:Function)=>()=>void}} events */
export function createTargetables(world, events) {
  const t = {
    count: 0,
    x: new Float64Array(MAX_TARGETABLES), y: new Float64Array(MAX_TARGETABLES), z: new Float64Array(MAX_TARGETABLES),
    r: new Float64Array(MAX_TARGETABLES), h: new Float64Array(MAX_TARGETABLES),
    /** @type {any[]} */ ent: [],
    /** OB-169: overflow only - re-pick the nearest MAX_TARGETABLES around (x, y) once the focus moved RESELECT_DIST. */
    setFocus(x, y) {
      fx = x; fy = y;
      if (all.length <= MAX_TARGETABLES) return;
      const dx = x - selX, dy = y - selY;
      if (dx * dx + dy * dy < RESELECT_DIST * RESELECT_DIST) return;
      reselect();
      t.refresh();
    },
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
  let all = [], fx = 0, fy = 0, selX = 0, selY = 0;
  const sel = createNearestSelector(MAX_TARGETABLES);
  function reselect() {
    selX = fx; selY = fy;
    sel.pick(all, fx, fy, t.ent);
    t.count = t.ent.length;
  }
  function rebuild() {
    all = [];
    world.forEachEntity((e) => { if (e.components && e.components.targetable) all.push(e); });
    if (all.length > MAX_TARGETABLES) console.warn(`createTargetables: ${all.length} targetables, keeping the ${MAX_TARGETABLES} nearest.`);
    reselect();
    t.refresh();
  }
  rebuild();
  const offA = events.on('entity:added', rebuild);
  const offR = events.on('entity:removed', rebuild);
  return t;
}
