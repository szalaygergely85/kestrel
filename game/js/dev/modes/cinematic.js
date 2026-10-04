// US-119a: path evaluation and fixed-tick cinematic playback. No wall-clock time enters capture.
export function validatePath(path) {
  if (path?.version !== 1 || typeof path.id !== 'string' || !/^[\w-]+$/.test(path.id)) throw new Error('invalid cinematic version/id');
  if (!Number.isInteger(path.fps) || path.fps < 1 || 60 % path.fps !== 0) throw new Error('cinematic fps must divide 60');
  if (!Array.isArray(path.keys) || path.keys.length < 2) throw new Error('cinematic needs at least two keys');
  let previous = -1;
  const hasHours = path.keys[0].hour !== undefined;
  for (const k of path.keys) {
    for (const field of ['t', 'x', 'y', 'z', 'yawDeg', 'pitchDeg']) {
      if (!Number.isFinite(k[field])) throw new Error(`invalid cinematic ${field}`);
    }
    if ((k.hour !== undefined) !== hasHours || (hasHours && !Number.isFinite(k.hour))) throw new Error('cinematic hour must be finite on all keys or absent on all keys');
    if (k.t <= previous || !['linear', 'smooth'].includes(k.ease)) throw new Error('cinematic keys need increasing times and linear/smooth ease');
    previous = k.t;
  }
  if (path.keys[0].t !== 0) throw new Error('cinematic first key must be at t=0');
  if (path.timeOfDay !== undefined) throw new Error('use per-key hour (US-122a)');
  return path;
}

function spline(a, b, c, d, u) {
  return 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
}

export function evaluatePath(path, time, out) {
  const keys = path.keys;
  let i = 0;
  while (i < keys.length - 2 && time > keys[i + 1].t) i++;
  const b = keys[i], c = keys[i + 1];
  let u = Math.max(0, Math.min(1, (time - b.t) / (c.t - b.t)));
  if (b.ease === 'smooth') u = u * u * (3 - 2 * u);
  const a = keys[Math.max(0, i - 1)], d = keys[Math.min(keys.length - 1, i + 2)];
  out.x = spline(a.x, b.x, c.x, d.x, u);
  out.y = spline(a.y, b.y, c.y, d.y, u);
  out.z = spline(a.z, b.z, c.z, d.z, u);
  const yawDelta = ((c.yawDeg - b.yawDeg) % 360 + 540) % 360 - 180;
  out.yawDeg = ((b.yawDeg + yawDelta * u) % 360 + 360) % 360;
  out.pitchDeg = Math.max(-60, Math.min(60, b.pitchDeg + (c.pitchDeg - b.pitchDeg) * u));
  if (b.hour !== undefined) out.hour = b.hour + (c.hour - b.hour) * u;
  return out;
}

export async function loadCinematic(id) {
  if (!/^[\w-]+$/.test(id || '')) throw new Error('invalid cinematic id');
  const response = await fetch(`../design/cinematics/${id}.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`cinematic ${id}: HTTP ${response.status}`);
  const path = validatePath(await response.json());
  if (path.id !== id) throw new Error('cinematic id does not match filename');
  return path;
}

export function createPlayback(path, update, render) {
  validatePath(path);
  const ticksPerFrame = 60 / path.fps;
  const frames = Math.ceil(path.keys[path.keys.length - 1].t * path.fps) + 1;
  let next = 0;
  return {
    frames, fps: path.fps,
    async step(i) {
      if (!Number.isInteger(i) || i !== next || i >= frames) throw new Error(`cinematic expects frame ${next}`);
      if (i > 0) for (let tick = 0; tick < ticksPerFrame; tick++) update(1 / 60);
      render(0);
      next++;
    },
  };
}
