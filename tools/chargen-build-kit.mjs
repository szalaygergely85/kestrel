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

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../content/chargen/human.charkit.json');
const A = globalThis.ASSETS, CK = A.chargenKit;
const kit = CK.buildHumanKit(A.palette);
const res = CK.checkKit(kit, A.palette, A.detailPass);
if (res.errors.length) {
  console.error('kit errors:\n  ' + res.errors.join('\n  '));
  process.exit(1);
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
}
