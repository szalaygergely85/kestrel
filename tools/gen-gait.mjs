// node tools/gen-gait.mjs [--dry] - ANIM-A-01 (D-101 option A): (re)generates the option A gait clips (stance / swing split, planted feet,
// lift + plant, body bob / pitch / roll / yaw, head counter-nod) from tools/gait-configs.mjs and writes them into the model files in design/models/.
// Each clip sits between "// GAIT-A BEGIN <clip>" / "// GAIT-A END <clip>" marker lines, so a re-run replaces it. The first run replaces the old clip
// (balanced-bracket match from `<clip>:`), or inserts a new one before the clip named by cfg.before (rabbit `walk`, before the slow-hop comment).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIGS, defOf } from './gait-configs.mjs';
import { genGait, plantedError } from './gait-lib.mjs';

const dry = process.argv.includes('--dry');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'design', 'models');

function matchEnd(s, i) {              // index after the bracket that opens at s[i] (skips // comments + strings)
  const open = s[i], close = { '(': ')', '[': ']', '{': '}' }[open]; let d = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '/' && s[k + 1] === '/') { while (k < s.length && s[k] !== '\n') k++; continue; }
    if (c === "'" || c === '"') { const q = c; k++; while (s[k] !== q) k++; continue; }
    if (c === open) d++; else if (c === close && --d === 0) return k + 1;
  }
  throw new Error('unbalanced');
}
function clipText(cfg, clip, info, ind) {
  const G = info.G, fm = (o) => JSON.stringify(o).replace(/"/g, '');
  const lines = clip.frames.map((f) => ind + '    { ' + Object.keys(f).map((n) => n + ': { rot: ' + JSON.stringify(f[n].rot) + ', pos: ' + JSON.stringify(f[n].pos) + ' }').join(', ') + ' }');
  const mk = cfg.mark || cfg.clip;     // marker key: cfg.mark when several models share a file (fox.walk vs rabbit walk)
  if (cfg.var) return [`${ind}// GAIT-A BEGIN ${cfg.mark} (tools/gen-gait.mjs: legs of ${cfg.gait} gait, duty ${G.beta}, tuned ${G.v} m/s, ${clip.frames.length} keys; re-run, do not hand-edit)`,
    `${ind}var ${cfg.var} = { durations: ${JSON.stringify(clip.durations)}, frames: [`, lines.join(',\n'), `${ind}] };`, `${ind}// GAIT-A END ${cfg.mark}`, ''].join('\n');
  return `${ind}// GAIT-A BEGIN ${mk} (tools/gen-gait.mjs: option A, ${cfg.gait} gait, duty ${G.beta}, tuned ${G.v} m/s, ${clip.frames.length} keys x ${clip.durations[0]} ms; re-run, do not hand-edit)\n` +
    `${ind}${cfg.clip}: { durations: ${JSON.stringify(clip.durations)}, loop: true, frames: [\n${lines.join(',\n')}\n${ind}] },\n${ind}// GAIT-A END ${mk}\n`;
}
const edits = new Map();
for (const cfg of CONFIGS) {
  const def = defOf(cfg), { clip, info } = genGait(def, cfg), err = plantedError(def, cfg, clip, 4) * 1000;
  const file = path.join(root, cfg.file);
  let s = edits.get(file) || fs.readFileSync(file, 'utf8');
  const mk = cfg.mark || cfg.clip;
  const bm = s.indexOf(`// GAIT-A BEGIN ${mk} `);
  const em = '// GAIT-A END ' + mk + '\n';
  if (bm >= 0) {
    const ls = s.lastIndexOf('\n', bm) + 1, ind = s.slice(ls, bm), ee = s.indexOf(em, bm) + em.length;
    s = s.slice(0, ls) + clipText(cfg, clip, info, ind) + s.slice(ee);
  } else if (cfg.isNew) {
    const at = s.indexOf('      // slow hop, 8 x 50 ms'), ind = '      ';
    if (at < 0) throw new Error('rabbit insert anchor missing');
    s = s.slice(0, at) + clipText(cfg, clip, info, ind) + s.slice(at);
  } else {
    const re = new RegExp('\\n( +)' + cfg.clip + ':\\s*', 'g');       // cfg.from = anchor text before this model's clips (shared files)
    if (cfg.from) { re.lastIndex = s.indexOf(cfg.from); if (re.lastIndex < 0) throw new Error(cfg.id + ': anchor missing'); }
    const m = re.exec(s);
    if (!m) throw new Error(cfg.id + ': clip not found');
    const ind = m[1], start = m.index + 1, open = start + m[0].length - 1 + 1 - 1;
    let k = m.index + m[0].length;                       // at `clip(` or `{`
    if (s.startsWith('clip(', k)) k += 4;
    const end = matchEnd(s, k);
    let tail = end; if (s[tail] === ',') tail++;
    const lineEnd = s.indexOf('\n', tail) + 1;
    s = s.slice(0, start) + clipText(cfg, clip, info, ind) + s.slice(lineEnd);
  }
  edits.set(file, s);
  console.log(`${cfg.id}: ${clip.frames.length} keys, max leg swing ${info.maxRot.toFixed(1)} deg, planted error ${err.toFixed(2)} mm`);
}
if (!dry) for (const [f, s] of edits) fs.writeFileSync(f, s);
console.log(dry ? 'dry run, nothing written' : 'wrote ' + [...edits.keys()].map((f) => path.basename(f)).join(', '));
