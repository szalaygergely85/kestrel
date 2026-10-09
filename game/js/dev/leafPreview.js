// LEAF-PREVIEW-01: standalone alphaLeaves fixture, public engine API only.
import { AssetRegistry, createRenderer, createEngine, GBuffer, bindShading,
  renderWorld, makeLightBuffer, ambientL, MaskAtlas,
  buildMeshFromTris, SpritePool, buildSpriteAtlas } from '../../../engine/index.js';

async function start() {
  const params = new URLSearchParams(location.search);
  const assets = AssetRegistry.fromGlobals(globalThis.ASSETS);
  const canvas = document.querySelector('#screen');
  const built = await createRenderer({canvas, backend: params.get('backend') || 'webgpu',
    cols: 400, rows: 150, cpuGrid: {cols: 400, rows: 150}, rays: 1,
    terrainEnabled: false, shadows: {sun: 'off'}});
  const {rt, info} = built;
  function resize() {
    rt.resize(window.innerWidth, Math.max(150, window.innerHeight - document.querySelector('header').offsetHeight));
  }
  resize();
  const engine = createEngine({canvas, assets, renderTarget: rt, renderPipeline: built.pipeline,
    cols: 400, rows: 150, physics: {mode: 'mesh'}, shadows: {sun: 'off'}});
  const table = bindShading(assets.palette, assets.detailPass, rt.pxCellH / rt.pxCellW);
  const pipeline = built.pipeline;
  if (!pipeline?.ready) throw new Error('This preview requires a working GPU cell pipeline.');
  pipeline.bind(table, assets.palette);
  if (rt.backend === 'webgpu') {
    const spriteAtlas = buildSpriteAtlas(assets, assets.palette);
    pipeline.bindSprites({pool: new SpritePool(spriteAtlas, assets.palette), atlas: spriteAtlas,
      palette: assets.palette, particleLayer: engine.particleLayer, overlay: engine.overlay});
  }
  const atlas = new MaskAtlas();
  const chk = new Uint8Array(64);
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) chk[j * 8 + i] = (i + j) % 2 === 0 ? 255 : 0;
  atlas.add('test/checker8', 8, 8, chk);
  const tris = [];
  const quad = (cx, cy, cz, yawDeg, w, h, tiltDeg, mat) => { // w x h card centred on (cx, cy, cz), uv = unit square (v = 0 on top)
    const yw = yawDeg * Math.PI / 180, tl = tiltDeg * Math.PI / 180;
    const ax = Math.cos(yw) * w / 2, ay = Math.sin(yw) * w / 2;
    const ux = -Math.sin(yw) * Math.sin(tl) * h / 2, uy = Math.cos(yw) * Math.sin(tl) * h / 2, uz = Math.cos(tl) * h / 2;
    const P = { tl: [cx - ax + ux, cy - ay + uy, cz + uz], tr: [cx + ax + ux, cy + ay + uy, cz + uz], br: [cx + ax - ux, cy + ay - uy, cz - uz], bl: [cx - ax - ux, cy - ay - uy, cz - uz] };
    const UV = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
    const tri = (a, b, c) => {
      const e1 = [P[b][0] - P[a][0], P[b][1] - P[a][1], P[b][2] - P[a][2]], e2 = [P[c][0] - P[a][0], P[c][1] - P[a][1], P[c][2] - P[a][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]);
      return { p0: P[a], p1: P[b], p2: P[c], normal: [n[0] / l, n[1] / l, n[2] / l], matName: mat, uv0: UV[a], uv1: UV[b], uv2: UV[c] };
    };
    tris.push(tri('tl', 'bl', 'br'), tri('tl', 'br', 'tr'));
  };
  quad(0, 0, 1.5, 0, 0.3, 3, 0, 'post'); // opaque range first (37.17: opaque before masked)
  const nOpaque = tris.length;
  quad(0, 0.1, 2.2, 20, 2, 2, 0, 'leaf'); quad(1.2, 0.7, 2.7, 75, 2, 2, 0, 'leaf'); quad(-1.3, 0.4, 1.8, -40, 2, 2, 0, 'leaf'); quad(0.2, 0.1, 1.0, 10, 2, 2, 55, 'leaf');
  const nLeaf = tris.length - nOpaque;
  quad(0.3, -0.8, 3.0, 110, 2, 2, 0, 'leaf_dark');
  const mask = { tex: 'test/checker8', cutoff: 0.5 };
  const alphaMesh = buildMeshFromTris(tris, [{ part: 'post', triStart: 0, triCount: nOpaque }, { part: 'leaf', triStart: nOpaque, triCount: nLeaf, mask },
    { part: 'leaf_dark', triStart: nOpaque + nLeaf, triCount: tris.length - nOpaque - nLeaf, mask }], 'test/alphaCards');
  alphaMesh.mats = { post: 'timber_old', leaf: 'leaf', leaf_dark: 'leaf_dark' }; // EMIS-01b/kestrel-2#0: softtest clones removed, leaf/leaf_dark already edge:'soft' (ALPHA-01e)

  const worlds = [true, false].map(() => {
    // Separate identities avoid stale resolved-material caches when toggling.
    // EMIS-01b/kestrel-2#0: both branches now point at leaf/leaf_dark (softtest clones removed; leaf/leaf_dark are already edge:'soft', ALPHA-01e).
    const mesh = {...alphaMesh, mats: {post: 'timber_old', leaf: 'leaf', leaf_dark: 'leaf_dark'}};
    const world = engine.loadWorld({name: 'leaf-preview', structures: [], entities: [], state: {}}, {physics: 'mesh'});
    world.maskAtlas = atlas;
    world.placeMesh(mesh, {x: 0, y: 0, z: 0}, 'test.alphaCards');
    return world;
  });
  const cam = engine.camera;
  cam.x = 0; cam.y = 6; cam.z = 1.6; cam.yawDeg = 0; cam.pitchDeg = 8;
  let soft = true, far = false;
  const fb = {rt, depth: engine.depthBuffer, palette: assets.palette,
    gbuf: new GBuffer(rt.cols, rt.rows), matTable: table, detailPass: assets.detailPass,
    lights: null, light: makeLightBuffer(rt.cols, rt.rows), timeSec: 0, gpu: true,
    renderer: 'mesh', terrainEnabled: false, sceneFade: 1, frameNo: 0};
  document.querySelector('#soft').onclick = event => {
    soft = !soft;
    event.currentTarget.textContent = 'Soft edges: ' + (soft ? 'on' : 'off');
    event.currentTarget.setAttribute('aria-pressed', String(soft));
  };
  document.querySelector('#distance').onclick = event => {
    far = !far; cam.y = far ? 30 : 6; cam.pitchDeg = far ? 2 : 8;
    event.currentTarget.textContent = 'Distance: ' + (far ? '30' : '6') + ' m';
  };
  document.querySelector('#status').textContent = info.label + ' | 400 x 150 cells';
  window.__leafPreview = {rt, info, pipeline, worlds, cam,
    get soft() {return soft;}, get far() {return far;}};
  function frame() {
    const world = worlds[soft ? 0 : 1];
    engine.ui.clear();
    engine.overlay.clear();
    fb.frameNo++;
    renderWorld(fb, world, cam);
    pipeline.frame(fb, ambientL, cam, world);
    rt.present();
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
}
start().catch(error => {
  document.querySelector('#status').textContent = error.message;
  console.error(error);
});
