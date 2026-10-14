/* design/itemBases.js - ITEM-03 (D-081/D-084/D-089): data-only item bases for the generator (game/js/quest/sim/itemGen.js).
 * Classic script (check-deps rule 4): sets ASSETS.itemBases. Node: module.exports too.
 * Names: plain, <= 14 chars, one per item-level step (iL 1-3 / 4-6 / 7-10). ALL names are placeholders: NEEDS WRITER.
 * kind: 'weapon' | 'shield' | 'armour'. dmgMul/weight scale the base formulas in itemGen.js.
 * reqAttr: attribute the hard requirement (ITEM-09) is on (null = none). No new palette keys. */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  var BASES = {
    sword:  { slot: 'main',   kind: 'weapon', dmgMul: 1,    reqAttr: 'str', names: ['Worn Sword', 'Iron Sword', 'Steel Sword'] },   // NEEDS WRITER
    axe:    { slot: 'main',   kind: 'weapon', dmgMul: 1.25, reqAttr: 'str', names: ['Hand Axe', 'Battle Axe', 'War Axe'], critDmg: 0.10, swingMul: 1.15 }, // NEEDS WRITER
    spear:  { slot: 'main',   kind: 'weapon', dmgMul: 0.9,  reqAttr: 'str', names: ['Short Spear', 'Long Spear', 'War Spear'], reach: 0.6, swingMul: 0.9 }, // NEEDS WRITER
    bow:    { slot: 'ranged', kind: 'weapon', dmgMul: 0.9,  reqAttr: 'dex', names: ['Short Bow', 'Long Bow', 'Steel Bow'] },       // NEEDS WRITER
    shield: { slot: 'off',    kind: 'shield', weight: 2, blockStamMul: 0.9, reqAttr: null, names: ['Wood Shield', 'Iron Shield', 'Steel Shield'] }, // NEEDS WRITER
    'armour.head':  { slot: 'head',  kind: 'armour', weight: 2, reqAttr: null, names: ['Cap', 'Helm', 'Great Helm'] },          // NEEDS WRITER
    'armour.body':  { slot: 'body',  kind: 'armour', weight: 3, reqAttr: null, names: ['Tunic', 'Mail Shirt', 'Plate Armour'] }, // NEEDS WRITER
    'armour.cloak': { slot: 'cloak', kind: 'armour', weight: 1, reqAttr: null, names: ['Cloak', 'Wool Cloak', 'Warden Cloak'] }, // NEEDS WRITER
    'armour.hands': { slot: 'hands', kind: 'armour', weight: 1, reqAttr: null, names: ['Gloves', 'Gauntlets', 'Steel Gauntlet'] }, // NEEDS WRITER
    'armour.belt':  { slot: 'belt',  kind: 'armour', weight: 1, reqAttr: null, names: ['Rope Belt', 'Leather Belt', 'Steel Belt'] }, // NEEDS WRITER
    'armour.legs':  { slot: 'legs',  kind: 'armour', weight: 2, reqAttr: null, names: ['Trousers', 'Greaves', 'Plate Greaves'] }, // NEEDS WRITER
    'armour.feet':  { slot: 'feet',  kind: 'armour', weight: 1, reqAttr: null, names: ['Boots', 'Hard Boots', 'Steel Boots'] }  // NEEDS WRITER
  };
  A.itemBases = BASES;
  if (typeof module === 'object' && module && module.exports) module.exports = BASES;
})(typeof window !== 'undefined' ? window : globalThis);
