// node tools/chargen-build-kit.mjs - writes content/chargen/human.charkit.json (CHARGEN-01) from
// design/chargen/human_kit.js + design/palette.js. The JSON is the only source the core / app / game read;
// re-run this after any change to human_kit.js or the palette.chargen table. Deterministic (same bytes every run).
// `--check` only compares (exit 1 when the JSON on disk is stale).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../design/palette.js';
import '../design/detail-pass.js';
import '../design/chargen/human_kit.js';
import { composeCharacter, meshCharacter, validateRecipe, randomRecipe } from '../engine/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../content/chargen/human.charkit.json');
const A = globalThis.ASSETS, CK = A.chargenKit;
const kit = CK.buildHumanKit(A.palette);
const res = CK.checkKit(kit, A.palette, A.detailPass);
if (res.errors.length) {
  console.error('kit errors:\n  ' + res.errors.join('\n  '));
  process.exit(1);
}
// 38.34: per-level stats (quads per res combination) and a warning for attachment cells outside their region box (clipped at compose)
const levelStats = [];
if (kit.regions && kit.resLevels) {
  const isEmpty = (c) => c === '.' || c === ' ';
  for (const [rn, r] of Object.entries(kit.regions)) {
    for (const a of kit.attachments || []) {
      if (!r.bones.includes(a.bone)) continue;
      for (const [bid, b] of Object.entries(kit.bases)) {
        const anc = b.anchors[a.anchor];
        let out = 0;
        for (let z = 0; z < a.box[2]; z++) for (let y = 0; y < a.box[1]; y++) for (let x = 0; x < a.box[0]; x++) {
          if (isEmpty(a.layers[z][y][x])) continue;
          const gx = Math.round(anc[0] + a.offset[0] + x), gy = Math.round(anc[1] + a.offset[1] + y), gz = Math.round(anc[2] + a.offset[2] + z);
          if (gx < r.box[0] || gx > r.box[3] || gy < r.box[1] || gy > r.box[4] || gz < r.box[2] || gz > r.box[5]) out++;
        }
        if (out) res.warnings.push(`${bid}: attachment ${a.id} has ${out} cells outside region ${rn} box (clipped when ${rn} is finer than the body)`);
      }
    }
  }
  for (const bl of kit.resLevels.body || [1]) for (const hl of kit.resLevels.head || [1]) {
    if (hl < bl) continue;
    try {
      const rc = { ...randomRecipe(kit, 1), res: { body: bl, head: hl } };
      if (validateRecipe(kit, rc).errors.length) continue;
      levelStats.push(`body ${bl}/head ${hl}: ${meshCharacter(composeCharacter(kit, rc)).mesh.quads} quads`);
    } catch (e) { levelStats.push(`body ${bl}/head ${hl}: ${e.message}`); }
  }
}
const text = CK.stringifyKit(kit);
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== text) { console.error('STALE: ' + path.relative(process.cwd(), out) + ' differs from the generator'); process.exit(1); }
  console.log('OK: ' + path.relative(process.cwd(), out) + ' is current');
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  const st = res.stats.bases.m_avg;
  console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + text.length + ' bytes): m_avg ' + st.voxels + ' voxels, ' +
    st.quads + ' quads, ' + st.heightM + ' m; ' + res.stats.materialKeys + ' material keys; warnings: ' + (res.warnings.join('; ') || 'none'));
  if (levelStats.length) console.log('per level: ' + levelStats.join(' | '));
}
