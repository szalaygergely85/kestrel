// PERF-11: redundant-state elimination inside a pass. Replays one recorded multi-pass frame on a "naive" device (cache reset before every
// bind = every set call emitted) and on the real device; the effective encoder state at every draw must be identical.
import { GpuDeviceWebGPU } from './GpuDeviceWebGPU.js';
let fail = 0;
const ok = (n, c) => { if (!c) { fail++; console.log('FAIL ' + n); } else console.log('ok   ' + n); };
const consts = { buf: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8, MAP_READ: 16 }, tex: { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 2, COPY_SRC: 4, COPY_DST: 8 }, stage: { VERTEX: 1, FRAGMENT: 2 }, map: { READ: 1 } };

function run(naive) {
  const draws = []; let setCalls = 0, id = 0;
  const st = { pl: null, bg: [], bgDyn: [], vb: [], vbOff: [], ib: null };
  const mk = (n) => ({ n: n + ++id, createView: () => ({}), destroy() {} });
  const pass = {
    setPipeline(p) { setCalls++; st.pl = p; }, setBindGroup(i, g, dyn) { setCalls++; st.bg[i] = g; st.bgDyn[i] = dyn ? dyn[0] : -1; },
    setVertexBuffer(i, b, o = 0) { setCalls++; st.vb[i] = b; st.vbOff[i] = o; }, setIndexBuffer(b, f) { setCalls++; st.ib = b + f; },
    draw() { draws.push(JSON.stringify([st.pl, st.bg, st.bgDyn, st.vb, st.vbOff])); }, drawIndexed() { draws.push(JSON.stringify([st.pl, st.bg, st.bgDyn, st.vb, st.vbOff, st.ib])); }, end() { st.pl = null; st.bg = []; st.bgDyn = []; st.vb = []; st.vbOff = []; st.ib = null; },
  };
  const obj = (n) => mk(n);
  const gpu = {
    limits: { maxColorAttachments: 8 }, lost: new Promise(() => {}), queue: { writeBuffer() {}, submit() {} },
    createBuffer: () => mk('buf'), createTexture: () => mk('tex'), createSampler: () => mk('smp'), createShaderModule: () => mk('sm'),
    createBindGroupLayout: () => mk('bgl'), createPipelineLayout: () => mk('pll'), createBindGroup: () => mk('bg'), createRenderPipeline: () => mk('rp'),
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }),
  };
  // shorten the identity of mocks for the JSON snapshot: id strings
  const d = new GpuDeviceWebGPU(gpu, { consts, ringSlots: 8 });
  const lay = [{ name: 'aPos', location: 0, components: 3, type: 'float', offsetBytes: 0 }];
  const base = { vertex: { src: { wgsl: 'x' }, layout: lay, strideBytes: 16 }, fragment: { src: { wgsl: 'x' }, targets: 1 }, targetFormats: ['rgba8'], bindings: { uniformBytes: 16, textures: [] } };
  const pipes = [d.createPipeline(base), d.createPipeline(base), d.createPipeline({ ...base, vertex: { ...base.vertex, instanceLayout: lay, instanceStrideBytes: 8 } })];
  for (const p of pipes) { p.gpu = p.gpu && (p.gpu.n || p.gpu); }
  const bufs = [0, 1, 2, 3].map(() => d.createBuffer({ usage: 'vertex', bytes: 64 }));
  const ibs = [0, 1].map(() => d.createBuffer({ usage: 'index', bytes: 64, indexFormat: 'uint16' }));
  const tgt = d.createTarget({ color: [d.createTexture({ format: 'rgba8', width: 4, height: 4 })] });
  let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let ps = 0; ps < 3; ps++) {
    d.beginPass(tgt);
    for (let i = 0; i < 100; i++) {
      if (naive) d._resetPassState();
      const p = pipes[rnd(3)], vb = bufs[rnd(2)];
      const desc = { vertexBuffer: vb, uniformOffsetBytes: 256 * rnd(2) };
      if (p === pipes[2]) { desc.instanceBuffer = bufs[2 + rnd(2)]; desc.instanceOffset = rnd(2) * 32; }
      if (rnd(2)) desc.indexBuffer = ibs[rnd(2)];
      d.bind(p, desc);
      d.draw(3);
    }
    d.endPass();
  }
  return { draws, setCalls, skipped: d.skippedCalls };
}
const a = run(true), b = run(false);
ok('draw count equal', a.draws.length === b.draws.length && a.draws.length === 300);
let same = true; for (let i = 0; i < a.draws.length; i++) if (a.draws[i] !== b.draws[i]) { same = false; console.log('diff at', i, a.draws[i], b.draws[i]); break; }
ok('effective state identical at every draw', same);
ok('calls removed', b.setCalls < a.setCalls);
console.log(`set* calls: naive ${a.setCalls} -> cached ${b.setCalls} (removed ${a.setCalls - b.setCalls}, counter ${b.skipped})`);
process.exit(fail ? 1 : 0);
