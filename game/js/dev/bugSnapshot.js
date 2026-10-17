// REPORT-KEY-01: F8 bug snapshot = one report line the owner pastes; tools replay it (SNAP="<line>").
// Pure format/parse (no DOM). Line: KESTREL <build> pos x,y,z yaw pitch | clock HH:MM | quality <q> renderer <r> gpu "<name>" | size WxH grid CxR | flags <query>

const f = (v, d) => Number(v).toFixed(d);

export function clockText(hour) {
  const h = ((Number(hour) % 24) + 24) % 24; let m = Math.round((h - Math.floor(h)) * 60), hh = Math.floor(h);
  if (m === 60) { m = 0; hh = (hh + 1) % 24; }
  return String(hh).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** s: {build,x,y,z,yaw,pitch,hour,quality,renderer,gpu,w,h,cols,rows,flags} -> one line. */
export function formatSnapshot(s) {
  const flags = String(s.flags || '').replace(/^\?/, '').replace(/[\r\n]+/g, ' ');
  return `KESTREL ${String(s.build || 'unknown').replace(/\s+/g, '_')} pos ${f(s.x, 2)},${f(s.y, 2)},${f(s.z, 2)} ${f(s.yaw, 0)} ${f(s.pitch, 0)}` +
    ` | clock ${clockText(s.hour)} | quality ${s.quality || 'none'} renderer ${s.renderer || 'unknown'} gpu "${String(s.gpu || 'unknown').replace(/"/g, "'")}"` +
    ` | size ${s.w}x${s.h} grid ${s.cols}x${s.rows} | flags ${flags}`;
}

const RE = /^KESTREL (\S+) pos (-?[\d.]+),(-?[\d.]+),(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) \| clock (\d{1,2}):(\d{2}) \| quality (\S+) renderer (\S+) gpu "([^"]*)" \| size (\d+)x(\d+) grid (\d+)x(\d+) \| flags ?(.*)$/;

/** line -> same fields as formatSnapshot (hour = decimal hours), or null when it is not a snapshot line. */
export function parseSnapshot(line) {
  const m = RE.exec(String(line || '').trim().replace(/^["']|["']$/g, ''));
  if (!m) return null;
  return { build: m[1], x: +m[2], y: +m[3], z: +m[4], yaw: +m[5], pitch: +m[6], hour: +m[7] + +m[8] / 60, clockText: `${m[7].padStart(2, '0')}:${m[8]}`,
    quality: m[9], renderer: m[10], gpu: m[11], w: +m[12], h: +m[13], cols: +m[14], rows: +m[15], flags: m[16] };
}

/** Flags minus the keys a replay sets itself (time/quality/save/at/...), as an "a=b&c" string for the tools' EXTRA. */
export function replayExtra(s, drop = ['time', 'quality', 'save', 'at', 'dev', 'title', 'nopause', 'backend']) {
  return String(s.flags || '').split('&').filter((p) => p && !drop.includes(p.split('=')[0])).join('&');
}

/** Env overrides for tools: SNAP="<line>" -> {SPOT,CLOCKS,HOURS,QUALITY,W,H,EXTRA,x,y,z,yaw,pitch}; null if SNAP is empty/invalid. */
export function snapEnv(text) {
  if (!text) return null;
  const s = parseSnapshot(text);
  if (!s) throw new Error('SNAP is not a KESTREL snapshot line');
  const hour = String(+s.hour.toFixed(2));
  return { s, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, hour, SPOT: `${s.x},${s.y},${s.z},${s.yaw}`, CLOCKS: hour, HOURS: hour,
    QUALITY: s.quality === 'none' ? '' : s.quality, W: String(s.w), H: String(s.h), EXTRA: replayExtra(s) };
}

/** Browser side: build the line from live values, copy it, log it. ctx = {build,x,y,z,yaw,pitch,hour,quality,renderer,w,h,cols,rows,flags}; returns the line (gpu name looked up async). */
export async function takeSnapshot(ctx, nav = globalThis.navigator, log = console.log) {
  let gpu = 'unknown';
  try { const a = nav && nav.gpu && await nav.gpu.requestAdapter(); const i = a && (a.info || (a.requestAdapterInfo && await a.requestAdapterInfo())); if (i) gpu = [i.vendor, i.architecture, i.description || i.device].filter(Boolean).join(' ') || 'unknown'; } catch { /* no adapter info */ }
  const line = formatSnapshot({ ...ctx, gpu });
  try { await nav.clipboard.writeText(line); } catch { /* clipboard blocked: console + toast still work */ }
  log(line);
  return line;
}
