/* design/itemsWeapons.js - EQ-20: sword / bow / shield in `sturdy` + `fine` + EQ-20b `tempered` + `warden` (12 ids). Stats only; held visuals reuse the
 * existing sword / bow / shield models. Icons = the base icon recoloured with the existing keys v (sturdy) / Y (fine).
 * Classic script (check-deps rule 4). Node: items.js requires it at its end; browser: tag after items.js (NEEDS B1-main).
 * Names + desc are plain (OB-135). No new palette entries.
 * equip.stats read by game/js/quest/sim/weaponStats.js: sword { dmgMul }, bow { dmgMul, drawMul (draw speed) },
 * shield { blockStamMul } (stamina cost of a block; the stamina system itself is not in the game yet). Worn = 1 / 1 / 1. */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  var I = A.items;
  if (!I || !I.defs || I.defs['gear.main.sword.sturdy']) return;
  var STATS = {
    sword:  { worn: { dmgMul: 1 }, sturdy: { dmgMul: 1.25 }, fine: { dmgMul: 1.5 }, tempered: { dmgMul: 1.75 }, warden: { dmgMul: 2 } },
    bow:    { worn: { dmgMul: 1, drawMul: 1 }, sturdy: { dmgMul: 1.25, drawMul: 1.15 }, fine: { dmgMul: 1.5, drawMul: 1.3 }, tempered: { dmgMul: 1.75, drawMul: 1.45 }, warden: { dmgMul: 2, drawMul: 1.6 } },
    shield: { worn: { blockStamMul: 1 }, sturdy: { blockStamMul: 0.85 }, fine: { blockStamMul: 0.7 }, tempered: { blockStamMul: 0.55 }, warden: { blockStamMul: 0.4 } }
  };
  var BASES = [
    { base: 'sword', baseId: 'sword', slot: 'main', held: 'sword', name: 'Sword', def: 0 },
    { base: 'bow', baseId: 'bow', slot: 'ranged', held: 'bow', name: 'Bow', def: 0 },
    { base: 'shield', baseId: 'shield', slot: 'off', held: 'shield', name: 'Shield', def: 2 }
  ];
  var TIERS = { sturdy: { key: 'v', c: 'verdigris', prefix: 'Sturdy', mul: 2 }, fine: { key: 'Y', c: 'gold', prefix: 'Fine', mul: 3 },
    tempered: { key: 'i', c: 'iron', prefix: 'Elite', mul: 4 }, warden: { key: 's', c: 'ironLight', prefix: 'Warden', mul: 5 } }; // OB-135 plain names
  var ids = [];
  BASES.forEach(function (b) {
    var src = I.defs[b.baseId];
    ['sturdy', 'fine', 'tempered', 'warden'].forEach(function (tier) {
      var t = TIERS[tier], id = 'gear.' + b.slot + '.' + b.base + '.' + tier;
      var fg = src.icon.fg.map(function (r) { return r.replace(/[^ ]/g, t.key); });
      I.defs[id] = {
        id: id, name: t.prefix + ' ' + b.name, kind: src.kind, stackMax: 1, hand: true, inPack: true,
        desc: 'A ' + t.prefix.toLowerCase() + ' ' + b.name.toLowerCase() + '.',
        glyph: { ch: src.glyph.ch, c: t.c },
        icon: { w: 5, h: 3, glyphs: src.icon.glyphs.slice(), fg: fg },
        equip: { slot: b.slot, tier: tier, def: b.def === 0 ? 0 : b.def + t.mul - 1, held: b.held, stats: STATS[b.base][tier] }
      };
      ids.push(id);
    });
  });
  // worn base items carry their neutral stats too, so a reader never needs a default
  BASES.forEach(function (b) { var q = I.defs[b.baseId].equip; if (q && !q.stats) q.stats = STATS[b.base].worn; });
  ids.forEach(function (id) { if (I.order.indexOf(id) < 0) I.order.push(id); });
  I.weaponStats = STATS;
  I.weaponIds = ids;
  if (typeof module === 'object' && module && module.exports) module.exports = { ids: ids, stats: STATS };
})(typeof window !== 'undefined' ? window : globalThis);
