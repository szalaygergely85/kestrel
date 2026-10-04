// OWN-REQ-014: pure sizing, definition hashes and the one-icon-per-frame queue.
export const ICON_VERSION = 1;

/** Numeric billboard containers use the same #0 entry as a prop's variant:0. */
export function iconModel(model) {
  return !model.voxel && !model.world && model.variants?.[0]?.billboard ? model.variants[0] : model;
}

export function modelBounds(model) {
  model = iconModel(model);
  const v = model.voxel;
  if (v) {
    const m = v.cellM * (model.scale || 1);
    return { w: v.size[0] * m, d: v.size[1] * m, h: v.size[2] * m };
  }
  const s = model.world;
  if (s && s.w > 0 && s.h > 0) return { w: s.w, d: s.w, h: s.h };
  throw new Error('icon bounds: model has neither voxel nor sprite world dimensions');
}

/** Horizontal FOV, physical canvas aspect. Sphere fits both axes with 10% margin. */
export function fitIconCamera(bounds, fovDeg, aspect) {
  const halfX = fovDeg * Math.PI / 360;
  const halfY = Math.atan(Math.tan(halfX) / aspect);
  const radius = Math.hypot(bounds.w, bounds.d, bounds.h) / 2;
  const distance = Math.max(0.1 + radius, radius / Math.sin(Math.atan(Math.tan(Math.min(halfX, halfY)) * 0.8)));
  const yaw = Math.PI / 4, pitch = -Math.PI / 6;
  return { x: -Math.sin(yaw) * Math.cos(pitch) * distance,
    y: Math.cos(yaw) * Math.cos(pitch) * distance,
    z: bounds.h / 2 - Math.sin(pitch) * distance, yawDeg: 45, pitchDeg: -30 };
}

export function iconCacheKey(key, model) {
  const json = JSON.stringify(model);
  let hash = 2166136261;
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 16777619);
  return `${key}|${(hash >>> 0).toString(16)}|${ICON_VERSION}`;
}

export function createIconQueue(perFrame = 1) {
  const pending = [];
  const keys = new Set();
  let used = 0;
  return {
    get size() { return pending.length; },
    enqueue(key, priority = false) {
      if (keys.has(key)) {
        if (priority) { pending.splice(pending.indexOf(key), 1); pending.unshift(key); }
        return;
      }
      keys.add(key);
      if (priority) pending.unshift(key); else pending.push(key);
    },
    tick() { used = 0; },
    next() {
      if (used >= perFrame || !pending.length) return null;
      used++;
      const key = pending.shift(); keys.delete(key); return key;
    },
    remove(key) { if (keys.delete(key)) pending.splice(pending.indexOf(key), 1); },
  };
}

export function createIconCache(storage = null) {
  const memory = new Map(), current = new Map();
  const prefix = 'kestrel.icon.v1.';
  return {
    key(key, model) {
      const hash = iconCacheKey(key, model), old = current.get(key);
      if (old && old !== hash) {
        memory.delete(old);
        try { storage?.removeItem(prefix + old); } catch (_) { /* optional persistence */ }
      }
      current.set(key, hash);
      return hash;
    },
    get(hash) {
      if (memory.has(hash)) return memory.get(hash);
      let value = null;
      try { value = storage?.getItem(prefix + hash); } catch (_) { /* optional persistence */ }
      if (value && value.startsWith('data:image/png')) { memory.set(hash, value); return value; }
      return null;
    },
    set(hash, value) {
      memory.set(hash, value);
      try { storage?.setItem(prefix + hash, value); } catch (_) { /* memory cache still works */ }
    },
  };
}
