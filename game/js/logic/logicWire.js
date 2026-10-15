// ED-LOGIC-01c (arch 38.70): glue between the game seam (gameHooks events, fixed tick) and engine/core/logic.js.
// handlers() -> a gameHooks handler { onEvent, onTick }; save state lives in world.state.logic (rides the normal
// world save = the "save relay key logic"); onWorldLoaded() re-applies groups (beastSim `down` is not saved) and prop states.
import { compileLogic, createLogic, SIM_STEP } from '../../../engine/index.js';
import { LOGIC_VOCAB } from './vocab.js';
import { createPropStates } from './propState.js';

/**
 * @param {{world:any, blocks:any[], meshStates?:any, book?:any, inventory?:any, sim?:any, nav?:any, hooks?:any, feed?:(e:any)=>void,
 *   hint?:(id:string)=>void, sound?:(id:string)=>void, refs?:any, player?:()=>any}} o
 */
export function createLogicWire(o) {
  const { world, blocks } = o;
  const program = compileLogic(blocks, LOGIC_VOCAB, { refs: o.refs });
  const logic = createLogic(program);
  const props = createPropStates(world, { nav: o.nav, player: o.player, meshStates: o.meshStates });
  const ctx = { world, book: o.book || null, inventory: o.inventory || null, sim: o.sim || null, props, logic, hooks: o.hooks || null, feed: o.feed || null, hint: o.hint || null, sound: o.sound || null };
  let dirty = false, clearCheck = false, warnedDt = false;

  /** Queue an engine event by name: push('area.enter', 'area', 'rook.yard'). Unknown name is dropped; unused value hits wildcard blocks only. */
  function push(name, argName, value) {
    const k = program.kindId(name); if (k < 0) return false;
    dirty = true;
    return logic.push(k, argName ? program.argId(argName, value) : 0);
  }

  function onEvent(name, d) {
    switch (name) {
      case 'zone:entered': push('area.enter', 'area', d.id); break;
      case 'zone:left': push('area.leave', 'area', d.id); break;
      case 'prop:touched': push('prop.touched', 'prop', d.id); break;
      case 'item:got': push('item.got', 'item', d.id); break;
      case 'flag:set': push('flag.set', 'flag', d.key); break;
      case 'player:died': push('player.died'); break;
      case 'beast:died': {
        const sim = ctx.sim, slot = sim ? sim.slotOf(d.id) : -1;
        const g = slot >= 0 ? sim.groupOf(slot) : '';
        if (g) clearCheck = true;
        const brain = slot >= 0 ? sim.entities[slot].components.brain : null;
        const kind = brain ? brain.beastKind : undefined;
        const ka = kind ? program.argId('kind', kind) : 0, ga = g ? program.argId('group', g) : 0;
        const k = program.kindId('beast.died'); if (k < 0) break;
        dirty = true;
        if (ka) logic.push(k, ka);
        if (ga) logic.push(k, ga);
        if (!ka && !ga) logic.push(k, 0); // wildcard blocks only
        break;
      }
      default: break;
    }
  }

  /** quest.accepted / quest.done come from the book (the game bridges them): wire.notify('quest.accepted', 'quest', id). */
  function notify(name, argName, value) { push(name, argName, value); }

  function checkGroups() {
    const sim = ctx.sim; if (!sim) return;
    for (const g of Object.keys(sim.groups)) {
      if (logic.groups[g] === 1 && sim.groupDead(g)) { logic.groups[g] = 2; push('group.cleared', 'group', g); }
    }
  }

  function onTick(dt) {
    if (!warnedDt && dt !== undefined && Math.abs(dt - SIM_STEP) > 1e-6) { warnedDt = true; console.warn(`logic: tick dt ${dt} is not the fixed step ${SIM_STEP}`); }
    props.step();
    if (clearCheck) { clearCheck = false; checkGroups(); }
    const used = logic.step(ctx);
    if (used > 0) dirty = true;
    if (dirty || logic.pending > 0) { world.state.logic = logic.save(); dirty = false; }
  }

  /** After a world load / restart: logic state from world.state.logic, then groups + prop states re-applied. */
  function onWorldLoaded() {
    logic.load(world.state.logic);
    const sim = ctx.sim;
    if (sim) for (const g of Object.keys(logic.groups)) { if (logic.groups[g] === 1) sim.spawnGroup(g); else sim.despawnGroup(g); }
    props.reapply();
    dirty = false; clearCheck = false;
  }

  /** BH2-E1: beasts.resetAll() revives every slot; re-park reserve/cleared groups per logic.groups (undefined = reserve-only groups stay parked). */
  function reapplyGroups() {
    const sim = ctx.sim; if (!sim || !sim.groups) return;
    for (const g of Object.keys(sim.groups)) {
      const st = logic.groups[g];
      if (st === 1) sim.spawnGroup(g);
      else if (st === 0 || st === 2) sim.despawnGroup(g);
      else { const l = sim.groupSlots(g); if (l.length && l.every((i) => sim.entities[i].components.brain.reserve)) sim.despawnGroup(g); }
    }
  }
  if (o.sim && o.sim.events && o.sim.events.on) o.sim.events.on('beasts:reset', reapplyGroups);

  function handlers() { return { onEvent, onTick }; }
  return { program, logic, props, ctx, push, notify, onEvent, onTick, onWorldLoaded, handlers };
}
