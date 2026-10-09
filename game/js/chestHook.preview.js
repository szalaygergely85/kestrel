// S8-B1-04 owner-look preview: drives createChestHook directly (no full World/engine needed - the hook's own
// ctx is a plain object, same shape chestHook.test.js fakes) with one fixture chest, so the owner can see the
// real wired flow (E near the chest -> open clip -> item granted -> item-get card) rather than just the sim or
// the card in isolation (those already have their own previews/tests).
import { createRenderer, createUiLayer } from '../../engine/index.js';
import { createChestHook } from './chestHook.js';
import { ensureInventory, countOf } from './quest/sim/inventory.js';
import { CHEST_DEFAULTS as C } from './quest/sim/lootConfig.js';

const A = globalThis.ASSETS, backend = new URLSearchParams(location.search).get('backend') || 'webgpu';
const rgb = Object.fromEntries(Object.entries(A.palette.colors).map(([k, h]) => [k, [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))]));
const { rt, info } = await createRenderer({ canvas: document.querySelector('#screen'), backend, cols: 400, rows: 150, cpuGrid: { cols: 400, rows: 150 }, gpu: false });
const ui = createUiLayer({ cols: 160 }); ui.bindScene(rt.cols, rt.rows); rt.setUiLayer(ui);

const def = {
  id: 'fixtureChest', x: 0, y: 0, z: 0, frontX: 0, frontY: -1,
  interact: { radius: C.radius, facingDeg: C.facingDeg, facingCos: C.facingCos },
  table: { fixed: [{ item: 'brass.scrap', n: 2 }], weighted: [] }, propId: 'chestEntity1',
};
const chestEntity = { anim: 'closed', play(clip) { this.anim = clip; } };
const world = { get(id) { return id === 'chestEntity1' ? chestEntity : null; } };
const playerData = { transform: { x: 0, y: -1, z: 0 }, components: {} };
const inv = ensureInventory(playerData, { pack: [], left: null, right: null });
const state = { interactPressed: false, interactRaw: false, playerYawDeg: 0, wakeDone: true, canSave: true, ending: false };
const hook = createChestHook({ defs: [def], items: A.items, style: A.uiStyle.itemGetCard, rgb, openedChestsOf: () => [] });
hook.onBoot({ world, player: playerData, events: { emit() {} }, inventory: inv, state });

let edge = false, previous = null;
document.querySelector('#face').addEventListener('click', () => { state.playerYawDeg = 180; edge = true; });
document.querySelector('#away').addEventListener('click', () => { state.playerYawDeg = 0; edge = true; });
window.addEventListener('resize', () => rt.resize());
window.__chestHookPreview = { rt, info, ui, hook, world, chestEntity, inv, get count() { return countOf(inv, 'brass.scrap'); } };

function frame(now) {
  const dt = previous === null ? 0 : Math.max(0, Math.min(0.1, (now - previous) / 1000)); previous = now;
  state.interactPressed = edge; state.interactRaw = edge; edge = false;
  hook.stepUi(dt, state.interactRaw); if (!hook.card.isOpen) hook.onTick(dt); // main.js shape: card steps always, sim only while unpaused
  rt.clear(); ui.clear(); hook.drawHud(ui); rt.present();
  document.querySelector('#status').textContent = `${backend}; chest=${window.__chestHookPreview.world.get('chestEntity1').anim}; card=${hook.card.isOpen}; count=${window.__chestHookPreview.count}; preview only`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
