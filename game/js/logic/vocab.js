// ED-LOGIC-01c (arch 38.70): the game vocabulary for engine/core/logic.js. One table drives the validator, the editor
// dropdowns (args types) and the runtime. ctx (built by logicWire.js) = { world, book, inventory, sim, props, logic, hooks, feed, hint, sound }.
// Conditions are pure reads (0 alloc); actions never write quest state directly (quest.feed goes through ctx.feed = the book's feed).
import { countOf } from '../quest/sim/inventory.js';
import { AVAILABLE, ACTIVE, READY, DONE } from '../quest/sim/questBook.js';

export const QUEST_STATES = 'available|active|ready|done|activeOrReady';
export const GROUP_STATES = 'reserve|alive|cleared';
/** quest.feed shorthand `<kind>:<id>` -> quest event type. */
export const FEED_KINDS = { item: 'item:got', area: 'area:entered', beast: 'beast:died', flag: 'flag:set' };

const questOk = (ctx, a) => {
  const s = ctx.book ? ctx.book.statusOf(a.quest) : -1;
  switch (a.state) {
    case 'available': return s === AVAILABLE;
    case 'active': return s === ACTIVE;
    case 'ready': return s === READY;
    case 'done': return s === DONE;
    case 'activeOrReady': return s === ACTIVE || s === READY;
    default: return false;
  }
};
/** 0 reserve | 1 spawned | 2 cleared */
const groupNum = (ctx, g) => ctx.logic.groups[g] | 0;

export const LOGIC_VOCAB = {
  events: {
    'area.enter': { args: { area: 'ref:area' } },
    'area.leave': { args: { area: 'ref:area' } },
    'prop.touched': { args: { prop: 'ref:prop' } },
    'beast.died': { args: { kind: 'ref:beastKind?', group: 'ref:group?' } },
    'group.cleared': { args: { group: 'ref:group' } },
    'item.got': { args: { item: 'ref:item' } },
    'flag.set': { args: { flag: 'ref:flag' } },
    'quest.accepted': { args: { quest: 'ref:quest' } },
    'quest.done': { args: { quest: 'ref:quest' } },
    'player.died': { args: {} },
  },
  conds: {
    quest: { args: { quest: 'ref:quest', state: QUEST_STATES }, test: questOk },
    flag: { args: { flag: 'ref:flag', eq: 'bool' }, test: (ctx, a) => !!ctx.world.state[a.flag] === a.eq },
    item: { args: { item: 'ref:item', atLeast: 'int' }, test: (ctx, a) => !!ctx.inventory && countOf(ctx.inventory, a.item) >= a.atLeast },
    group: { args: { group: 'ref:group', state: GROUP_STATES }, test: (ctx, a) => {
      const n = groupNum(ctx, a.group);
      return a.state === 'reserve' ? n === 0 : a.state === 'cleared' ? n === 2 : n === 1;
    } },
    prop: { args: { prop: 'ref:prop', state: 'text' }, test: (ctx, a) => ctx.props.get(a.prop) === a.state },
  },
  acts: {
    'prop.state': { args: { prop: 'ref:prop', state: 'text' }, run: (ctx, a) => { ctx.props.request(a.prop, a.state); } },
    'beasts.spawn': { args: { group: 'ref:group' }, run: (ctx, a) => { if (ctx.sim && ctx.sim.spawnGroup(a.group) > 0) ctx.logic.groups[a.group] = 1; } },
    'beasts.despawn': { args: { group: 'ref:group' }, run: (ctx, a) => { if (ctx.sim && ctx.sim.despawnGroup(a.group) > 0) ctx.logic.groups[a.group] = 0; } },
    'flag.set': { args: { flag: 'ref:flag', value: 'bool' }, run: (ctx, a) => { ctx.world.state[a.flag] = a.value; if (ctx.hooks) ctx.hooks.emitSimple('flag:set', a.flag, a.value); } },
    hint: { args: { text: 'ref:textId' }, run: (ctx, a) => { if (ctx.hint) ctx.hint(a.text); } },
    sound: { args: { id: 'text' }, run: (ctx, a) => { if (ctx.sound) ctx.sound(a.id); } },
    'quest.feed': { args: { quest: 'ref:quest', event: 'text' }, run: (ctx, a) => {
      const i = a.event.indexOf(':'), type = FEED_KINDS[a.event.slice(0, i)];
      if (!type || !ctx.feed) return;
      const id = a.event.slice(i + 1);
      ctx.feed(type === 'flag:set' ? { type, key: id, value: true } : { type, id });
    } },
  },
};
