import { createPlatform } from './platform.js';
// tools/chargen/ui.js (CHARGEN-13): recipe controls, seed field, export/save buttons. Pure parts (controlsFor,
// applyControl, readControl, debounce, seedFromText) have no DOM and are node-tested; mountUi() is the only DOM code.
const HEIGHT_MIN = -4, HEIGHT_MAX = 4, AGES = ['young', 'adult', 'elder'];
const dyeGroupOf = (slot) => (slot === 'beard' ? 'hair' : slot);
const SLOT_ORDER = ['hair', 'beard', 'top', 'legs', 'feet', 'outer', 'hat'];

/** Control descriptors for a kit. kind: 'select' | 'range' | 'item' (item select + dye-ramp select). */
export function controlsFor(kit) {
  const items = [...(kit.shells || []), ...(kit.attachments || [])];
  const slots = SLOT_ORDER.filter((s) => items.some((i) => i.slot === s));
  const ramps = kit.ramps || {};
  const names = (o) => Object.keys(o || {}).map((v) => ({ value: v, label: v }));
  return [
    { key: 'base', kind: 'select', label: 'Body', options: Object.keys(kit.bases).map((id) => ({ value: id, label: kit.bases[id].label || id })) },
    { key: 'height', kind: 'range', label: 'Height', min: HEIGHT_MIN, max: HEIGHT_MAX, step: 1 },
    { key: 'age', kind: 'select', label: 'Age', options: AGES.map((a) => ({ value: a, label: a })) },
    { key: 'skin', kind: 'select', label: 'Skin', options: names(ramps.skin) },
    { key: 'eyes', kind: 'select', label: 'Eyes', options: names(ramps.eyes) },
    ...slots.map((slot) => ({
      key: slot, kind: 'item', label: slot,
      items: items.filter((i) => i.slot === slot).map((i) => ({ value: i.id, label: i.name || i.id })),
      ramps: Object.keys(ramps[dyeGroupOf(slot)] || {}),
    })),
  ];
}

/** Returns a NEW recipe with one control change applied. Item controls: field 'id' ('' = none) or 'ramp'. */
export function applyControl(recipe, key, value, field = null, kit = null) {
  const r = JSON.parse(JSON.stringify(recipe));
  if (key === 'height') { r.height = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(Number(value)))); return r; }
  if (!field) { r[key] = value; return r; }
  const cur = r[key];
  if (field === 'id') {
    if (value === '' || value == null) { r[key] = null; return r; }
    const ramps = (kit && kit.ramps && kit.ramps[dyeGroupOf(key)]) || {};
    r[key] = { id: value, ramp: (cur && cur.ramp) || Object.keys(ramps)[0] };
  } else if (cur) r[key] = { ...cur, [field]: value };
  return r;
}

/** Current value of a control read back from a recipe (inverse of applyControl). */
export function readControl(recipe, ctl) {
  if (ctl.kind === 'item') { const p = recipe[ctl.key]; return { id: p ? p.id : '', ramp: p ? p.ramp : (ctl.ramps[0] || '') }; }
  return recipe[ctl.key];
}

/** Trailing debounce; `timers` is injectable for tests. cancel() drops a pending call. */
// Default timers are wrapped: a bare { setTimeout } object calls window.setTimeout with the wrong `this`
// ("Illegal invocation" in browsers, fine in Node), which silently stopped every rebuild.
const WIN_TIMERS = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) };
export function debounce(fn, ms, timers = WIN_TIMERS) {
  let h = null;
  const d = (...a) => { if (h !== null) timers.clearTimeout(h); h = timers.setTimeout(() => { h = null; fn(...a); }, ms); };
  d.cancel = () => { if (h !== null) { timers.clearTimeout(h); h = null; } };
  return d;
}

/** Seed field text -> uint seed ('' = fresh random). Non-numeric text is hashed so any word works. */
export function seedFromText(text, rnd = Math.random) {
  const t = String(text).trim();
  if (t === '') return Math.floor(rnd() * 0x7fffffff);
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- DOM (browser only) ----
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
};

/**
 * Builds the side panel into `root`. cb: { onRecipe(recipe), onSeed(seed), onClip(name), onPlay(bool),
 * onScrub(t01), onTurntable(bool) }. Returns { setRecipe, setClips, setTime, status }.
 */
export function mountUi(root, { kit, chargen, cb, platform = createPlatform() }) {
  const ctls = controlsFor(kit);
  const rows = new Map();
  const status = el('div', { class: 'status' });
  const note = (m) => { status.textContent = m; };
  const emit = (r) => { chargen.setRecipe(r); cb.onRecipe(r); };
  const fill = (sel, list, withNone) => {
    if (withNone) sel.append(el('option', { value: '' }, '(none)'));
    for (const o of list) sel.append(el('option', { value: o.value }, o.label));
    return sel;
  };

  const panel = el('div', { class: 'group' }, el('h2', {}, 'Character'));
  for (const c of ctls) {
    const row = el('label', { class: 'row' }, el('span', {}, c.label));
    if (c.kind === 'select') {
      const s = fill(el('select'), c.options);
      s.addEventListener('change', () => emit(applyControl(chargen.recipe, c.key, s.value, null, kit)));
      row.append(s); rows.set(c.key, { s });
    } else if (c.kind === 'range') {
      const out = el('output'); const s = el('input', { type: 'range', min: c.min, max: c.max, step: c.step });
      s.addEventListener('input', () => { out.textContent = s.value; emit(applyControl(chargen.recipe, c.key, s.value, null, kit)); });
      row.append(s, out); rows.set(c.key, { s, out });
    } else {
      const id = fill(el('select'), c.items, true), ramp = fill(el('select'), c.ramps.map((v) => ({ value: v, label: v })));
      id.addEventListener('change', () => emit(applyControl(chargen.recipe, c.key, id.value, 'id', kit)));
      ramp.addEventListener('change', () => emit(applyControl(chargen.recipe, c.key, ramp.value, 'ramp', kit)));
      row.append(id, ramp); rows.set(c.key, { id, ramp });
    }
    panel.append(row);
  }
  const seed = el('input', { type: 'text', placeholder: 'seed, Enter to replay', size: 12, id: 'seed' });
  // Random always rolls a fresh seed (the field shows it so it can be shared); Enter in the field replays a typed seed.
  const random = el('button', { id: 'random', onclick: () => { const s = seedFromText(''); seed.value = String(s); cb.onSeed(s); } }, 'Random');
  seed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const s = seedFromText(seed.value); seed.value = String(s); cb.onSeed(s); } });
  panel.append(el('div', { class: 'row' }, seed, random));

  let playing = true;
  const clipSel = el('select'); clipSel.addEventListener('change', () => cb.onClip(clipSel.value));
  const play = el('button', { onclick: () => { playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; cb.onPlay(playing); } }, 'Pause');
  const scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0 });
  scrub.addEventListener('input', () => { playing = false; play.textContent = 'Play'; cb.onPlay(false); cb.onScrub(scrub.value / 1000); });
  const turn = el('input', { type: 'checkbox', checked: '' });
  turn.addEventListener('change', () => cb.onTurntable(turn.checked));
  const anim = el('div', { class: 'group' }, el('h2', {}, 'Animation'), el('div', { class: 'row' }, clipSel, play), el('div', { class: 'row' }, scrub),
    el('label', { class: 'row' }, turn, el('span', {}, 'Turntable')));

  const run = (fn) => async () => { try { note('working...'); await fn(); note('done'); } catch (e) { note(String(e.message || e)); console.error(e); } };
  const btn = (label, fn, disabled = false) => {
    const b = el('button', { onclick: run(fn) }, label);
    if (disabled) { b.disabled = true; b.title = 'needs CHARGEN-12'; }
    return b;
  };
  const KFILT = [{ name: 'Kestrel package', extensions: ['kestrel', 'zip'] }];
  const save = (name, bytes, ext) => platform.saveFile(name, bytes, [{ name: ext, extensions: [ext] }]);
  const exp = el('div', { class: 'group' }, el('h2', {}, 'Export'),
    btn('.glb', () => save('character.glb', chargen.exportGlb(), 'glb')),
    btn('.fbx (+ png)', async () => { const { fbx, png } = chargen.exportFbx(); if (await save('character.fbx', fbx, 'fbx')) await save('palette.png', png, 'png'); }),
    btn('.vox', () => save('character.vox', chargen.exportVox(), 'vox')),
    btn('.obj (+ mtl, png zip)', async () => save('character-obj.zip', await chargen.exportObjZip(), 'zip')),
    btn('All formats (.zip)', async () => save('character.zip', await chargen.exportAllZip(), 'zip')));
  const pkg = el('div', { class: 'group' }, el('h2', {}, 'Project'),
    btn('Save .kestrel', async () => save('character.kestrel', await chargen.savePackage({ name: 'Character' }), 'kestrel')),
    btn('Open .kestrel', async () => {
      const f = await platform.openFile(KFILT); if (!f) return;
      const r = await chargen.openPackage(f.bytes);
      api.setRecipe(r); cb.onRecipe(r);
    }));

  root.append(panel, anim, exp, pkg, status);

  const api = {
    /** Writes a recipe into the controls (no callbacks fired). */
    setRecipe(r) {
      for (const c of ctls) {
        const w = rows.get(c.key), v = readControl(r, c);
        if (c.kind === 'item') { w.id.value = v.id; w.ramp.value = v.ramp; w.ramp.disabled = !v.id; }
        else { w.s.value = v; if (w.out) w.out.textContent = v; }
      }
    },
    setClips(names) { clipSel.replaceChildren(); fill(clipSel, names.map((n) => ({ value: n, label: n }))); anim.style.display = names.length ? '' : 'none'; },
    setTime(t01) { scrub.value = Math.round(t01 * 1000); },
    status: note,
  };
  api.setRecipe(chargen.recipe);
  return api;
}
