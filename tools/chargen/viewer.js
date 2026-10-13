// tools/chargen/viewer.js (CHARGEN-13): three.js preview. Preview = the export (architecture.md 38.29 item 7):
// the bytes of core.exportGlb() are parsed with GLTFLoader, so the viewer shows exactly the shipped .glb.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** @param {HTMLElement} host  @returns viewer handle */
export function createViewer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20242b);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x4a4036, 1.1));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
  key.position.set(2.5, 4, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.5, bottom: -1.5, near: 0.5, far: 12 });
  key.shadow.bias = -0.0005;
  scene.add(key);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  camera.position.set(0, 1.1, 3.6);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.update();

  const loader = new GLTFLoader();
  const clock = new THREE.Clock();
  let root = null, mixer = null, action = null, clips = [], clipName = null, playing = true, turntable = true, framed = false;
  let onTime = null;

  function resize() {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  function playClip(name, t01 = 0) {
    clipName = name;
    if (action) action.stop();
    action = null;
    const clip = clips.find((c) => c.name === name);
    if (!mixer || !clip) return;
    action = mixer.clipAction(clip);
    action.play();
    action.time = t01 * clip.duration;
    action.paused = !playing;
    mixer.update(0);
  }

  const api = {
    canvas: renderer.domElement,
    get clipNames() { return clips.map((c) => c.name); },
    /** Parse glb bytes (Uint8Array) and swap the model in; keeps the chosen clip + time. Resolves with clip names. */
    load(bytes) {
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return new Promise((resolve, reject) => loader.parse(ab, '', (gltf) => {
        const keepT = action && action.getClip().duration ? (action.time % action.getClip().duration) / action.getClip().duration : 0;
        if (root) { scene.remove(root); root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } }); }
        root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.frustumCulled = false; // skinned bounds are bind-pose only
          const src = o.material, map = src.map;
          if (map) { map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false; map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true; }
          o.material = new THREE.MeshStandardMaterial({ map, vertexColors: !!o.geometry.attributes.color, roughness: 0.9, metalness: 0, side: THREE.FrontSide });
          src.dispose();
        });
        scene.add(root);
        if (!framed) { // frame once; later rebuilds keep the user's camera
          const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), h = box.max.y - box.min.y;
          controls.target.set(0, c.y, 0); camera.position.set(0, c.y + h * 0.15, h * 2.6); controls.update(); framed = true;
        }
        clips = gltf.animations || [];
        mixer = clips.length ? new THREE.AnimationMixer(root) : null;
        if (clips.length) playClip(clips.some((c) => c.name === clipName) ? clipName : clips[0].name, keepT);
        resolve(clips.map((c) => c.name));
      }, reject));
    },
    setClip(name) { playClip(name, 0); },
    setPlaying(p) { playing = p; if (action) action.paused = !p; },
    setScrub(t01) { if (action) { action.time = t01 * action.getClip().duration; action.paused = true; mixer.update(0); } },
    setTurntable(on) { turntable = on; },
    onTime(fn) { onTime = fn; },
  };

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (mixer && playing) mixer.update(dt);
    if (root && turntable) root.rotation.y += dt * 0.6;
    if (onTime && action && playing) onTime((action.time % action.getClip().duration) / action.getClip().duration);
    controls.update();
    renderer.render(scene, camera);
  });
  return api;
}
