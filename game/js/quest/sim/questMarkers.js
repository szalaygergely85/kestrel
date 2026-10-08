// QUEST-CHAIN-02 sim step: available-but-not-taken targets derived from the existing quest facts/prefix.
// No marker save layer, World mutation, rendering, clocks or per-step allocation.
import {validateQuestDefinition} from './quest.js';

const EMPTY=Object.freeze([]);
const validId=id=>typeof id==='string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id)
  && id!=='constructor' && id!=='prototype' && id!=='__proto__';

/** bindings = [{objectiveId, targets:[propOrAreaId]}]. Bind the read/touch TAKE step, not its later goal.
 * Prerequisites = the completed prefix before the take step. Only its available slot can show markers.
 * Completed take steps stay latched in quest state even if their former flags are later cleared.
 * Item/beast goals cannot carry an availability marker; the HUD carries them after accepting.
 * Each result is a frozen array cached at create. Callers may retain/read it, never mutate it.
 */
export function createQuestMarkers(def, bindings) {
  validateQuestDefinition(def);
  if(!Array.isArray(bindings))throw new Error('quest markers: invalid bindings');
  const slots=new Array(def.objectives.length).fill(null);
  for(const binding of bindings) {
    const index=def.objectives.findIndex(o=>o.id===binding?.objectiveId);
    if(index<0 || slots[index] || !Array.isArray(binding.targets) || !binding.targets.length
      || !binding.targets.every(validId) || new Set(binding.targets).size!==binding.targets.length)
      throw new Error('quest markers: unknown/duplicate objective or invalid targets');
    const taken=def.objectives[index].when;
    if(binding.taken!==undefined || !['flag','area'].includes(taken.type))
      throw new Error('quest markers: bind a flag/area take step, not an item/beast goal');
    slots[index]={targets:Object.freeze([...binding.targets]),type:taken.type,id:taken.id,equals:taken.equals};
  }
  const questId=def.id;
  return {
    markerTargets(state) {
      if(!state || state.questId!==questId || state.questVersion!==1)throw new Error('quest markers: incompatible quest state');
      const binding=slots[state.completed.length];
      if(!binding)return EMPTY;
      const taken=binding.type==='flag'
        ? Object.hasOwn(state.flags,binding.id) && state.flags[binding.id]===binding.equals
        : state.areas.includes(binding.id);
      return taken ? EMPTY : binding.targets;
    },
  };
}
