// S8-C-10: atomic crafting over the existing inventory; recipes are host-supplied content.
import {addItem,removeItem,countOf,SLOTS} from './inventory.js';

const OK=Object.freeze({ok:true,reason:null});
const UNKNOWN=Object.freeze({ok:false,reason:'unknown-recipe'});
const MISSING=Object.freeze({ok:false,reason:'missing-inputs'});
const FULL=Object.freeze({ok:false,reason:'output-full'});
const validId=id=>typeof id==='string' && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(id)
  && !['constructor','prototype','__proto__'].includes(id);

/** recipes = [{id,inputs:[{item,n}],output:{item,n}}]; items = existing item defs.
 * No game recipe/balance defaults, world, events or extra save state.
 * Input rows are unique per item; counts/caps must be positive safe integers.
 * canCraft is a read-only boolean query. craft returns a reused frozen {ok,reason}.
 * Both stage the existing removeItem/addItem operations in a reusable private pack,
 * then craft commits all slot fields/hands only after the full output fits.
 */
export function createCrafting(recipes,{items}={}) {
  if(!Array.isArray(recipes) || !items || typeof items!=='object')throw new Error('crafting: recipes/items required');
  const byId=new Map(), defs=Object.create(null);
  function copyReward(row) {
    const def=row && Object.hasOwn(items,row.item) ? items[row.item] : null;
    if(!row || !validId(row.item) || !Number.isSafeInteger(row.n) || row.n<1 || !def
      || !Number.isSafeInteger(def.stackMax) || def.stackMax<1 || def.pending==='owner')
      throw new Error('crafting: invalid, unknown or pending item/count');
    defs[row.item]={stackMax:def.stackMax};
    return {item:row.item,n:row.n};
  }
  for(const recipe of recipes) {
    if(!recipe || !validId(recipe.id) || byId.has(recipe.id) || !Array.isArray(recipe.inputs) || !recipe.inputs.length)
      throw new Error('crafting: invalid/duplicate recipe or empty inputs');
    const inputs=recipe.inputs.map(copyReward);
    if(new Set(inputs.map(row=>row.item)).size!==inputs.length)throw new Error('crafting: duplicate input item');
    byId.set(recipe.id,{inputs,output:copyReward(recipe.output)});
  }
  const staged={slots:Array.from({length:SLOTS},()=>({id:null,n:0})),left:null,right:null};
  function plan(inv,id) {
    const recipe=byId.get(id);
    if(!recipe)return UNKNOWN;
    if(!inv || !Array.isArray(inv.slots) || inv.slots.length!==SLOTS)throw new Error('crafting: invalid inventory');
    for(let i=0;i<SLOTS;i++) {
      const slot=inv.slots[i];
      if(!slot || !Number.isSafeInteger(slot.n) || slot.n<0 || (slot.id===null ? slot.n!==0 : !validId(slot.id) || slot.n===0))
        throw new Error('crafting: invalid inventory slot');
      staged.slots[i].id=slot.id;staged.slots[i].n=slot.n;
    }
    staged.left=inv.left;staged.right=inv.right;
    for(const input of recipe.inputs)if(countOf(staged,input.item)<input.n)return MISSING;
    for(const input of recipe.inputs)removeItem(staged,input.item,input.n);
    return addItem(staged,defs,recipe.output.item,recipe.output.n)===recipe.output.n ? OK : FULL;
  }
  return {
    canCraft(inv,id){return plan(inv,id).ok;},
    craft(inv,id) {
      const result=plan(inv,id);
      if(!result.ok)return result;
      for(let i=0;i<SLOTS;i++){inv.slots[i].id=staged.slots[i].id;inv.slots[i].n=staged.slots[i].n;}
      inv.left=staged.left;inv.right=staged.right;
      return result;
    },
  };
}
