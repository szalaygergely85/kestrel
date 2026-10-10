// QUEST-MARK-01w: quest '!' marker wire. Reads hooks.questObjective() (targets = ids from sim/questMarkers.js), keeps ONE
// marker per target id, and drives pop -> active -> fade through a host-supplied entity factory. Owner rule: the '!' fades
// the moment the quest is TAKEN (the target leaves the list); it never comes back because targets derive from quest state.
// host = { fx (ASSETS.questMarkFx), resolve(id, out)->bool (fills out.x,y,z = marker base), create()->handle, enabled?:bool,
//   source?(out) (QG-04: fills out.done + out.targets; default = hooks.questObjective()) }
// handle = { hidden:boolean, scale:number, anim:string, setPos(x,y,z) }. Zero allocation per tick after a target's first sight.
const ST_HIDDEN = 0, ST_POP = 1, ST_ACTIVE = 2, ST_FADE = 3;

function curve(c, t, floor) { // piecewise-linear [ms, v] curve, no allocation
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (t <= c[i][0]) { const a = c[i - 1], b = c[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); }
  }
  const v = c[c.length - 1][1]; return v < floor ? floor : v;
}

export function createQuestMarks(hooks, host) {
  const fx = host.fx, rec = new Map(), pos = { x: 0, y: 0, z: 0 }, src = { done: false, id: '', targets: null };
  const read = host.source ? () => { src.done = false; src.targets = null; host.source(src); return src; } : () => hooks.questObjective();
  const range2 = fx.visibleRangeM * fx.visibleRangeM;
  let tickNo = 0, ctxRef = null;

  function record(id) {
    let r = rec.get(id);
    if (!r) { r = { id, h: null, st: ST_HIDDEN, t: 0, seen: 0, x: 0, y: 0, z: 0, ok: false }; rec.set(id, r); }
    return r;
  }
  function start(r) {
    r.ok = host.resolve(r.id, pos); if (!r.ok) return;
    r.x = pos.x; r.y = pos.y; r.z = pos.z;
    if (!r.h) r.h = host.create();
    r.h.setPos(r.x, r.y, r.z);
    r.st = ST_POP; r.t = 0; r.h.anim = fx.clipFor.appear; r.h.hidden = false; r.h.scale = fx.popScale[0][1];
  }

  return {
    get active() { let n = 0; for (const r of rec.values()) if (r.st !== ST_HIDDEN) n++; return n; },
    /** Boot/reload: drop visible state, the next tick rebuilds from the quest state (no double spawn: entities are reused per id). */
    onBoot(ctx) {
      ctxRef = ctx;
      for (const r of rec.values()) { r.st = ST_HIDDEN; if (r.h) r.h.hidden = true; }
    },
    onTick(dt) {
      const q = read(), tg = q.done ? null : q.targets, ms = dt * 1000;
      tickNo++;
      if (tg) for (let i = 0; i < tg.length; i++) {
        const r = record(tg[i]); r.seen = tickNo;
        if (r.st === ST_HIDDEN) start(r);
      }
      const pl = ctxRef && ctxRef.player && ctxRef.player.transform;
      for (const r of rec.values()) {
        if (r.st === ST_HIDDEN) continue;
        const h = r.h;
        if (r.seen !== tickNo && r.st !== ST_FADE) { r.st = ST_FADE; r.t = 0; h.anim = fx.clipFor.complete; }
        r.t += ms;
        // MARK-FOLLOW-01 (owner: the mark stayed behind when Burl walked): re-resolve the target every tick so marks follow moving NPCs (zero alloc: shared pos).
        if (host.resolve(r.id, pos) && (pos.x !== r.x || pos.y !== r.y || pos.z !== r.z)) { r.x = pos.x; r.y = pos.y; r.z = pos.z; h.setPos(r.x, r.y, r.z); }
        if (r.st === ST_POP) {
          h.scale = curve(fx.popScale, r.t, 0.05);
          if (r.t >= fx.popMs) { r.st = ST_ACTIVE; h.scale = 1; h.anim = fx.clipFor.active; }
        } else if (r.st === ST_FADE) {
          h.scale = curve(fx.fadeScale, r.t, 0.05);
          if (r.t >= fx.fadeMs) { r.st = ST_HIDDEN; h.hidden = true; continue; }
        }
        if (pl) { const dx = pl.x - r.x, dy = pl.y - r.y, dz = pl.z - r.z; h.hidden = dx * dx + dy * dy + dz * dz > range2; }
      }
    },
  };
}

/** Registers the wire on the seam; returns unregister(). Registers nothing in capture/bench/?save=0 modes (host.enabled === false). */
export function registerQuestMarks(hooks, host) {
  if (host.enabled === false) return () => {};
  const w = createQuestMarks(hooks, host);
  return hooks.register({ onBoot: w.onBoot, onTick: w.onTick });
}
