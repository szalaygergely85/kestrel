// tools/editor/aiPanel.js - ED-AI-03. "Creatures" tab. createCreatures() is the pure controller (list/filter, form edits ->
// undoable model commands, slider drag = one undo step on release, live patch, reset, save); mountAiPanel() is the thin DOM.
import { setArchField, setAttackField, validateModel, saveArchetypes, makeStack } from './ai/model.js';
import { ARCH_FIELDS, ARCH_GROUPS, ATTACK_FIELDS, clampField, boundsOf, specOf, attackNote } from './ai/form.js';
import { MAX_ATTACKS } from './ai/validate.js';
import { createPatchBridge } from './ai/patchBridge.js';
import { RESPAWN_CHOICES, WHEN_CHOICES, BRUSH_R_MIN, BRUSH_R_MAX } from './aiAreaTool.js';

export function createCreatures({ model, stack = makeStack(), bridge = null, fs, onChange = () => {} }) {
  const st = { filter: '', refusal: {}, flags: {}, drag: null };
  const kindsOf = (arch) => Object.keys(model.kinds).filter((k) => model.kinds[k].arch === arch);
  const clamp = (spec, raw, attack, fallback, flagKey) => {
    const r = clampField(spec, raw, attack, fallback);
    st.flags[flagKey] = r.clamped;
    return r.value;
  };
  const api = {
    st, stack,
    list(filter = st.filter) {
      const f = filter.trim().toLowerCase();
      const hit = (s) => !f || s.toLowerCase().includes(f);
      return {
        archetypes: Object.keys(model.arch).filter((n) => hit(n) || kindsOf(n).some((k) => hit(model.kinds[k].name))),
        kinds: Object.keys(model.kinds).filter((k) => hit(model.kinds[k].name) || hit(k)),
      };
    },
    /** Slider drag: live patch only, no undo step. Call release() when the pointer goes up. */
    dragArch(name, key, raw) {
      const v = clamp(specOf(ARCH_FIELDS, key), raw, null, model.arch[name][key], `${name}.${key}`);
      st.drag = { name, key, value: v };
      if (bridge) bridge.sendPatch(name, { [key]: v });
      return v;
    },
    release() {
      const d = st.drag; st.drag = null; if (!d) return false;
      return api.setArch(d.name, d.key, d.value, true);
    },
    /** One committed edit = one undo step. */
    setArch(name, key, raw, alreadyClamped = false) {
      const v = alreadyClamped ? raw : clamp(specOf(ARCH_FIELDS, key), raw, null, model.arch[name][key], `${name}.${key}`);
      if (v === model.arch[name][key]) { if (bridge) bridge.sendPatch(name, { [key]: v }); return false; }
      stack.run(setArchField(model, name, key, v));
      if (bridge) bridge.sendPatch(name, { [key]: v });
      onChange(); return true;
    },
    setAttack(kind, idx, key, raw) {
      const at = model.kinds[kind].attacks[idx];
      const v = clamp(specOf(ATTACK_FIELDS, key), raw, at, at[key], `${kind}.${idx}.${key}`);
      if (v === at[key]) return false;
      stack.run(setAttackField(model, kind, idx, key, v));
      onChange(); return true;
    },
    attackBounds: (kind, idx, key) => boundsOf(specOf(ATTACK_FIELDS, key), model.kinds[kind].attacks[idx]),
    attackNote: (kind, idx) => attackNote(model.kinds[kind].attacks[idx]),
    canAddAttack: (kind) => model.kinds[kind].attacks.length < MAX_ATTACKS,
    errors: () => validateModel(model),
    undo() { const r = stack.undo(); if (r) { api.resend(); onChange(); } return r; },
    redo() { const r = stack.redo(); if (r) { api.resend(); onChange(); } return r; },
    /** Re-send every archetype (after undo/redo/reset the game must follow the model). */
    resend() { if (bridge) for (const n of Object.keys(model.arch)) bridge.sendPatch(n, { ...model.arch[n] }); },
    /** "Reset to saved": one undo step restoring the saved data. */
    reset() {
      const f = Object.values(model.files); let before = null;
      stack.run({ label: 'reset to saved',
        apply() { if (before === null) before = f.map((x) => JSON.stringify(x.obj)); f.forEach((x) => { x.obj = JSON.parse(x.snap); }); },
        undo() { f.forEach((x, i) => { x.obj = JSON.parse(before[i]); }); } });
      api.resend(); onChange();
    },
    /** The game's { name, ok, refused } echo. */
    onResult(r) { if (r.ok) delete st.refusal[r.name]; else st.refusal[r.name] = r.refused; onChange(); },
    save() {
      const e = api.errors();
      if (e.length) return { ok: false, errors: e };
      return { ok: true, ...saveArchetypes(model, fs) };
    },
  };
  return api;
}

// ---- thin DOM (not covered by Node tests; checked by --check only) ----
export function mountAiPanel(root, { model, fs, channel, areaTool = null }) {
  let ctl;
  const bridge = createPatchBridge({ channel, onResult: (r) => ctl.onResult(r) });
  ctl = createCreatures({ model, bridge, fs, onChange: render });
  let sel = { arch: Object.keys(model.arch)[0], kind: null };
  const h = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
  function numRow(spec, value, on, drag, release, flag, bounds) {
    const row = h('div', 'ai-row'); row.append(h('label', '', spec.label + (spec.unit ? ` (${spec.unit})` : '')));
    const [lo, hi] = bounds || [spec.min, spec.max];
    const sl = h('input'); sl.type = 'range'; sl.min = lo; sl.max = hi; sl.step = spec.step; sl.value = Math.min(value, hi);
    const nb = h('input'); nb.type = 'number'; nb.step = spec.step; nb.value = value; nb.style.width = '64px';
    sl.oninput = () => { nb.value = sl.value; drag(sl.value); }; sl.onchange = () => release();
    nb.onchange = () => on(nb.value);
    row.append(sl, nb); if (flag) row.append(h('span', 'ai-flag', ' clamped'));
    if (spec.special !== undefined && value === spec.special) row.append(h('span', '', ' ' + spec.specialLabel));
    return row;
  }
  // ---- ED-AI-05 / ED-AI-06: spawn areas + drop pack (logic in aiAreaTool.js) ----
  function renderAreas(status) {
    const t = areaTool, S = t.st, names = Object.keys(model.kinds);
    const box = h('div', 'ai-areas'); box.append(h('b', '', 'Spawn areas'));
    const sel = (opts, val, on) => { const d = h('select'); opts.forEach(([l, v]) => { const o = h('option', '', l); o.value = v; d.append(o); }); d.value = val; d.onchange = () => on(d.value); return d; };
    const row = (label, el) => { const r = h('div', 'ai-row'); r.append(h('label', '', label), el); box.append(r); };
    const bar = h('div'); const mk = (txt, fn, on) => { const b = h('button', 'ed-btn' + (on ? ' active' : ''), txt); b.type = 'button'; b.onclick = fn; bar.append(b); };
    mk(S.armed ? 'Painting: on' : 'Paint areas', () => t.arm(!S.armed), S.armed);
    mk('Disc', () => { S.mode = 'disc'; t.cancel(); }, S.mode === 'disc'); mk('Polygon', () => { S.mode = 'polygon'; t.cancel(); }, S.mode === 'polygon');
    if (S.mode === 'polygon') mk('Finish polygon', () => t.finish());
    mk('Undo', () => t.undo()); mk('Redo', () => t.redo());
    mk('Save areas', () => { const r = t.save(fs); const bad = Object.keys(t.invalid()).length; status.textContent = `saved ${r.written.join(', ') || '(no changes)'}` + (bad ? ` - ${bad} area(s) marked, check them` : ''); });
    if (S.connected !== true) mk('Reload to apply', () => t.reloadToApply()); // only when no game page answered the ping
    box.append(bar);
    row('Creature', sel(names.map((k) => [model.kinds[k].name, k]), S.brush.kind, (v) => t.setBrush('kind', v)));
    const cnt = h('input'); cnt.type = 'number'; cnt.min = 1; cnt.max = 12; cnt.value = S.brush.count; cnt.style.width = '64px'; cnt.onchange = () => t.setBrush('count', Number(cnt.value)); row('How many', cnt);
    row('Comes back after', sel(RESPAWN_CHOICES, S.brush.respawnSec, (v) => t.setBrush('respawnSec', Number(v))));
    row('Active', sel(WHEN_CHOICES, S.brush.when, (v) => t.setBrush('when', v)));
    const rad = h('input'); rad.type = 'range'; rad.min = BRUSH_R_MIN; rad.max = BRUSH_R_MAX; rad.value = S.radius; rad.oninput = () => { S.radius = Number(rad.value); }; row(`Brush radius (m)`, rad);
    if (S.msg) box.append(h('div', 'ai-flag', S.msg));
    if (S.dirtyLive && S.connected === false) box.append(h('i', '', 'Changes show in the game after "Reload to apply".'));
    const bad = t.invalid();
    t.model.areas.forEach((a) => {
      const line = h('div', 'ai-row'), b = h('button', 'ed-btn' + (a.id === S.sel ? ' active' : ''), `${model.kinds[a.kind] ? model.kinds[a.kind].name : a.kind} x${a.count} (${a.id})`); b.type = 'button'; b.onclick = () => t.select(a.id);
      const x = h('button', 'ed-btn', 'Delete'); x.type = 'button'; x.onclick = () => t.remove(a.id); line.append(b, x); box.append(line);
      if (bad[a.id]) bad[a.id].forEach((m) => box.append(h('div', 'ai-flag', m)));
    });
    box.append(h('b', '', 'Try it in the game'));
    row('Pack', sel(names.map((k) => [model.kinds[k].name, k]), S.dropKind, (v) => { S.dropKind = v; }));
    const dc = h('input'); dc.type = 'number'; dc.min = 0; dc.max = 12; dc.value = S.dropCount; dc.style.width = '64px'; dc.onchange = () => { S.dropCount = Number(dc.value); }; row('How many (0 = usual)', dc);
    const bar2 = h('div'); const dp = h('button', 'ed-btn' + (S.dropArmed ? ' active' : ''), S.dropArmed ? 'Click the ground...' : 'Drop pack here'); dp.type = 'button'; dp.onclick = () => { S.dropArmed = !S.dropArmed; t.arm(false); };
    const cl = h('button', 'ed-btn', 'Clear test creatures'); cl.type = 'button'; cl.onclick = () => t.clearTest(); bar2.append(dp, cl); box.append(bar2);
    root.append(box);
  }
  function render() {
    root.textContent = '';
    const f = h('input'); f.placeholder = 'Filter'; f.value = ctl.st.filter; f.oninput = () => { ctl.st.filter = f.value; render(); };
    const status = h('div', 'ai-status'), bar = h('div');
    const mk = (t, fn) => { const b = h('button', 'ed-btn', t); b.type = 'button'; b.onclick = fn; bar.append(b); };
    mk('Undo', () => ctl.undo()); mk('Redo', () => ctl.redo()); mk('Reset to saved', () => ctl.reset());
    mk('Save', () => { const r = ctl.save(); status.textContent = r.ok ? `saved ${r.written.join(', ') || '(no changes)'}` : r.errors[0]; });
    root.append(f, bar, status);
    if (areaTool) renderAreas(status);
    const L = ctl.list(), ul = h('div');
    L.archetypes.forEach((n) => { const b = h('button', 'ed-btn', n); b.type = 'button'; b.onclick = () => { sel = { arch: n, kind: null }; render(); }; ul.append(b); });
    L.kinds.forEach((k) => { const b = h('button', 'ed-btn', model.kinds[k].name); b.type = 'button'; b.onclick = () => { sel = { arch: model.kinds[k].arch, kind: k }; render(); }; ul.append(b); });
    root.append(ul);
    const a = model.arch[sel.arch]; if (!a) return;
    if (ctl.st.refusal[sel.arch]) root.append(h('div', 'ai-flag', 'Game refused: ' + ctl.st.refusal[sel.arch].join('; ')));
    for (const g of ARCH_GROUPS) {
      root.append(h('b', '', g));
      for (const s of ARCH_FIELDS.filter((x) => x.group === g)) {
        if (s.enum) {
          const dd = h('select'); s.enum.forEach((o) => { const op = h('option', '', o); op.value = o; dd.append(op); });
          dd.value = a[s.key]; dd.onchange = () => ctl.setArch(sel.arch, s.key, dd.value);
          const r = h('div', 'ai-row'); r.append(h('label', '', s.label), dd); root.append(r); continue;
        }
        root.append(numRow(s, a[s.key], (v) => ctl.setArch(sel.arch, s.key, v), (v) => ctl.dragArch(sel.arch, s.key, v), () => ctl.release(), ctl.st.flags[`${sel.arch}.${s.key}`]));
      }
    }
    if (sel.kind) {
      root.append(h('b', '', 'Attacks of ' + model.kinds[sel.kind].name));
      model.kinds[sel.kind].attacks.forEach((at, i) => {
        const note = ctl.attackNote(sel.kind, i);
        root.append(h('i', '', `Attack ${i + 1}: ${at.id}` + (note ? ' - ' + note : '')));
        for (const s of ATTACK_FIELDS.filter((x) => !x.text)) root.append(numRow(s, at[s.key], (v) => ctl.setAttack(sel.kind, i, s.key, v), () => {}, () => {}, ctl.st.flags[`${sel.kind}.${i}.${s.key}`], ctl.attackBounds(sel.kind, i, s.key)));
      });
    }
  }
  render();
  return { ctl, render, bridge };
}

/** Browser glue: loads the two JSON files over http, saves by download (like the Quests tab), BroadcastChannel to the game tab. */
export async function mountCreaturesTab(root, deps = {}) {
  const get = async (n) => (await fetch(`../../content/beasts/${n}`)).text();
  let sa = ''; try { sa = await get('spawnAreas.json'); } catch (e) { sa = ''; }
  const files = { 'archetypes.json': await get('archetypes.json'), 'kinds.json': await get('kinds.json'), 'spawnAreas.json': sa };
  const fs = { readFileSync: (p) => files[p.split('/').pop()], writeFileSync: (p, t) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'application/json' })); a.download = p.split('/').pop(); a.click(); } };
  const { loadArchetypes } = await import('./ai/model.js');
  const bc = new BroadcastChannel('kestrel-ai-patch');
  const channel = { post: (m) => bc.postMessage(m), set onmessage(fn) { bc.onmessage = (e) => { const d = e.data; if (d && (d.type === 'ai-pong' || d.type === 'ai-areas-result') && d.ok !== false) { if (handle && handle.areaTool) handle.areaTool.onPong(); } fn(e.data); }; } };
  const { loadSpawnAreas, makeStack: mkStack } = await import('./ai/model.js');
  const { createAreaTool } = await import('./aiAreaTool.js');
  const model = loadArchetypes('content/beasts', fs);
  const raw = { post: (m) => bc.postMessage(m) };
  let handle;
  const areaTool = createAreaTool({ model: loadSpawnAreas('content/beasts', fs), kinds: model.kinds, stack: mkStack(), probe: deps.probe || (() => ({ z: 0, walkable: true })),
    channel: raw, reload: deps.reload || (() => {}), seed: () => (Date.now() & 0x7fffffff), onChange: () => { if (handle) handle.render(); if (deps.onAreasChange) deps.onAreasChange(); } });
  handle = mountAiPanel(root, { model, fs, channel, areaTool });
  handle.areaTool = areaTool; handle.kindName = (k) => (model.kinds[k] ? model.kinds[k].name : k); return handle;
}
