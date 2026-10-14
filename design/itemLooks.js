/* design/itemLooks.js - ITEM-D1 (owner D-081 / D-084, epic docs/epics/ep-items-stats.md sections 2, 4, 7): inventory icons per
 * item type x 3 item-level looks, the 5 rarity frame styles and the item card layout (mock-up in epic section 4).
 * Classic script (check-deps rule 4), load after design/items.js (icons use the items.js colour keys). Node: module.exports.
 * Format: design/README.md section 31. Preview: design/preview/items-weapons.html. No palette edit: every colour is an
 * existing palette.js key (icons: one char = an ASSETS.items.keys entry, as every pack icon).
 *
 * WHAT THIS FILE SETS
 *   ASSETS.itemLooks = {
 *     looks            [{look, iL:[lo,hi]}]  look 0 = iL 1-3, 1 = iL 4-6, 2 = iL 7-10 (= itemBases name steps)
 *     lookForIL(iL)    -> 0 | 1 | 2
 *     icons[type]      [icon0, icon1, icon2]   type = an itemBases key: sword axe spear bow shield armour.<slot>
 *                      icon = { w: 5, h: 3, glyphs[3], fg[3] }  (items.js format: fg char = items.keys colour key)
 *     glyphs[type]     [{ch, c}, x3]  1-cell glyph for the hands strip / toast (c = palette key)
 *     iconFor(type, iL) -> icon
 *     rarity           { order[], common|magic|rare|epic|unique: style }
 *     card             the item card layout + text colours (mock-up, epic section 4)
 *     slotFrame        the pack-slot border per rarity (7 x 5 slot round a 5 x 3 icon)
 *     validate(itemKeys, rgb) -> [] when OK
 *   }
 * Looks: 0 = wood + black iron (plain), 1 = steel + leather, 2 = polished steel + bronze fittings (+ a red tassel / cloak).
 */
(function (root) {
  'use strict';
  var A = root.ASSETS = root.ASSETS || {};
  function icon(glyphs, fg) { return { w: 5, h: 3, glyphs: glyphs, fg: fg }; }

  // ---- icons (items.keys: S mirror, s ironLight, i iron, K ironDark, W white*, Z bronzeLight, z bronze,
  //      h wood, H woodLight, l woodDark, D ropeDark, r goreRed, d vitalDark, u linen, f linen, n linenDark, T linenLight)
  var icons = {
    //  .         guard top          plain: iron hilt, grey blade | steel | bronze guard + pommel, white point glint
    // o+==>      pommel guard blade point
    //  '
    sword: [
      icon([' .   ', 'o+==>', " '   "], [' i   ', 'iisss', ' i   ']),
      icon([' .   ', 'o+==>', " '   "], [' s   ', 'isSSS', ' s   ']),
      icon([' ,   ', 'o#==>', " `   "], [' Z   ', 'ZzSSW', ' z   '])
    ],
    //   ,/)      head top + edge     haft runs left, the bearded head on the right, edge = right column
    // -==#|      haft  wedge  head  edge
    //   `\)      beard
    axe: [
      icon(['  ,/)', '-==#|', '  `\\)'], ['  iis', 'HHKis', '  iis']),
      icon(['  ./)', '=-=#|', "  '\\)"], ['  ssS', 'lhKsS', '  ssS']),
      icon(['  ,/}', 'o==#|', '  `\\}'], ['  zSS', 'ZllSW', '  zSS'])
    ],
    //     .      leaf head width     shaft runs left, socket + leaf point on the right
    // ---=>
    //     '
    spear: [
      icon(['    .', '---=>', "    '"], ['    i', 'HHHDs', '    i']),
      icon(['    .', '=--#>', "    '"], ['    s', 'lhhsS', '    s']),
      icon(['   ,.', 'o-=#>', "   `'"], ['   rS', 'zhZSW', '   rS'])
    ],
    bow: [
      icon([" /'| ", '(#  |', ' \\,| '], [' hnu ', 'hD  u', ' hnu ']),
      icon([" /'| ", '(#  |', ' \\,| '], [' HnT ', 'hl  T', ' hnT ']),
      icon([" /'| ", '{#  |', ' \\,| '], [' HsT ', 'Hz  T', ' HsT '])
    ],
    shield: [
      icon(['.---.', '(H@H)', "`---'"], ['lhhhl', 'lHiHl', 'lhhhl']),
      icon(['.=-=.', '(H@H)', "`=-='"], ['sSsSs', 'iHShi', 'KiKiK']),
      icon(['.=-=.', '(%@%)', "`=-='"], ['SsSsS', 'sZSZs', 'iSiSi'])
    ],
    'armour.head': [
      icon([' ,-. ', '(___)', '     '], [' hHh ', 'hhhhh', '     ']),
      icon([' ,-. ', '(|=|)', '     '], [' sSs ', 'isKsi', '     ']),
      icon([' .^. ', '[=-=]', ' |_| '], [' SZS ', 'SKKKS', ' sss '])
    ],
    'armour.body': [
      icon(['\\_ _/', ' |:| ', ' |_| '], ['uf fu', ' fDf ', ' uuu ']),
      icon(['\\_ _/', ' |#| ', ' |#| '], ['si is', ' isi ', ' isi ']),
      icon(['\\=-=/', ' |@| ', ' |_| '], ['SZSZS', ' SZS ', ' sSs '])
    ],
    'armour.cloak': [
      icon([' ,-. ', '/ | \\', '/_|_\\'], [' uuu ', 'u n u', 'unnnu']),
      icon([' ,-. ', '/ | \\', '/_|_\\'], [' DDD ', 'h D h', 'hhDhh']),
      icon([' ,o. ', '/ | \\', '/_|_\\'], [' dZd ', 'r d r', 'rrdrr'])
    ],
    'armour.hands': [
      icon(['     ', '|||||', '\\___/'], ['     ', 'hHhHh', 'lhhhl']),
      icon(['     ', '|||||', '\\===/'], ['     ', 'sisis', 'iKKKi']),
      icon(['     ', '|||||', '\\=#=/'], ['     ', 'SsSsS', 'sZSZs'])
    ],
    'armour.belt': [
      icon(['     ', '~~o~~', '     '], ['     ', 'DDhDD', '     ']),
      icon(['     ', '=[o]=', '     '], ['     ', 'lisil', '     ']),
      icon(['     ', '=[@]=', '  |  '], ['     ', 'lZSZl', '  l  '])
    ],
    'armour.legs': [
      icon(['|---|', '| | |', '|_|_|'], ['hDDDh', 'h h h', 'hhhhh']),
      icon(['|===|', '|#|#|', '|_|_|'], ['lllll', 'lilil', 'iiiii']),
      icon(['|=-=|', '[#|#]', '|_|_|'], ['lZlZl', 'SsKsS', 'sSsSs'])
    ],
    'armour.feet': [
      icon(['     ', '|_| |', '|_|_|'], ['     ', 'hhh h', 'hhhhh']),
      icon(['     ', '|=| |', '|_|_|'], ['     ', 'lDl l', 'lllll']),
      icon(['     ', '[=] |', '|_|_]'], ['     ', 'SsS s', 'sSsSS'])
    ]
  };
  function g3(ch, c0, c1, c2) { return [{ ch: ch, c: c0 }, { ch: ch, c: c1 }, { ch: ch, c: c2 }]; }
  var glyphs = {
    sword: g3('/', 'iron', 'ironLight', 'mirror'), axe: g3('P', 'iron', 'ironLight', 'mirror'),
    spear: g3('|', 'iron', 'ironLight', 'mirror'), bow: g3(')', 'wood', 'woodLight', 'woodLight'),
    shield: g3('O', 'wood', 'ironLight', 'mirror'),
    'armour.head': g3('n', 'wood', 'ironLight', 'mirror'), 'armour.body': g3('T', 'linen', 'ironLight', 'mirror'),
    'armour.cloak': g3('A', 'linen', 'ropeDark', 'goreRed'), 'armour.hands': g3('m', 'wood', 'ironLight', 'mirror'),
    'armour.belt': g3('=', 'ropeDark', 'woodDark', 'bronzeLight'), 'armour.legs': g3('H', 'wood', 'woodDark', 'mirror'),
    'armour.feet': g3('L', 'wood', 'woodDark', 'mirror')
  };

  // ---- rarity (owner D-081 / D-084: Common white, Magic blue, Rare yellow, Epic purple, Unique orange) ----
  // name = item name colour; frame = border colour; corner = corner + ornament colour (one step brighter or darker);
  // h / v = the edge glyph pattern tiled along the top+bottom / down the sides (between the corners); ornament =
  // centred in the top edge (null = none). The more valuable, the heavier the border: - | -> = | -> =- with # -> ~=* .
  var rarity = {
    order: ['common', 'magic', 'rare', 'epic', 'unique'],
    common: { label: 'Common', tag: '[Common]', name: 'white', frame: 'ashLight', corner: 'ash', tagC: 'ashLight',
              corners: { tl: '+', tr: '+', bl: '+', br: '+' }, h: '-', v: '|', ornament: null, bonusLines: 0 },
    magic:  { label: 'Magic', tag: '[Magic]', name: 'manaLight', frame: 'mana', corner: 'manaLight', tagC: 'manaLight',
              corners: { tl: '.', tr: '.', bl: "'", br: "'" }, h: '-', v: '|', ornament: null, bonusLines: 1 },
    rare:   { label: 'Rare', tag: '[Rare]', name: 'gold', frame: 'alert', corner: 'alertLight', tagC: 'gold',
              corners: { tl: '+', tr: '+', bl: '+', br: '+' }, h: '=', v: '|', ornament: '<>', bonusLines: 2 },
    epic:   { label: 'Epic', tag: '[Epic]', name: 'unitVioletLight', frame: 'unitViolet', corner: 'unitVioletLight', tagC: 'unitVioletLight',
              corners: { tl: '#', tr: '#', bl: '#', br: '#' }, h: '=-', v: '|', ornament: '=<*>=', bonusLines: 3 },
    unique: { label: 'Unique', tag: '[Unique]', name: 'emberHot', frame: 'flameOuter', corner: 'flameCore', tagC: 'emberHot',
              corners: { tl: '*', tr: '*', bl: '*', br: '*' }, h: '~=', v: '|:', ornament: '-<*>-', bonusLines: 'fixed + 1 unique effect',
              shimmer: { color: 'flameCore', glyph: '*', periodMs: 2400, optional: true,
                         note: 'optional UI effect: one bright cell runs round the frame clockwise once per period (needs a per-frame redraw of the card)' } }
  };

  // ---- item card (epic section 4 mock-up): 34 x N cells, rows top -> bottom, compare block only with a worn item ----
  var card = {
    w: 34, padX: 1,
    plate: [10, 11, 16],          // literal RGB like uiStyle.itemGetCard.plate (cool night card); not a palette key
    text: {
      slotLine: 'uiHint',         // "Main hand  -  Level 5"
      base: 'uiText',             // base stats + built-in type lines (white)
      bonus: 'manaLight',         // rolled bonus lines (blue, every rarity)
      unique: 'emberHot',         // the unique effect line
      compareHead: 'uiHint',      // "vs worn Sword (Magic, Lv 4)"
      better: 'heroGreen', worse: 'vitalLight', same: 'uiDim'
    },
    rows: ['top frame', 'name + tag (tag right-aligned, 1 cell from the frame)', 'slot - Level', 'base stat lines',
           'built-in lines (axe crit damage, spear reach)', 'bonus lines', 'divider (only with a compare block)',
           'compare head', 'compare lines (one per stat)', 'bottom frame'],
    divider: { l: '|', m: '-', r: '|', note: 'divider uses the frame colour; glyph v-pattern char at both ends' },
    note: 'frame + name + tag in the rarity colours; never print a close hint (style-guide 0.5)'
  };
  // pack slot border per rarity: a 7 x 5 box round the 5 x 3 icon, the same corners / h / v as the card, frame colour.
  var slotFrame = { w: 7, h: 5, useRarity: true, emptyFrame: 'uiDim', note: 'common slots may stay with the plain slot border' };

  var LOOKS = [{ look: 0, iL: [1, 3] }, { look: 1, iL: [4, 6] }, { look: 2, iL: [7, 10] }];
  function lookForIL(iL) { return iL >= 7 ? 2 : iL >= 4 ? 1 : 0; }

  function validate(itemKeys, rgb) {
    var errs = [], t, i, r, j, ic, g, f;
    for (t in icons) {
      if (icons[t].length !== 3) errs.push(t + ': expected 3 looks');
      for (i = 0; i < icons[t].length; i++) {
        ic = icons[t][i];
        if (ic.glyphs.length !== 3 || ic.fg.length !== 3) { errs.push(t + '[' + i + ']: rows'); continue; }
        for (r = 0; r < 3; r++) {
          g = ic.glyphs[r]; f = ic.fg[r];
          if (g.length !== 5 || f.length !== 5) errs.push(t + '[' + i + '] row ' + r + ' not 5 wide (' + g.length + '/' + f.length + ')');
          for (j = 0; j < g.length; j++) {
            if (g.charCodeAt(j) < 32 || g.charCodeAt(j) > 126) errs.push(t + '[' + i + '] non-ASCII');
            if ((g.charAt(j) === ' ') !== (f.charAt(j) === ' ')) errs.push(t + '[' + i + '] row ' + r + ' col ' + j + ' glyph/fg space mismatch');
            if (f.charAt(j) !== ' ' && itemKeys && !itemKeys[f.charAt(j)]) errs.push(t + '[' + i + '] unknown icon key ' + f.charAt(j));
          }
        }
      }
      if (!glyphs[t]) errs.push(t + ': no glyph');
    }
    if (rgb) {
      for (t in glyphs) glyphs[t].forEach(function (gg) { if (!rgb[gg.c]) errs.push('glyph ' + t + ': unknown colour ' + gg.c); });
      rarity.order.forEach(function (k) { ['name', 'frame', 'corner', 'tagC'].forEach(function (f2) { if (!rgb[rarity[k][f2]]) errs.push('rarity.' + k + '.' + f2 + ': unknown colour ' + rarity[k][f2]); }); });
      for (t in card.text) if (!rgb[card.text[t]]) errs.push('card.text.' + t + ': unknown colour ' + card.text[t]);
      if (!rgb[slotFrame.emptyFrame]) errs.push('slotFrame.emptyFrame');
    }
    return errs;
  }

  A.itemLooks = {
    version: 1, looks: LOOKS, lookForIL: lookForIL, icons: icons, glyphs: glyphs,
    iconFor: function (type, iL) { var s = icons[type]; return s ? s[lookForIL(iL || 1)] : null; },
    rarity: rarity, card: card, slotFrame: slotFrame, validate: validate
  };
  if (typeof module === 'object' && module && module.exports) module.exports = A.itemLooks;
})(typeof window !== 'undefined' ? window : globalThis);
