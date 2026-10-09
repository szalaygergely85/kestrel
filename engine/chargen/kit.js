// engine/chargen/kit.js (CHARGEN-02, docs/architecture.md 38.29 item 3/4): kit constants and validateKit.
// Pure data in, messages out. Imports nothing. Kit shape used here (the designer's CHARGEN-01 JSON follows it):
//   skeleton:[{name,parent}] (parents before children)   cellM?:0.025
//   bases:{id:{size:[sx,sy,sz], anchor:[x,y,z], layers:string[z][y] (each string sx chars, '.'/' ' = empty),
//             bones:{name:{joint:[x,y,z], box:[x0,y0,z0,x1,y1,z1] (inclusive)}}, anchors:{name:[x,y,z]},
//             stretchRows:int[] (z rows CHARGEN-05 may duplicate/delete)}}
//   slots:{char:{group,shade}|{fixed:matKey}}   ramps:{group:{rampId:{shade:matKey}}}
//   shells:[{id,slot,regions:[{bone,t0,t1}],thick:0|1|2,paint:char}]
//   attachments:[{id,slot,bone,anchor,offset:[x,y,z],box:[sx,sy,sz],layers,paintOnly?,hides?:slot[]}]
//   clips / random: passed through untouched (CHARGEN-03/05).

/** Recipe slots; SHELL_ORDER then ATTACH_ORDER is the compose order. */
export const SHELL_ORDER = ['legs', 'feet', 'top', 'outer'];
export const ATTACH_ORDER = ['hair', 'beard', 'hat'];
export const SLOTS = [...SHELL_ORDER, ...ATTACH_ORDER];
/** Ramp group a recipe slot dyes (beard shares the hair group). */
export const dyeGroupOf = (slot) => (slot === 'beard' ? 'hair' : slot);
/** Bones whose rows may be duplicated/deleted for height (waist and shin only). */
export const STRETCH_BONES = ['Hips', 'Spine', 'LeftLowerLeg', 'RightLowerLeg'];
export const MAX_MATERIALS = 255;

export const isEmptyChar = (c) => c === '.' || c === ' ';
const isInt = Number.isInteger;
const isVec = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);

/** knownMats: Set, array or plain object of material keys. */
function matSet(known) {
  if (known instanceof Set) return known;
  if (Array.isArray(known)) return new Set(known);
  return new Set(Object.keys(known || {}));
}

/** Layout check of a layers array against size [sx,sy,sz]; pushes errors, returns the non-empty chars used. */
function checkLayers(layers, size, where, err) {
  const chars = new Set();
  if (!Array.isArray(layers) || layers.length !== size[2]) { err(`${where}: layers must be ${size[2]} z-slices`); return chars; }
  for (let z = 0; z < layers.length; z++) {
    const rows = layers[z];
    if (!Array.isArray(rows) || rows.length !== size[1]) { err(`${where}: layer ${z} must have ${size[1]} rows`); continue; }
    for (let y = 0; y < rows.length; y++) {
      if (typeof rows[y] !== 'string' || rows[y].length !== size[0]) { err(`${where}: layer ${z} row ${y} must be a string of ${size[0]} chars`); continue; }
      for (const c of rows[y]) if (!isEmptyChar(c)) chars.add(c);
    }
  }
  return chars;
}

/** @returns {{errors:string[], warnings:string[]}} */
export function validateKit(kit, knownMats) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  if (!kit || typeof kit !== 'object') return { errors: ['kit: not an object'], warnings };
  const known = matSet(knownMats);

  // skeleton
  const bones = new Map();
  if (!Array.isArray(kit.skeleton) || !kit.skeleton.length) err('skeleton: missing or empty');
  else {
    kit.skeleton.forEach((b, i) => {
      if (!b || typeof b.name !== 'string') { err(`skeleton[${i}]: name missing`); return; }
      if (bones.has(b.name)) err(`skeleton: duplicate bone "${b.name}"`);
      if (b.parent == null) { if ([...bones.values()].some((x) => x.parent == null)) err(`skeleton: second root "${b.name}"`); }
      else if (!bones.has(b.parent)) err(`skeleton: bone "${b.name}" parent "${b.parent}" is unknown or listed after it`);
      bones.set(b.name, { index: i, parent: b.parent ?? null });
    });
  }

  // slots + ramps -> materials
  const slots = kit.slots || {};
  const ramps = kit.ramps || {};
  const usedChars = new Set(Object.keys(slots));
  for (const [ch, s] of Object.entries(slots)) {
    if (ch.length !== 1) err(`slots: key "${ch}" must be one character`);
    if (s && s.fixed !== undefined) { if (!known.has(s.fixed)) err(`slots["${ch}"]: unknown material key "${s.fixed}"`); }
    else if (!s || typeof s.group !== 'string' || !ramps[s.group]) err(`slots["${ch}"]: group "${s && s.group}" has no ramps`);
  }
  // worst-case distinct materials one character can use: fixed keys + the widest ramp of each group
  let worst = new Set(Object.values(slots).filter((s) => s && s.fixed !== undefined).map((s) => s.fixed)).size;
  for (const [g, set] of Object.entries(ramps)) {
    let most = 0;
    for (const [id, ramp] of Object.entries(set || {})) {
      const keys = new Set();
      for (const [shade, key] of Object.entries(ramp || {})) {
        if (!known.has(key)) err(`ramps.${g}.${id}.${shade}: unknown material key "${key}"`);
        keys.add(key);
      }
      most = Math.max(most, keys.size);
    }
    worst += most;
  }
  if (worst > MAX_MATERIALS) err(`ramps: a character can need ${worst} materials (max ${MAX_MATERIALS})`);

  // bases
  const bases = kit.bases || {};
  if (!Object.keys(bases).length) err('bases: none');
  for (const [bid, base] of Object.entries(bases)) {
    const W = `bases.${bid}`;
    if (!base || !isVec(base.size, 3) || !base.size.every((n) => isInt(n) && n > 0)) { err(`${W}: size must be 3 positive ints`); continue; }
    const [sx, sy, sz] = base.size;
    const chars = checkLayers(base.layers, base.size, W, err);
    for (const c of chars) if (!usedChars.has(c)) err(`${W}: layer char "${c}" has no slot`);
    const boxes = [];
    for (const [name, b] of Object.entries(base.bones || {})) {
      if (!bones.has(name)) { err(`${W}.bones: unknown bone "${name}"`); continue; }
      if (!b || !isVec(b.box, 6) || !b.box.every(isInt) || b.box[0] > b.box[3] || b.box[1] > b.box[4] || b.box[2] > b.box[5]) { err(`${W}.bones.${name}: box must be [x0,y0,z0,x1,y1,z1] ints`); continue; }
      if (!isVec(b.joint, 3)) err(`${W}.bones.${name}: joint must be [x,y,z]`);
      boxes.push({ index: bones.get(name).index, name, box: b.box });
    }
    boxes.sort((a, b) => a.index - b.index);
    const boneAt = (x, y, z) => boxes.find(({ box: q }) => x >= q[0] && x <= q[3] && y >= q[1] && y <= q[4] && z >= q[2] && z <= q[5]);
    // every base voxel must sit inside some bone box; remember which bones each z row crosses
    const rowBones = new Map(); // z -> Set(bone name)
    let outside = 0;
    let firstOut = '';
    if (Array.isArray(base.layers) && base.layers.length === sz) {
      for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
        const row = base.layers[z] && base.layers[z][y];
        if (typeof row !== 'string') continue;
        for (let x = 0; x < sx && x < row.length; x++) {
          if (isEmptyChar(row[x])) continue;
          const hit = boneAt(x, y, z);
          if (!hit) { if (!outside++) firstOut = `(${x},${y},${z})`; continue; }
          if (!rowBones.has(z)) rowBones.set(z, new Set());
          rowBones.get(z).add(hit.name);
        }
      }
    }
    if (outside) err(`${W}: ${outside} voxel(s) outside every bone box, first at ${firstOut}`);
    for (const [name, a] of Object.entries(base.anchors || {})) if (!isVec(a, 3)) err(`${W}.anchors.${name}: must be [x,y,z]`);
    // a stretch row may only contain voxels of the waist/shin bones
    for (const z of base.stretchRows || []) {
      if (!isInt(z) || z < 0 || z >= sz) { err(`${W}.stretchRows: ${z} is not a row 0..${sz - 1}`); continue; }
      for (const n of rowBones.get(z) || []) if (!STRETCH_BONES.includes(n)) err(`${W}.stretchRows: row ${z} runs through forbidden bone "${n}"`);
    }
  }

  // shells + attachments
  const checkSlot = (where, slot) => { if (!SLOTS.includes(slot)) err(`${where}: unknown slot "${slot}"`); };
  const seen = new Set();
  const dupe = (kind, id, slot) => { const k = `${kind}:${slot}:${id}`; if (seen.has(k)) err(`${kind}s: duplicate id "${id}" in slot ${slot}`); seen.add(k); };
  for (const [i, s] of (kit.shells || []).entries()) {
    const W = `shells[${i}]`;
    checkSlot(W, s.slot); dupe('shell', s.id, s.slot);
    if (!SHELL_ORDER.includes(s.slot)) err(`${W}: slot "${s.slot}" is not a shell slot`);
    if (![0, 1, 2].includes(s.thick)) err(`${W}: thick must be 0, 1 or 2`);
    if (!usedChars.has(s.paint)) err(`${W}: paint char "${s.paint}" has no slot`);
    if (!Array.isArray(s.regions) || !s.regions.length) err(`${W}: regions missing`);
    for (const r of s.regions || []) {
      if (!bones.has(r.bone)) err(`${W}: unknown bone "${r.bone}"`);
      if (!(r.t0 >= 0 && r.t1 <= 1 && r.t0 < r.t1)) err(`${W}: region needs 0 <= t0 < t1 <= 1`);
    }
  }
  for (const [i, a] of (kit.attachments || []).entries()) {
    const W = `attachments[${i}]`;
    checkSlot(W, a.slot); dupe('attachment', a.id, a.slot);
    if (!ATTACH_ORDER.includes(a.slot)) err(`${W}: slot "${a.slot}" is not an attachment slot`);
    if (!bones.has(a.bone)) err(`${W}: unknown bone "${a.bone}"`);
    if (!isVec(a.offset, 3)) err(`${W}: offset must be [x,y,z]`);
    if (!isVec(a.box, 3) || !a.box.every((n) => isInt(n) && n > 0)) { err(`${W}: box must be 3 positive ints`); continue; }
    const chars = checkLayers(a.layers, a.box, W, err);
    for (const c of chars) if (!usedChars.has(c)) err(`${W}: layer char "${c}" has no slot`);
    for (const [bid, base] of Object.entries(bases)) if (!base.anchors || !base.anchors[a.anchor]) err(`${W}: base "${bid}" has no anchor "${a.anchor}"`);
    for (const h of a.hides || []) checkSlot(`${W}.hides`, h);
  }
  return { errors, warnings };
}
