// S8-C-05: pure binding data. The host owns input sampling and settings storage.
export const DEFAULT_BINDINGS = Object.freeze({
  keyboard: Object.freeze({
    forward: Object.freeze(['KeyW']), backward: Object.freeze(['KeyS']),
    left: Object.freeze(['KeyA']), right: Object.freeze(['KeyD']),
    run: Object.freeze(['ShiftLeft', 'ShiftRight']), jump: Object.freeze(['Space']),
    interact: Object.freeze(['KeyE']), useLeft: Object.freeze(['Mouse0']),
    useRight: Object.freeze(['Mouse2']), swapHands: Object.freeze(['KeyH']),
    lockTarget: Object.freeze(['KeyQ']), cycleTarget: Object.freeze(['Tab']),
    inventory: Object.freeze(['KeyI']), map: Object.freeze(['KeyM']), mute: Object.freeze(['KeyN']),
    questLog: Object.freeze(['KeyJ']), // QG-05
  }),
  // No gamepad layout is shipped by the current host. Empty lists are unbound;
  // Button0..31 / Axis0..15+ or - can be supplied independently by a future host.
  gamepad: Object.freeze(Object.fromEntries([
    'forward', 'backward', 'left', 'right', 'run', 'jump', 'interact', 'useLeft',
    'useRight', 'swapHands', 'lockTarget', 'cycleTarget', 'inventory', 'map', 'mute', 'questLog',
  ].map(action => [action, Object.freeze([])]))),
});

const DEVICES = ['keyboard', 'gamepad'];
const ACTIONS = Object.keys(DEFAULT_BINDINGS.keyboard);
const OK = Object.freeze({ ok: true, reason: null, conflict: null });

function validCode(device, code) {
  if (typeof code !== 'string') return false;
  if (device === 'gamepad') return /^(Button([0-9]|[12][0-9]|3[01])|Axis([0-9]|1[0-5])[+-])$/.test(code);
  return /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Mouse[02])$/.test(code);
}

function requireDevice(device) {
  if (!DEVICES.includes(device)) throw new Error('bindings: unknown device');
}

function requireAction(action) {
  if (!ACTIONS.includes(action)) throw new Error('bindings: unknown action');
}

/** Snapshot shape: {version:1, keyboard:{action:[code,...]}, gamepad:{action:[code,...]}}.
 * Missing saved actions use defaults. Conflicts refuse without mutating either
 * action; null unbinds an action. Queries return reused frozen code lists.
 */
export function createBindings(saved = null) {
  const tables = { keyboard: {}, gamepad: {} };
  if (saved !== null && (!saved || typeof saved !== 'object' || Array.isArray(saved)
    || saved.version !== 1 || Object.keys(saved).some(key => !['version', ...DEVICES].includes(key))))
    throw new Error('bindings: invalid snapshot/version');
  for (const device of DEVICES) {
    const source = saved?.[device];
    if (source !== undefined && (!source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).some(action => !ACTIONS.includes(action))))
      throw new Error('bindings: invalid device table');
    const used = new Set();
    for (const action of ACTIONS) {
      const codes = source && Object.hasOwn(source, action) ? source[action] : DEFAULT_BINDINGS[device][action];
      if (!Array.isArray(codes) || codes.some(code => !validCode(device, code) || used.has(code)))
        throw new Error('bindings: invalid/conflicting code');
      for (const code of codes) {
        if (used.has(code)) throw new Error('bindings: duplicate code');
        used.add(code);
      }
      tables[device][action] = Object.freeze([...codes]);
    }
  }
  return {
    get(device, action) {
      requireDevice(device); requireAction(action);
      return tables[device][action];
    },
    conflict(device, action, code) {
      requireDevice(device); requireAction(action);
      if (code !== null && !validCode(device, code)) throw new Error('bindings: invalid code');
      return code === null ? null : ACTIONS.find(other => other !== action && tables[device][other].includes(code)) || null;
    },
    rebind(device, action, code) {
      const conflict = this.conflict(device, action, code);
      if (conflict) return { ok: false, reason: 'conflict', conflict };
      tables[device][action] = Object.freeze(code === null ? [] : [code]);
      return OK;
    },
    reset(device = null) {
      if (device !== null) requireDevice(device);
      for (const name of device === null ? DEVICES : [device])
        for (const action of ACTIONS) tables[name][action] = DEFAULT_BINDINGS[name][action];
    },
    serialize() {
      const out = { version: 1, keyboard: {}, gamepad: {} };
      for (const device of DEVICES)
        for (const action of ACTIONS) out[device][action] = [...tables[device][action]];
      return out;
    },
  };
}
