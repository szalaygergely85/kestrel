import assert from 'node:assert/strict';
import {createRng} from '../../../../engine/index.js';
import {createLoot} from './loot.js';
import {createChests} from './chest.js';
import {LOOT_TABLE} from './lootConfig.js';

let checks = 0;
function ok(value, label) { assert.ok(value, label); checks++; }
function events() {
  const listeners = new Map(), coins = [];
  return {coins, on(name, fn) { const a = listeners.get(name) || []; a.push(fn); listeners.set(name, a); return () => {}; },
    emit(name, p) { if (name === 'coin:drop') coins.push(p.n); for (const fn of listeners.get(name) || []) fn(p); }};
}
const items = {apple:{stackMax:1}};
const inv = () => ({slots:Array.from({length:24},()=>({id:null,n:0}))});
function beast(seed, brain = {}, full = false) {
  const bus = events(), inventory = inv();
  if (full) inventory.slots.forEach(s=>{s.id='apple';s.n=1;});
  const world = {state:{}, addInteractable(r) { return r; }, removeInteractable() {}};
  const beasts = {count:1, ids:['b'], entities:[{transform:{x:0,y:0,z:0},components:{brain}}],
    slotOf:id=>id === 'b' ? 0 : -1, despawnCorpse() {}};
  const rng = createRng(seed);
  const table = {...LOOT_TABLE.boar, fixed:[{item:'apple',n:1}], rolls:[], orb:{chance:0,kinds:['hp']}};
  const loot = createLoot(world,bus,{items, beasts,rng,table,inventoryOf:()=>inventory});
  const die = () => bus.emit('beast:died',{id:'b',x:0,y:0,z:0});
  return {bus,loot,die,rng,inventory};
}
{
  const outcomes = [];
  for (let seed=1;seed<=200;seed++) {
    const a=beast(seed), b=beast(seed), reference=createRng(seed);
    a.die(); b.die(); a.loot.lootBoar('b'); b.loot.lootBoar('b');
    assert.deepEqual(a.bus.coins,b.bus.coins);
    reference.nextFloat(); reference.int(1);
    assert.deepEqual(a.rng.s,reference.s);
    outcomes.push(...a.bus.coins);
  }
  ok(outcomes.length > 5 && outcomes.length < 40 && outcomes.every(n=>n>=1&&n<=5), 'regular 10% seeded coins in 1..5; item RNG untouched');
}
const {KINDS} = await import('./beastKinds.js');
const eliteKind = Object.keys(KINDS).find(k=>KINDS[k].elite);
for (const brain of [{beastKind:eliteKind},{lingerSec:12}]) {
  const a=beast(17,brain,true); a.die();
  ok(a.bus.coins.length === 1,'elite pays immediately on death'); a.die();
  ok(a.loot.lootBoar('b') === false, 'full pack keeps item in corpse');
  ok(a.bus.coins.length === 1 && a.bus.coins[0]>=10 && a.bus.coins[0]<=20, 'elite pays 10..20 even with full pack');
  a.loot.lootBoar('b'); a.die(); a.loot.lootBoar('b');
  ok(a.bus.coins.length === 1, 'repeated E/death cannot repeat payout');
  a.bus.emit('beast:sink',{id:'b'}); a.die(); a.loot.lootBoar('b');
  ok(a.bus.coins.length === 2, 'next life rolls and pays again');
}
const pose={x:0,y:-1,z:0,forwardX:0,forwardY:1};
const def={id:'box',x:0,y:0,z:0,frontX:0,frontY:-1,interact:{radius:2,facingDeg:70,facingCos:0.34},table:{fixed:[{item:'apple',n:1}],weighted:[],coin:[5,15]}};
{
  const bus=events(), inventory=inv(); inventory.slots.forEach(s=>{s.id='apple';s.n=1;});
  const make=(openedChests=[])=>createChests([def],{items,inventoryOf:()=>inventory,events:bus,openedChests,seed:7});
  const ch=make();
  ok(!ch.open('box',pose) && bus.coins.length===0,'full chest pays nothing');
  inventory.slots[0]={id:null,n:0};
  ok(ch.open('box',pose),'open chest');
  ch.step(1,false); ok(bus.coins.length===0,'paused opening pays nothing');
  let saved;
  bus.on('coin:drop',()=>{saved=ch.openedIds();});
  ch.step(1); ch.step(1);
  ok(bus.coins.length===1 && bus.coins[0]>=5 && bus.coins[0]<=15,'small chest pays seeded range once');
  ok(saved.join()==='box' && !ch.open('box',pose),'opened state committed before coin event');
  const restored=make(saved); restored.step(1);
  ok(!restored.open('box',pose) && bus.coins.length===1,'restored chest never repays');
}
for (const range of [[20,40],[30,30]]) {
  const a=events(), b=events();
  for (const bus of [a,b]) {
    const loot=createLoot(null,bus,{kind:'chest',items,inventoryOf:inv,rng:createRng(44),table:{fixed:[],weighted:[],coin:range}});
    ok(loot.claim(),'coin-only chest claims'); loot.emitAdded(); loot.emitAdded();
  }
  ok(a.coins.length===1 && a.coins[0]>=range[0] && a.coins[0]<=range[1] && a.coins[0]===b.coins[0],'secret/crypt seeded payout once');
}
console.log(`coinDrops: ${checks} PASS`);
