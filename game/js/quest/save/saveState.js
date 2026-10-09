// US-089a: game save envelope over the public WorldState serializer/migration path.
import { serialize, deserialize } from '../../../../engine/index.js';
import { createQuest } from '../sim/quest.js';

export const SAVE_VERSION = 1;
export const SAVE_SLOTS = 3;
const KEY_PREFIX = 'kestrel.save.slot.';
const validId = id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id);

/** S8-C-02: resume from save.meta.playTimeSec; pass seconds to collectSave at save time.
 * The host supplies playing=false while paused, in menus or outside active gameplay.
 * tick uses seconds, does not allocate, and returns the accumulated play time.
 */
export function createPlayTime(playTimeSec = 0) {
  if (!Number.isFinite(playTimeSec) || playTimeSec < 0) throw new RangeError('save: invalid play time');
  let seconds = playTimeSec;
  return {
    get seconds() { return seconds; },
    tick(dt, playing) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('save: invalid play-time dt');
      if (playing === true) {
        const next = seconds + dt;
        if (!Number.isFinite(next)) throw new RangeError('save: play-time overflow');
        seconds = next;
      }
      return seconds;
    },
  };
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(v=>v===undefined ? null : canonical(v));
  if (value && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value))) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error('save: unsafe key');
      if (value[key] !== undefined) out[key] = canonical(value[key]);
    }
    return out;
  }
  throw new Error('save: expected finite JSON data');
}

function ids(value) {
  if (!Array.isArray(value) || !value.every(validId)) throw new Error('save: invalid ids');
  return [...new Set(value)].sort();
}

export function validateSave(save) {
  if (!save || save.saveVersion !== SAVE_VERSION) throw new Error('save: unsupported saveVersion');
  if (!save.world || ![1,2].includes(save.world.version) || !Array.isArray(save.world.entities) || !Array.isArray(save.world.structures)) throw new Error('save: invalid WorldState');
  if (!save.game || !save.meta || typeof save.meta.playerName !== 'string' || typeof save.meta.place !== 'string'
    || !Number.isFinite(save.meta.playTimeSec) || save.meta.playTimeSec < 0
    || (save.meta.savedAt !== undefined && !(Number.isFinite(save.meta.savedAt) && save.meta.savedAt >= 0))) throw new Error('save: invalid metadata');
  ids(save.game.openedChests); ids(save.game.deadBeasts);
  if (save.game.quest !== null && (!save.game.quest || save.game.quest.questVersion !== 1)) throw new Error('save: invalid quest');
  canonical(save);
  return save;
}

/** Player transform, hearts/mana, pack and hands have one source: WorldState entity components. */
export function collectSave(world, { quest = null, questDef = null, openedChests = [], deadBeasts = [], playerName = 'Wick', place = '', playTimeSec = 0, savedAt = Date.now() } = {}) {
  if (quest && !questDef) throw new Error('save: quest definition required');
  const save = { saveVersion:SAVE_VERSION, world:serialize(world),
    game:{quest:quest ? createQuest(questDef,quest) : null,openedChests:ids(openedChests),deadBeasts:ids(deadBeasts)},
    meta:{playerName,place,playTimeSec,savedAt} }; // SAVE-TIME-01: ms epoch; optional on read (old saves sort oldest)
  validateSave(save);
  return canonical(save);
}

/** Fresh World via deserialize uses CO-5 migrateState internally; no deep engine import. */
export function applySave(save, assets, { questDef = null, worldOptions = {} } = {}) {
  validateSave(save);
  if (save.game.quest && !questDef) throw new Error('save: quest definition required');
  const quest = save.game.quest ? createQuest(questDef,save.game.quest) : null;
  const world = deserialize(canonical(save.world),assets,worldOptions);
  return { world,quest,openedChests:ids(save.game.openedChests),deadBeasts:ids(save.game.deadBeasts),meta:canonical(save.meta) };
}

export function stringifyGameSave(save) { validateSave(save); return JSON.stringify(canonical(save)); }
export function parseGameSave(text) { const save=JSON.parse(text); validateSave(save); return canonical(save); }

function slotKey(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SAVE_SLOTS) throw new Error('save: slot must be 0, 1 or 2');
  return KEY_PREFIX + slot;
}

/** Pass a localStorage-compatible object from the platform layer; this module never reads window. */
export function createStorageAdapter(storage) {
  return {
    writeSlot(slot, save) {
      const key=slotKey(slot), text=stringifyGameSave(save);
      try { storage.setItem(key,text); return {ok:storage.getItem(key)===text}; }
      catch(error) { return {ok:false,error:String(error)}; }
    },
    readSlot(slot) {
      const key=slotKey(slot);
      try { const text=storage.getItem(key); return {ok:true,save:text===null ? null : parseGameSave(text)}; }
      catch(error) { return {ok:false,save:null,error:String(error)}; }
    },
    deleteSlot(slot) {
      const key=slotKey(slot);
      try { storage.removeItem(key); return {ok:storage.getItem(key)===null}; }
      catch(error) { return {ok:false,error:String(error)}; }
    },
    listSlots() {
      return Array.from({length:SAVE_SLOTS},(_,slot)=>{
        const result=this.readSlot(slot);
        return {slot,ok:result.ok,meta:result.save ? canonical(result.save.meta) : null,error:result.error ?? null};
      });
    },
  };
}

export function createMemoryAdapter() {
  const data=new Map();
  return createStorageAdapter({getItem:key=>data.get(key) ?? null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)});
}
