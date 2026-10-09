// D-050 / architecture 38: the one seam between main.js and game content (save relay, quest wiring, lane C's quest/chest/waystone hooks).
// main.js only calls boot / tick / event / drawHud / respawn here; handlers register themselves and never touch main.js.
// A handler is { onBoot(ctx), onTick(dt), onEvent(name, data), drawHud(ui), onRespawn() }; every key is optional.
// A throwing handler is isolated: warned about once per (handler, hook), then skipped for that hook. No allocation per call.
//
// ctx = { world, player, events, vitals, inventory, requestSave(), state } (one reused object, refreshed on every boot).
// `state` = { wakeDone, canSave, ending, interactPressed, interactRaw, playerYawDeg } is written by main.js each
// tick (facts a handler cannot derive from the world). `interactPressed` is the SAME gated E edge `updateInteraction`
// uses (false while ending/uiLocked - a handler must not open a new interactable while a menu/card/note is up);
// `interactRaw` is the ungated E edge (S8-B1-04: lets a handler's own modal, e.g. the item-get card, consume the
// E key to dismiss itself even though its own `isOpen` is what makes `interactPressed` false this same tick).
// Events (payloads are REUSED objects from payload(name): receivers copy what they keep):
//   area:entered {id}  prop:touched {id, kind, x, y, z}  beast:died {id}  item:got {id, n}  player:died {x, y, z}  flag:set {key, value}
// onRespawn() returns {x, y, z, yawDeg} or null; the first non-null wins (null = today's spawn / save point).

export const EVENT_NAMES = ['area:entered', 'prop:touched', 'beast:died', 'item:got', 'player:died', 'flag:set'];

const payloads = {
  'area:entered': { id: '' },
  'prop:touched': { id: '', kind: '', x: 0, y: 0, z: 0 },
  'beast:died': { id: '' },
  'item:got': { id: '', n: 1 },
  'player:died': { x: 0, y: 0, z: 0 },
  'flag:set': { key: '', value: null },
};

export function createGameHooks() {
  /** @type {{h:any, warned:Set<string>}[]} */
  let list = [];
  const ctx = { world: null, player: null, events: null, vitals: null, inventory: null, requestSave: null, state: { wakeDone: false, canSave: false, ending: false, interactPressed: false, interactRaw: false, playerYawDeg: 0 } };
  ctx.requestSave = () => { for (let i = 0; i < saveListeners.length; i++) saveListeners[i](); };
  const saveListeners = [];

  function fail(entry, key, e) {
    if (entry.warned.has(key)) return;
    entry.warned.add(key);
    console.warn('[gameHooks] handler threw in ' + key + ' (skipped from now on):', e && e.message ? e.message : e);
  }
  function active(entry, key) { return !entry.warned.has(key); }

  const api = {
    ctx,
    /** Registers a handler; returns unregister(). */
    register(handlers) {
      const entry = { h: handlers, warned: new Set() };
      list = list.concat(entry); // copy-on-write: safe to (un)register from inside a handler
      return () => { list = list.filter((x) => x !== entry); };
    },
    /** Where requestSave() ends up (main.js points it at the save relay). Returns an unsubscribe. */
    onSaveRequest(fn) { saveListeners.push(fn); return () => { const i = saveListeners.indexOf(fn); if (i >= 0) saveListeners.splice(i, 1); }; },
    /** Fills the reused payload of `name` from (a, b, c, d) and emits it. Field order: see the payload table above. */
    emitSimple(name, a, b, c) {
      const p = payloads[name];
      if (!p) return;
      if (name === 'flag:set') { p.key = a; p.value = b; }
      else if (name === 'item:got') { p.id = a; p.n = b === undefined ? 1 : b; }
      else if (name === 'player:died') { p.x = a; p.y = b; p.z = c; }
      else if (name === 'prop:touched') { p.id = a; p.kind = b; p.x = (c && c.x) || 0; p.y = (c && c.y) || 0; p.z = (c && c.z) || 0; } // c = {x,y,z}; missing/partial c -> 0,0,0
      else p.id = a;
      api.emit(name, p);
    },
    /** The reusable payload object for an event name (fill it, then emit(name, thatObject)). */
    payload(name) { return payloads[name] || null; },
    boot(world, player, events, vitals, inventory) {
      ctx.world = world; ctx.player = player; ctx.events = events; ctx.vitals = vitals; ctx.inventory = inventory;
      ctx.state.wakeDone = false; ctx.state.canSave = false; ctx.state.ending = false;
      ctx.state.interactPressed = false; ctx.state.interactRaw = false; ctx.state.playerYawDeg = 0;
      const l = list;
      for (let i = 0; i < l.length; i++) { const e = l[i]; if (e.h.onBoot && active(e, 'onBoot')) { try { e.h.onBoot(ctx); } catch (x) { fail(e, 'onBoot', x); } } }
    },
    tick(dt) {
      const l = list;
      for (let i = 0; i < l.length; i++) { const e = l[i]; if (e.h.onTick && active(e, 'onTick')) { try { e.h.onTick(dt); } catch (x) { fail(e, 'onTick', x); } } }
    },
    emit(name, data) {
      const l = list;
      for (let i = 0; i < l.length; i++) { const e = l[i]; if (e.h.onEvent && active(e, 'onEvent')) { try { e.h.onEvent(name, data); } catch (x) { fail(e, 'onEvent', x); } } }
    },
    drawHud(ui) {
      const l = list;
      for (let i = 0; i < l.length; i++) { const e = l[i]; if (e.h.drawHud && active(e, 'drawHud')) { try { e.h.drawHud(ui); } catch (x) { fail(e, 'drawHud', x); } } }
    },
    /** First non-null onRespawn() wins; null when nobody overrides. */
    respawn() {
      const l = list;
      for (let i = 0; i < l.length; i++) {
        const e = l[i];
        if (!e.h.onRespawn || !active(e, 'onRespawn')) continue;
        try { const r = e.h.onRespawn(); if (r) return r; } catch (x) { fail(e, 'onRespawn', x); }
      }
      return null;
    },
    get count() { return list.length; },
  };
  return api;
}

/** Engine event bus -> seam events (beast:died, inventory:added -> item:got). Returns an unsubscribe. */
export function bridgeEngineEvents(events, hooks) {
  const offs = [
    events.on('beast:died', (p) => { if (p && typeof p.id === 'string') hooks.emitSimple('beast:died', p.id); }),
    events.on('inventory:added', (p) => { if (p && typeof p.id === 'string') hooks.emitSimple('item:got', p.id, p.n || 1); }),
    // interaction:fired {key, name} carries no position (interaction.js:191) -> no 4th arg, coords default to 0,0,0.
    events.on('interaction:fired', (p) => { if (p && typeof p.key === 'string') hooks.emitSimple('prop:touched', p.key, p.name); }),
  ];
  return () => { for (const off of offs) off(); };
}

/** The game's single hook set (main.js and content handlers share it). */
export const hooks = createGameHooks();
export const register = hooks.register;
