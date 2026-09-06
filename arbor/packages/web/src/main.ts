/**
 * Arbor web viewer: three.js scene + Tweakpane controls around the @arbor/core generator,
 * which runs in a Web Worker (see worker.ts). State is mirrored into the URL hash.
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Pane } from 'tweakpane';
import { SPECIES, SPECIES_IDS, type CrownShape, type IndividualParams, type PlantModel, type SpeciesParams } from '@arbor/core';
import type { GenerateRequest, GenerateResponse } from './worker.js';

declare global {
  interface Window { __arborReady?: boolean; __arborStats?: PlantModel['stats'] & { stage: string } }
}

// ---------------------------------------------------------------------------
// UI state (flat so Tweakpane can bind to it directly)
// ---------------------------------------------------------------------------
const CROWN_SHAPES: CrownShape[] = ['ellipsoid', 'sphere', 'cone', 'column', 'spreading', 'vase'];

interface OverrideState {
  crownShape: CrownShape; crownHeight: number; crownWidth: number; crownBaseHeight: number;
  apicalControl: number; gravitropism: number; phototropism: number; branchingAngle: number; lateralBudProbability: number;
}
interface State extends OverrideState {
  species: string; seed: number; ageYears: number; dayOfYear: number; latitude: number; health: number;
  /** Environment demo: a wall parallel to Z at x = wallDistance (0 = no wall). */
  wallDistance: number; wallHeight: number;
}

function speciesDefaults(sp: SpeciesParams): OverrideState {
  return {
    crownShape: sp.crown.shape, crownHeight: sp.crown.height, crownWidth: sp.crown.width, crownBaseHeight: sp.crown.baseHeight,
    apicalControl: sp.apicalControl, gravitropism: sp.gravitropism, phototropism: sp.phototropism,
    branchingAngle: sp.branchingAngle, lateralBudProbability: sp.lateralBudProbability,
  };
}

// Hash keys <-> override fields (crown.* map into the nested crown override).
const OVERRIDE_KEYS: Record<keyof OverrideState, string> = {
  crownShape: 'crown.shape', crownHeight: 'crown.height', crownWidth: 'crown.width', crownBaseHeight: 'crown.baseHeight',
  apicalControl: 'apicalControl', gravitropism: 'gravitropism', phototropism: 'phototropism',
  branchingAngle: 'branchingAngle', lateralBudProbability: 'lateralBudProbability',
};

const state: State = { species: SPECIES_IDS[0], seed: 1, ageYears: 25, dayOfYear: 190, latitude: 48, health: 1, wallDistance: 0, wallHeight: 6, ...speciesDefaults(SPECIES[SPECIES_IDS[0]]) };

function obstaclesFromState(): IndividualParams['obstacles'] {
  if (!(state.wallDistance > 0)) return undefined;
  const d = state.wallDistance;
  return [{ kind: 'box', min: [d, 0, -12], max: [d + 0.4, state.wallHeight, 12] }];
}

function readHash(): void {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const num = (k: string, cur: number) => { const v = Number(p.get(k)); return p.has(k) && Number.isFinite(v) ? v : cur; };
  if (p.has('species') && SPECIES[p.get('species')!]) state.species = p.get('species')!;
  Object.assign(state, speciesDefaults(SPECIES[state.species]));
  state.seed = Math.round(num('seed', state.seed));
  state.ageYears = num('age', state.ageYears);
  state.dayOfYear = num('day', state.dayOfYear);
  state.latitude = num('lat', state.latitude);
  state.health = num('health', state.health);
  state.wallDistance = num('wall', state.wallDistance);
  state.wallHeight = num('wallH', state.wallHeight);
  for (const [field, key] of Object.entries(OVERRIDE_KEYS) as [keyof OverrideState, string][]) {
    if (!p.has(key)) continue;
    if (field === 'crownShape') { if (CROWN_SHAPES.includes(p.get(key) as CrownShape)) state.crownShape = p.get(key) as CrownShape; }
    else state[field] = num(key, state[field]);
  }
}

function writeHash(): void {
  const p = new URLSearchParams();
  p.set('species', state.species); p.set('seed', String(state.seed)); p.set('age', String(state.ageYears)); p.set('day', String(state.dayOfYear));
  p.set('lat', String(state.latitude)); p.set('health', String(state.health));
  if (state.wallDistance > 0) { p.set('wall', String(state.wallDistance)); p.set('wallH', String(state.wallHeight)); }
  const def = speciesDefaults(SPECIES[state.species]);
  for (const [field, key] of Object.entries(OVERRIDE_KEYS) as [keyof OverrideState, string][]) {
    if (state[field] !== def[field]) p.set(key, String(state[field]));
  }
  history.replaceState(null, '', '#' + p.toString());
}

/** Build IndividualParams from state; overrides only include fields that differ from the species. */
function individualFromState(): IndividualParams {
  const sp = SPECIES[state.species];
  const def = speciesDefaults(sp);
  const ov: NonNullable<IndividualParams['overrides']> = {};
  const crown: Partial<SpeciesParams['crown']> = {};
  if (state.crownShape !== def.crownShape) crown.shape = state.crownShape;
  if (state.crownHeight !== def.crownHeight) crown.height = state.crownHeight;
  if (state.crownWidth !== def.crownWidth) crown.width = state.crownWidth;
  if (state.crownBaseHeight !== def.crownBaseHeight) crown.baseHeight = state.crownBaseHeight;
  // core's applyOverrides merges crown one level deep; the intersection type is stricter than the runtime contract
  if (Object.keys(crown).length) ov.crown = crown as SpeciesParams['crown'];
  for (const k of ['apicalControl', 'gravitropism', 'phototropism', 'branchingAngle', 'lateralBudProbability'] as const) {
    if (state[k] !== def[k]) ov[k] = state[k];
  }
  const obstacles = obstaclesFromState();
  return { seed: state.seed, ageYears: state.ageYears, dayOfYear: state.dayOfYear, latitude: state.latitude, health: state.health, ...(Object.keys(ov).length ? { overrides: ov } : {}), ...(obstacles ? { obstacles } : {}) };
}

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
type AnyRenderer = WebGPURenderer | THREE.WebGLRenderer;

async function createRenderer(): Promise<AnyRenderer> {
  try {
    const r = new WebGPURenderer({ antialias: true });
    await r.init();
    return r;
  } catch (e) {
    // TODO: remove once WebGPURenderer's WebGL2 backend is reliable everywhere.
    console.warn('WebGPURenderer init failed, falling back to WebGLRenderer', e);
    return new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  }
}

const statusEl = document.getElementById('status')!;
const appEl = document.getElementById('app')!;
const renderer = await createRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
appEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e6);
scene.fog = new THREE.Fog(0x9fc3e6, 80, 260);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;

scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x5a6b3a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dc, 3.0);
sun.position.set(18, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(150, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x5f7a45, roughness: 1 }),
);
ground.receiveShadow = true;
scene.add(ground);

const treeGroup = new THREE.Group();
scene.add(treeGroup);
const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xb8b0a4, roughness: 0.95 }));
wallMesh.castShadow = wallMesh.receiveShadow = true;
wallMesh.visible = false;
scene.add(wallMesh);
function updateWall(): void {
  const obs = obstaclesFromState();
  if (!obs || obs[0].kind !== 'box') { wallMesh.visible = false; return; }
  const b = obs[0];
  wallMesh.visible = true;
  wallMesh.scale.set(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  wallMesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
}
let branchMesh: THREE.Mesh | null = null;
let leafMesh: THREE.InstancedMesh | null = null;
let currentModel: PlantModel | null = null;

/** Leaf card in the XZ plane: petiole at the origin, tip at +Z*length, blade normal +Y. */
function leafGeometry(sp: SpeciesParams): THREE.BufferGeometry {
  const L = sp.leaf.length, W = sp.leaf.width;
  if (sp.leaf.shape === 'needle') return needleBrushGeometry(L, Math.max(W, 0.003), sp.internodeLength * 0.6);
  // outline as [x, z] pairs, counter-clockwise when viewed from +Y
  const pts: [number, number][] = [[0, 0], [-0.30 * W, 0.18 * L], [-0.50 * W, 0.42 * L], [-0.38 * W, 0.72 * L], [0, L], [0.38 * W, 0.72 * L], [0.50 * W, 0.42 * L], [0.30 * W, 0.18 * L]];
  const pos = new Float32Array(pts.length * 3), nrm = new Float32Array(pts.length * 3), uv = new Float32Array(pts.length * 2);
  pts.forEach(([x, z], i) => { pos.set([x, 0, z], i * 3); nrm.set([0, 1, 0], i * 3); uv.set([x / W + 0.5, z / L], i * 2); });
  const idx: number[] = [];
  for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1); // fan from the petiole
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Conifer "leaf" instance = a bottlebrush: needles fanning out along +Z (the shoot axis) over
 * `brushLen`, so a needle-bearing shoot reads as a dense brush rather than as 1 mm specks.
 */
function needleBrushGeometry(L: number, W: number, brushLen: number, count = 56): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < count; k++) {
    const a = k * golden;
    const z0 = (k / count) * brushLen;
    const tilt = 0.95 + 0.25 * Math.sin(k * 1.7); // ~55° off the axis, slightly varied
    // needle axis
    const ax = Math.sin(tilt) * Math.cos(a), ay = Math.sin(tilt) * Math.sin(a), az = Math.cos(tilt);
    // width direction: tangential
    const wx = -Math.sin(a), wy = Math.cos(a), wz = 0;
    const nx = ay * wz - az * wy, ny = az * wx - ax * wz, nz = ax * wy - ay * wx;
    const base = pos.length / 3;
    const len = L * (0.85 + 0.3 * ((k * 7) % 5) / 4);
    pos.push(wx * W / 2, wy * W / 2, z0 + wz * W / 2, -wx * W / 2, -wy * W / 2, z0 - wz * W / 2,
      -wx * W / 4 + ax * len, -wy * W / 4 + ay * len, z0 + az * len, wx * W / 4 + ax * len, wy * W / 4 + ay * len, z0 + az * len);
    for (let v = 0; v < 4; v++) nrm.push(nx, ny, nz);
    uv.push(1, 0, 0, 0, 0, 1, 1, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function disposeTree(): void {
  for (const m of [branchMesh, leafMesh]) {
    if (!m) continue;
    treeGroup.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  branchMesh = leafMesh = null;
}

function setModel(model: PlantModel, reframe: boolean): void {
  disposeTree();
  updateWall();
  currentModel = model;
  const sp = model.species;

  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(model.branches.position, 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(model.branches.normal, 3));
  bg.setAttribute('uv', new THREE.BufferAttribute(model.branches.uv, 2));
  bg.setIndex(new THREE.BufferAttribute(model.branches.index, 1));
  const barkMat = new THREE.MeshStandardMaterial({ roughness: sp.bark.roughness, metalness: 0 });
  barkMat.color.setRGB(sp.bark.color[0], sp.bark.color[1], sp.bark.color[2], THREE.LinearSRGBColorSpace);
  branchMesh = new THREE.Mesh(bg, barkMat);
  branchMesh.name = 'branches';
  branchMesh.castShadow = branchMesh.receiveShadow = true;
  treeGroup.add(branchMesh);

  const lv = model.leaves;
  const leafMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7, metalness: 0, vertexColors: false });
  leafMesh = new THREE.InstancedMesh(leafGeometry(sp), leafMat, Math.max(1, lv.count));
  leafMesh.name = 'leaves';
  leafMesh.castShadow = true;
  leafMesh.count = lv.count;
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < lv.count; i++) {
    p.fromArray(lv.position, i * 3);
    q.fromArray(lv.quaternion, i * 4);
    s.setScalar(lv.scale[i]); // 0 for dropped leaves -> degenerate, invisible instance
    leafMesh.setMatrixAt(i, m.compose(p, q, s));
    leafMesh.setColorAt(i, c.setRGB(lv.color[i * 3], lv.color[i * 3 + 1], lv.color[i * 3 + 2], THREE.LinearSRGBColorSpace));
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  leafMesh.frustumCulled = false;
  treeGroup.add(leafMesh);

  // shadow frustum tight around the tree
  const ext = Math.max(4, model.stats.height, model.stats.crownWidth) * 0.8;
  const sc = sun.shadow.camera;
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 120;
  sc.updateProjectionMatrix();
  sun.position.set(18, 30, 12).normalize().multiplyScalar(ext * 3);
  sun.target.position.set(0, model.stats.height * 0.5, 0);

  if (reframe) frameCamera(model);
  const st = model.stats;
  statusEl.textContent =
    `${sp.name} · seed ${model.individual.seed} · ${model.individual.ageYears} y · day ${model.individual.dayOfYear}\n` +
    `nodes ${st.nodes} · tips ${st.tips} · leaves ${st.leaves} · height ${st.height.toFixed(2)} m · trunk r ${(st.trunkRadius * 100).toFixed(1)} cm · ` +
    `growth ${st.growthMs.toFixed(0)} ms · mesh ${st.meshMs.toFixed(0)} ms · ${model.phenology.stage}`;
  window.__arborStats = { ...st, stage: model.phenology.stage };
  window.__arborReady = false;
  framesUntilReady = 2;
}

function frameCamera(model: PlantModel): void {
  const h = Math.max(1, model.stats.height);
  const dist = 1.6 * Math.max(h, model.stats.crownWidth, 2);
  controls.target.set(0, h * 0.5, 0);
  camera.position.set(0.55, 0.28, 1).normalize().multiplyScalar(dist).add(controls.target);
  camera.near = Math.max(0.05, dist / 200);
  camera.far = Math.max(500, dist * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

let framesUntilReady = -1;
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (framesUntilReady > 0 && --framesUntilReady === 0) window.__arborReady = true;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------------------
// Worker plumbing: one request in flight at a time; newest request wins.
// ---------------------------------------------------------------------------
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextId = 1, inFlight = 0, dirty = false, reframeNext = true, debounceTimer = 0;

function send(): void {
  if (inFlight) { dirty = true; return; }
  inFlight = nextId++;
  statusEl.textContent = 'generating…';
  const req: GenerateRequest = { id: inFlight, speciesId: state.species, individual: individualFromState() };
  worker.postMessage(req);
}
worker.onmessage = (ev: MessageEvent<GenerateResponse>) => {
  if (ev.data.id !== inFlight) return;
  inFlight = 0;
  if ('error' in ev.data) { statusEl.textContent = 'generation failed:\n' + ev.data.error; console.error(ev.data.error); }
  else { setModel(ev.data.model, reframeNext); reframeNext = false; }
  if (dirty) { dirty = false; send(); }
  else if (playing) advanceTimelapse();
};

// ---------------------------------------------------------------------------
// Timelapse: step age (years) or day-of-year after each generation completes
// ---------------------------------------------------------------------------
let playing: 'age' | 'season' | null = null;
function advanceTimelapse(): void {
  if (playing === 'age') {
    if (state.ageYears >= 60) { playing = null; refreshPlayButtons(); return; }
    state.ageYears += 1;
  } else if (playing === 'season') {
    state.dayOfYear = state.dayOfYear >= 365 ? 1 : Math.min(365, state.dayOfYear + 4);
  }
  pane.refresh();
  writeHash();
  send();
}
function togglePlay(mode: 'age' | 'season'): void {
  playing = playing === mode ? null : mode;
  if (playing === 'age' && state.ageYears >= 60) state.ageYears = 1;
  refreshPlayButtons();
  if (playing && !inFlight) advanceTimelapse();
}
function refreshPlayButtons(): void {
  playAgeBtn.title = playing === 'age' ? '■ Stop growth' : '▶ Play growth (1 → 60 y)';
  playSeasonBtn.title = playing === 'season' ? '■ Stop seasons' : '▶ Play seasons';
}
worker.onerror = (e) => { statusEl.textContent = 'worker error: ' + e.message; console.error(e); };

function requestGenerate(): void {
  writeHash();
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(send, 150);
}

// ---------------------------------------------------------------------------
// Tweakpane UI
// ---------------------------------------------------------------------------
readHash();
const pane = new Pane({ container: document.getElementById('pane')!, title: 'Arbor' });
const speciesOptions = Object.fromEntries(SPECIES_IDS.map((id) => [SPECIES[id].name, id]));
pane.addBinding(state, 'species', { options: speciesOptions }).on('change', () => {
  Object.assign(state, speciesDefaults(SPECIES[state.species]));
  reframeNext = true;
  pane.refresh();
});
pane.addBinding(state, 'seed', { step: 1, min: 0, max: 1_000_000 });
pane.addBinding(state, 'ageYears', { min: 1, max: 80, step: 1 });
pane.addBinding(state, 'dayOfYear', { min: 1, max: 365, step: 1 });
pane.addBinding(state, 'latitude', { min: -60, max: 70, step: 1 });
pane.addBinding(state, 'health', { min: 0.1, max: 1, step: 0.05 });

const ov = pane.addFolder({ title: 'Overrides', expanded: false });
ov.addBinding(state, 'crownShape', { options: Object.fromEntries(CROWN_SHAPES.map((s) => [s, s])) });
ov.addBinding(state, 'crownHeight', { min: 1, max: 40, step: 0.5 });
ov.addBinding(state, 'crownWidth', { min: 1, max: 40, step: 0.5 });
ov.addBinding(state, 'crownBaseHeight', { min: 0, max: 15, step: 0.1 });
ov.addBinding(state, 'apicalControl', { min: 0, max: 1, step: 0.01 });
ov.addBinding(state, 'gravitropism', { min: -0.6, max: 0.6, step: 0.01 });
ov.addBinding(state, 'phototropism', { min: 0, max: 2, step: 0.01 });
ov.addBinding(state, 'branchingAngle', { min: 10, max: 90, step: 1 });
ov.addBinding(state, 'lateralBudProbability', { min: 0, max: 1, step: 0.01 });
const env = pane.addFolder({ title: 'Environment', expanded: false });
env.addBinding(state, 'wallDistance', { label: 'wall x (0=off)', min: 0, max: 10, step: 0.5 });
env.addBinding(state, 'wallHeight', { label: 'wall height', min: 1, max: 20, step: 0.5 });
pane.on('change', requestGenerate);

pane.addButton({ title: 'Randomize seed' }).on('click', () => { state.seed = Math.floor(Math.random() * 1_000_000); pane.refresh(); });
const playAgeBtn = pane.addButton({ title: '▶ Play growth (1 → 60 y)' });
playAgeBtn.on('click', () => togglePlay('age'));
const playSeasonBtn = pane.addButton({ title: '▶ Play seasons' });
playSeasonBtn.on('click', () => togglePlay('season'));
pane.addButton({ title: 'Frame tree' }).on('click', () => { if (currentModel) frameCamera(currentModel); });
pane.addButton({ title: 'Export glTF' }).on('click', exportGltf);
pane.addButton({ title: 'Screenshot PNG' }).on('click', screenshot);

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportGltf(): void {
  if (!branchMesh || !leafMesh || !currentModel) return;
  const name = `arbor-${currentModel.species.id}-${currentModel.individual.seed}.glb`;
  new GLTFExporter().parse(
    treeGroup,
    (result) => download(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }), name),
    (err) => { console.error(err); statusEl.textContent = 'glTF export failed: ' + String(err); },
    { binary: true },
  );
}

function screenshot(): void {
  renderer.render(scene, camera); // make sure the canvas holds a fresh frame before reading it
  const name = currentModel ? `arbor-${currentModel.species.id}-${currentModel.individual.seed}.png` : 'arbor.png';
  renderer.domElement.toBlob((blob) => { if (blob) download(blob, name); }, 'image/png');
}

addEventListener('hashchange', () => { readHash(); pane.refresh(); reframeNext = true; requestGenerate(); });
requestGenerate();
