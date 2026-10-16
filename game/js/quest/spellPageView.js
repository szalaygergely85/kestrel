// game/js/quest/spellPageView.js (SPELL-03, docs/epics/ep-spells.md section 3): the "Spells" page of the inventory screen.
// Four cards (D-021: Fireball, Freeze, Telekinesis, Teleport) in one row in learn order, joined by '-' (SPELL-R5). Pure view: spell data and the book are injected, strings are prebuilt
// at construct time, `draw` only walks them (0 alloc). No text mentions Esc (owner rule).
// Injected API (SPELL-01/02): defs = SPELL_DEFS (object keyed by id, or an array with ids) { name, glyph, color, tiers:[{mana, cd, dmg?, r?, ...} x3] };
// book = createSpellBook (tier(id) 0..3, canRaise(id)); scrolls() = Spell Scroll count; useScroll(id) = new level or 0 (main wraps spellScroll.useScroll).
const DEFAULT_RGB = [90, 220, 205];
import { learnHint } from './sim/spellBooks.js';
export const CARD = Object.freeze({ x0: 2, pitch: 24, w: 23, h: 6, y0: 4, detailY: 12, footY: 18, hintW: 19 });
let PUT = null, PW = 0; // draw-time put/width, so `text` is not a per-frame closure
function text(x, y, s, fg) { for (let j = 0; j < s.length && x + j < PW; j++) PUT(x + j, y, s.charCodeAt(j), fg); }
const NUM = (n) => String(Math.round(n * 100) / 100);
/** One plain line from a tier row, e.g. "5 mp, dmg 3, radius 2" (only fields that exist are shown). */
export function tierText(row) {
  const p = [row.mana + ' mp'];
  if (row.dmg != null) p.push('dmg ' + NUM(row.dmg));
  if (row.r != null) p.push('radius ' + NUM(row.r));
  if (row.range != null) p.push('range ' + NUM(row.range) + ' m');
  if (row.knock != null) p.push('knock ' + NUM(row.knock));
  if (row.stun != null) p.push('stun ' + NUM(row.stun) + ' s');
  if (row.stagger != null) p.push('stagger ' + NUM(row.stagger) + ' s');
  if (row.absorb != null) p.push('absorbs ' + NUM(row.absorb) + ' hp');
  if (row.dur != null) p.push('lasts ' + NUM(row.dur) + ' s');
  if (row.height != null) p.push('height ' + NUM(row.height) + ' m');
  p.push('cooldown ' + NUM(row.cd) + ' s');
  return p.join(', ');
}

/** Word-wrap to at most 2 lines of w chars (construct time only). */
function wrap(s, w) {
  const out = ['', '']; let l = 0;
  for (const word of s.split(' ')) { if (out[l] && out[l].length + 1 + word.length > w && l < 1) l++; out[l] = out[l] ? out[l] + ' ' + word : word; }
  return out;
}

/** @param {object} o {defs, book, scrolls, useScroll, rgb?, colors:{text,dim,hint,gold,frame}, say?} */
export function createSpellPageView(o) {
  const list = Array.isArray(o.defs) ? o.defs : Object.keys(o.defs).map((id) => ({ id, ...o.defs[id] }));
  const shown = list.filter((d) => learnHint(d.id) !== null || (o.book.tier(d.id) | 0) > 0); // no hint and not learned: card hidden
  const K = o.colors, book = o.book;
  const cards = []; // flat, column-major; each prebuilt
  const pips = ['[---]', '[#--]', '[##-]', '[###]'];
  {
    shown.forEach((d, i) => {
      const ci = i;
      const rgbk = (o.rgb && o.rgb[d.color || d.colour]) || DEFAULT_RGB;
      const stat = [], now = [], next = [], plain = [], conf = [];
      for (let t = 0; t < 4; t++) {
        stat.push(t ? pips[t] + ' mp ' + d.tiers[t - 1].mana + ' cd ' + NUM(d.tiers[t - 1].cd) + ' s' : '');
        now.push(t ? 'Now: ' + tierText(d.tiers[t - 1]) : '');
        next.push(t === 0 ? '' : t >= 3 ? 'Max level' : 'Next level: ' + tierText(d.tiers[t]));
        plain.push(d.name + (t ? '  level ' + t : '  not learned'));
        conf.push(t >= 3 ? '' : 'Raise ' + d.name + ' to level ' + (t + 1) + '?  [E] Yes  [Q] No');
      }
      cards.push({ hint: learnHint(d.id) || '', hl: wrap(learnHint(d.id) || '', CARD.hintW), d, ci, x: CARD.x0 + ci * CARD.pitch, y: CARD.y0, rgb: rgbk, name: d.name, stat, now, next, head: plain, conf, glyph: (d.glyph || '*').charCodeAt(0) });
    });
  }
  const scrollStr = []; const getScroll = (n) => scrollStr[n] || (scrollStr[n] = 'Spell Scrolls: ' + n);
    let sel = 0, confirm = false;

  const n = cards.length;
  function move(dc) { if (dc) sel = (sel + dc + n) % n; }
  const anyRaisable = () => { for (let i = 0; i < cards.length; i++) if (book.canRaise(cards[i].d.id)) return true; return false; };
  const canRaise = (c) => o.scrolls() > 0 && !!book.canRaise(c.d.id);
  const view = {
    get selected() { return cards[sel] ? cards[sel].d.id : null; },
    get confirming() { return confirm; },
    reset() { sel = 0; confirm = false; },
    /** @returns true when the key press was consumed */
    step(input) {
      if (!cards.length) return false;
      const c = cards[sel];
      if (confirm) {
        if (input.pressed('KeyE') || input.pressed('Enter') || input.pressed('NumpadEnter')) {
          confirm = false;
          const l = o.useScroll(c.d.id);
          if (l && o.say) o.say(c.name + ' is now level ' + l, K.good);
        } else if (input.pressed('KeyQ') || input.pressed('Backspace')) confirm = false;
        return true;
      }
      if (input.pressed('KeyA') || input.pressed('ArrowLeft')) move(-1);
      if (input.pressed('KeyD') || input.pressed('ArrowRight')) move(1);
      if ((input.pressed('KeyE') || input.pressed('Enter') || input.pressed('NumpadEnter')) && canRaise(c)) confirm = true;
      return true;
    },
    /** @param {(x:number,y:number,code:number,fg:number[])=>void} put panel-relative; the caller fills the background */
    draw(put, W) {
      PUT = put; PW = W;
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i], t = book.tier(c.d.id) | 0, s = i === sel, fg = s ? K.gold : K.frame, w = CARD.w;
        for (let x = 1; x < w - 1; x++) { put(c.x + x, c.y, 45, fg); put(c.x + x, c.y + CARD.h - 1, 45, fg); }
        for (let y = 1; y < CARD.h - 1; y++) { put(c.x, c.y + y, 124, fg); put(c.x + w - 1, c.y + y, 124, fg); }
        put(c.x, c.y, 43, fg); put(c.x + w - 1, c.y, 43, fg); put(c.x, c.y + CARD.h - 1, 43, fg); put(c.x + w - 1, c.y + CARD.h - 1, 43, fg);
        if (i < cards.length - 1) put(c.x + w, c.y + 2, 45, K.frame); // tree link
        const dim = t === 0;
        put(c.x + 2, c.y + 1, c.glyph, dim ? K.dim : c.rgb);
        text(c.x + 4, c.y + 1, c.name, dim ? K.dim : K.text);
        if (dim) { text(c.x + 2, c.y + 2, 'Not learned', K.dim); text(c.x + 2, c.y + 3, c.hl[0], K.dim); text(c.x + 2, c.y + 4, c.hl[1], K.dim); } else text(c.x + 2, c.y + 2, c.stat[t], K.text);
      }
      const c = cards[sel]; if (!c) return;
      const t = book.tier(c.d.id) | 0;
      text(CARD.x0, CARD.detailY, c.head[t], c.rgb);
      if (t === 0) text(CARD.x0, CARD.detailY + 1, 'Not learned yet. ' + c.hint, K.dim);
      else { text(CARD.x0, CARD.detailY + 1, c.now[t], K.text); text(CARD.x0, CARD.detailY + 2, c.next[t], t >= 3 ? K.dim : K.good); }
      const n = o.scrolls() | 0;
      text(CARD.x0, CARD.footY, getScroll(n), K.text);
      if (confirm) {
        text(CARD.x0, CARD.footY + 1, c.conf[t], K.gold);
      } else if (canRaise(c)) text(CARD.x0, CARD.footY + 1, '[E] Use Spell Scroll', K.gold);
      else if (n > 0 && !anyRaisable()) text(CARD.x0, CARD.footY + 1, 'No spell can learn from this yet.', K.dim);
    },
  };
  return view;
}
