/**
 * Software rasteriser — the only way to eyeball the art without a browser.
 *
 *   node tools/preview.mjs <seed> <time> <out.png>
 *   VIEW=plot|river|forest|build BUILD=0 POST=0 W=1200 H=760
 *
 * It walks the real scene graph (terrain, instanced plants, leaf cards, water,
 * building pieces), shades it with the same palette and band logic as the GLSL,
 * and applies a CPU twin of the painterly post pass, so the PNG is an honest
 * preview of what the game draws.
 */
import * as THREE from 'three';
import zlib from 'node:zlib';
import fs from 'node:fs';

const ctx2d = {
  createRadialGradient: () => ({ addColorStop() {} }),
  createLinearGradient: () => ({ addColorStop() {} }),
  fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, drawImage() {},
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  set fillStyle(v) {}, set globalAlpha(v) {}, set globalCompositeOperation(v) {},
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'node', maxTouchPoints: 0 } });
globalThis.window = { innerWidth: 1400, innerHeight: 860, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  createElement: (tag) => ({ tagName: tag, style: {}, width: 0, height: 0, getContext: () => ctx2d }),
  createElementNS: () => ({ style: {}, getContext: () => ctx2d }),
  addEventListener() {},
};

const seed = Number(process.argv[2] || 20261105);
const time = Number(process.argv[3] || 8);
const out = process.argv[4] || '/tmp/preview.png';
const VIEW = process.env.VIEW || 'plot';
const POST = process.env.POST !== '0';
const W = Number(process.env.W || 1200);
const H = Number(process.env.H || 760);

const { generateWorld, PALETTE } = await import('../src/terrain/terrain.js');
const { buildTerrainMesh } = await import('../src/render/terrainMesh.js');
const { Vegetation } = await import('../src/render/vegetation.js');
const { WaterSystem } = await import('../src/render/water.js');
const { sampleTexture, groundTexture } = await import('../src/render/textures.js');

const P = PALETTE;
const world = generateWorld(seed);
const scene = new THREE.Scene();
scene.add(buildTerrainMesh(world));
new Vegetation(scene, world);
new WaterSystem(scene, world);

// ---- camera --------------------------------------------------------------
const ELEV = VIEW === 'build' ? 0.80 : VIEW === 'water' ? 0.92 : 0.985;
let DIST = VIEW === 'build' ? 13 : 43;
const camera = new THREE.PerspectiveCamera(26, W / H, 1, 420);
let target = new THREE.Vector3(world.plot.x, 0, world.plot.z + 2);
const RIBBON = Array.isArray(world.river) ? world.river : (world.river?.ribbon || []);
if (VIEW === 'water') {
  // widest, flattest stretch of the river
  // the stretch of river closest to the village, which is the one you see in play
  let best = RIBBON[0] || world.plot;
  let bd = Infinity;
  for (const p of RIBBON) {
    const d = Math.hypot(p.x - world.plot.x, p.z - world.plot.z);
    if (d < bd) { bd = d; best = p; }
  }
  target = new THREE.Vector3(best.x, 0, best.z);
  DIST = 24;
}
if (VIEW === 'river') {
  const p = RIBBON[Math.floor(RIBBON.length * 0.35)] || world.plot;
  target = new THREE.Vector3(p.x, 0, p.z);
}
if (VIEW === 'forest') {
  const t = world.props.trees[Math.floor(world.props.trees.length * 0.5)];
  target = new THREE.Vector3(t.x, 0, t.z);
  DIST = 30;
}
if (VIEW === 'build') {
  target = new THREE.Vector3(world.plot.x - 3.2, 0, world.plot.z + 1.4);
  const { BuildSystem } = await import('../src/game/build.js');
  const build = new BuildSystem(scene, world, { getResources: () => ({ wood: 9e9, stone: 9e9, fiber: 9e9 }), spend() {}, refund() {}, onFeedback() {} });
  const bx = world.plot.x - 3.2;
  const bz = world.plot.z + 1.4;
  const put = (shape, paint, dx, dz, layer, rot = 0) => {
    build.setShape(shape); build.setPaint(paint); build.rot = rot;
    build.moveCursor(bx + dx, bz + dz);
    build.setLayer(layer);
    build.place();
  };
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) put('block', 'stone', x, z, 0);
  for (let x = -1; x <= 1; x++) put('wall', 'brick', x, -1, 1);
  for (let z = -1; z <= 1; z++) if (z !== -1) put('wall', 'brick', -1, z, 1, 1);
  put('arch', 'oak', 1, 0, 1, 1);
  put('window', 'oak', 0, 1, 1, 1);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) put('roof', 'thatch', x, z, 2);
  put('lantern', 'pine', 2, 1, 0);
  put('planter', 'moss', 2, -1, 0);
  put('fence', 'darkwood', -2, 1, 0, 1);
  put('banner', 'oak', 1, 2, 0);
  build.rebuild();
}
target.y = world.heightAt(target.x, target.z);
camera.position.set(target.x, target.y + Math.sin(ELEV) * DIST, target.z + Math.cos(ELEV) * DIST);
camera.lookAt(target.x, target.y - 1.6, target.z);
camera.updateMatrixWorld(true);
const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

// ---- light ---------------------------------------------------------------
const SUN = new THREE.Vector3(-0.58, 0.79, -0.37).normalize();
const SUNCOL = [1.0, 0.86, 0.62];
const AMB = [0.35, 0.39, 0.34];
const FOG = [0.62, 0.63, 0.52];
const VIEWDIR = [0, -0.83, -0.55];
const CAMRIGHT = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
const WIND = new THREE.Vector3(0.80, 0, 0.60).normalize(); // matches uWindDir

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

function hash21(x, y) {
  let px = x * 123.34, py = y * 456.21;
  px -= Math.floor(px); py -= Math.floor(py);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d; py += d;
  const v = (px * py) % 1;
  return v < 0 ? v + 1 : v;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx0 = x - ix, fy0 = y - iy;
  const fx = fx0 * fx0 * (3 - 2 * fx0), fy = fy0 * fy0 * (3 - 2 * fy0);
  const a0 = hash21(ix, iy), b0 = hash21(ix + 1, iy), c0 = hash21(ix, iy + 1), d0 = hash21(ix + 1, iy + 1);
  return (a0 + (b0 - a0) * fx) * (1 - fy) + (c0 + (d0 - c0) * fx) * fy;
}

function light(col, n, ao = 0.9) {
  const d0 = (n.x * SUN.x + n.y * SUN.y + n.z * SUN.z) * 0.5 + 0.5;
  const b1 = smoothstep(0.395, 0.445, d0);
  const b2 = smoothstep(0.560, 0.610, d0);
  const b3 = smoothstep(0.735, 0.790, d0);
  const shade = (0.050 + 0.29 * b1 + 0.25 * b2 + 0.25 * b3) * (0.40 + 0.6 * ao);
  const amb = 0.34 * (0.55 + 0.45 * ao);
  const fillD = n.x * -VIEWDIR[0] + n.y * -VIEWDIR[1] + n.z * -VIEWDIR[2];
  const fill = clamp01(fillD * 0.5 + 0.5);
  const wall = 1 - 0.78 * Math.max(0, Math.min(1, n.y));
  const fk = 0.55 * fill * fill * wall;
  const ambK = [AMB[0] * 0.90, AMB[1] * 1.00, AMB[2] * 1.14];
  const r = col[0] * (ambK[0] * (amb + fk) + SUNCOL[0] * shade);
  const g = col[1] * (ambK[1] * (amb + fk) + SUNCOL[1] * shade);
  const b = col[2] * (ambK[2] * (amb + fk) + SUNCOL[2] * shade);
  const l = 0.3333 * (r + g + b);
  return [
    l + (r - l) * 1.10 + 0.010 * (1 - b1) * ao + 0.062 * b3 * Math.max(0, n.y),
    l + (g - l) * 1.10 + 0.022 * (1 - b1) * ao + 0.048 * b3 * Math.max(0, n.y),
    l + (b - l) * 1.10 + 0.036 * (1 - b1) * ao + 0.016 * b3 * Math.max(0, n.y),
  ];
}

// ---- terrain twin --------------------------------------------------------
function groundDetailJS(px, pz, sx, sz, fade, greenish) {
  const dirX = -0.30, dirZ = 0.954;
  const across = px * -dirZ + pz * dirX;
  const along = px * dirX + pz * dirZ;
  const clumpN = vnoise(px * 0.62 + 4, pz * 0.62 + 4) * 0.6 + vnoise(px * 1.45 - 2, pz * 1.45 - 2) * 0.4;
  const clump = smoothstep(0.52, 0.86, clumpN) * greenish;
  const len = Math.hypot(sx, sz) || 1;
  const sdx = sx / len, sdz = sz / len;
  const sa = (px * -sdz + pz * sdx) * 6.2;
  const sl = (px * sdx + pz * sdz) * 2.4;
  const cellA = Math.floor(sa), cellL = Math.floor(sl * 1.7);
  const hh = hash21(cellA, cellL);
  const wob = Math.sin(sl * 7 + hh * 6.2831) * 0.34;
  let stroke = (hh >= 0.58 ? 1 : 0) * smoothstep(0.52, 0.06, Math.abs((sa - cellA) - 0.5 + wob * 0.2));
  stroke += (hash21(cellA + 4, cellL * 1.3) >= 0.76 ? 1 : 0) * smoothstep(0.45, 0.05, Math.abs(((sa * 2.1 + 0.3) % 1) - 0.5)) * 0.7;
  const bx = Math.floor(across * 22), bz = Math.floor(along * 12);
  const bh = hash21(bx, bz);
  const blade = (bh >= 0.48 ? 1 : 0) * smoothstep(0.5, 0.02, Math.abs((across * 22 + bh * 0.6) % 1 - 0.5 + Math.sin(along * 26 + bh * 5) * 0.30));
  const gx = Math.floor(px * 5), gz = Math.floor(pz * 5);
  const dab = (hash21(gx, gz) >= 0.86 ? 1 : 0) * (0.4 + 0.6 * hash21(gx + 7, gz));
  const st = Math.min(1, stroke), bl = Math.min(1, blade);
  return [
    (-0.060 * st * (1 - greenish * 0.40) - 0.055 * clump + 0.080 * bl * greenish - 0.055 * dab * (1 - greenish * 0.5)) * fade,
    (-0.046 * st * (1 - greenish * 0.40) - 0.020 * clump + 0.098 * bl * greenish - 0.048 * dab * (1 - greenish * 0.5)) * fade,
    (-0.034 * st * (1 - greenish * 0.40) - 0.030 * clump + 0.030 * bl * greenish - 0.028 * dab * (1 - greenish * 0.5)) * fade,
  ];
}

let GROUND_TEX = null;
try {
  GROUND_TEX = groundTexture();
} catch {
  GROUND_TEX = null;
}
const wrapSample = (u, v) => {
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  return sampleTexture(GROUND_TEX, uu, vv)[0];
};

function groundPaintJS(p, fade) {
  if (fade < 0.01) return 0;
  const a = wrapSample(p[0] * 0.42, p[1] * 0.42) * 2 - 1;
  const b = wrapSample(p[0] * 1.55 + 0.37, p[1] * 1.55 + 0.19) * 2 - 1;
  const c = wrapSample(p[0] * 4.1 + 0.71, p[1] * 4.1 + 0.53) * 2 - 1;
  return (a * 0.52 + b * 0.31 + c * 0.17) * fade;
}

function terrainShade(wx, wz, nx, ny, nz, col, ao, dist) {
  const fade = smoothstep(96, 22, dist);
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const slope = 1 - ny;
  let r = col[0], g = col[1], b = col[2];
  const w1 = vnoise(wx * 0.085 + 3.7, wz * 0.085 + 3.7);
  const w2 = vnoise(wx * 0.26 - 8, wz * 0.26 - 8);
  const w3 = vnoise(wx * 0.72 + 21, wz * 0.72 + 21);
  const pool = smoothstep(0.34, 0.82, w1 * 0.7 + w3 * 0.3);
  const k1 = 0.94 + 0.13 * pool;
  const k2 = 1.06 - 0.28 * smoothstep(0.50, 0.90, w2);
  const k3 = 0.975 + w3 * 0.05;
  r *= k1 * k2 * k3; g *= k1 * k2 * k3; b *= k1 * k2 * k3;
  const shadeW = smoothstep(0.45, 0.9, w2);
  r += (r * 0.06) * pool * 0.55 + (r * -0.10) * shadeW * 0.45;
  g += (g * 0.02) * pool * 0.55 + (g * -0.01) * shadeW * 0.45;
  b += (b * -0.14) * pool * 0.55 + (b * 0.10) * shadeW * 0.45;
  const shadeN = vnoise(wx * 0.055 + 3.7, wz * 0.055 + 3.7) * 0.62 + vnoise(wx * 0.13 - 8, wz * 0.13 - 8) * 0.38;
  const ks = 0.58 + 0.48 * smoothstep(0.26, 0.66, shadeN);
  r *= ks; g *= ks; b *= ks;
  const greenish = smoothstep(0.005, 0.075, g - r);
  const det = groundDetailJS(wx, wz, nx, nz, fade, greenish);
  r += det[0]; g += det[1]; b += det[2];
  const steep = smoothstep(0.16, 0.55, slope);
  r *= 1 - 0.26 * steep; g *= 1 - 0.26 * steep; b *= 1 - 0.26 * steep;
  r += (r * -0.14) * steep * 0.5; g += (g * -0.12) * steep * 0.5; b += (b * -0.04) * steep * 0.5;
  const gtext = groundPaintJS([wx, wz], fade);
  const grassy = smoothstep(0.02, 0.30, g - r);
  const gk = 1 + gtext * (0.30 * grassy + 0.14 * (1 - grassy));
  r *= gk; g *= gk; b *= gk;
  r += 0.012 * gtext * grassy; g += 0.016 * gtext * grassy; b += 0.006 * gtext * grassy;
  const dap = vnoise(wx * 0.085 + 11, wz * 0.085 + 11) * 0.62 + vnoise(wx * 0.205 - 5, wz * 0.205 - 5) * 0.38;
  const sunlit = smoothstep(0.50, 0.84, dap) * (0.45 + 0.55 * ny);
  r += 0.085 * sunlit * greenish; g += 0.082 * sunlit * greenish; b += 0.030 * sunlit * greenish;
  const dk = 1 - 0.10 * smoothstep(0.34, 0.10, dap) * greenish;
  r *= dk; g *= dk; b *= dk;
  const tooth = vnoise(wx * 9, wz * 9) * 0.6 + vnoise(wx * 3.1, wz * 3.1) * 0.4;
  r *= 0.975 + tooth * 0.05; g *= 0.975 + tooth * 0.05; b *= 0.975 + tooth * 0.05;
  return light([r, g, b], { x: nx, y: ny, z: nz }, ao);
}

// ---- collect drawables ---------------------------------------------------
const clusters = [];
const decalClusters = [];
const seen = new Set();
function collect(obj, parentMatrix) {
  obj.updateMatrixWorld?.(false);
  const m = new THREE.Matrix4().multiplyMatrices(parentMatrix, new THREE.Matrix4().copy(obj.matrixWorld || new THREE.Matrix4()));
  const mat = obj.material;
  const isDecal = !!(mat && (mat.map || /shadow|decal|ghost/i.test(obj.name || '')));
  if (obj.isMesh && obj.geometry && isDecal) {
    const inst = obj.isInstancedMesh ? obj.count : 1;
    const mats = [];
    for (let i = 0; i < inst; i++) {
      obj.isInstancedMesh ? obj.getMatrixAt(i, worldMatTmp) : worldMatTmp.identity();
      mats.push(new THREE.Matrix4().multiplyMatrices(m, worldMatTmp));
    }
    decalClusters.push({ geo: obj.geometry, mats, name: obj.name, opacity: mat.opacity ?? 0.5, color: mat.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.06, 0.08, 0.06] });
  }
  if (obj.isMesh && obj.geometry && !isDecal) {
    const inst = obj.isInstancedMesh ? obj.count : 1;
    const mats = [];
    for (let i = 0; i < inst; i++) {
      obj.isInstancedMesh ? obj.getMatrixAt(i, worldMatTmp) : worldMatTmp.identity();
      mats.push(new THREE.Matrix4().multiplyMatrices(m, worldMatTmp));
    }
    clusters.push({ geo: obj.geometry, mats, material: mat, name: obj.name, obj });
  }
  for (const child of obj.children || []) {
    if (seen.has(child)) continue;
    seen.add(child);
    collect(child, m);
  }
}
const worldMatTmp = new THREE.Matrix4();
collect(scene, new THREE.Matrix4());

// ---- raster --------------------------------------------------------------
const img = new Float32Array(W * H * 3).fill(0.62);
const zbuf = new Float32Array(W * H).fill(Infinity);
let tris = 0;
const v3a = new THREE.Vector3(), v3b = new THREE.Vector3(), v3c = new THREE.Vector3();
const vn = new THREE.Vector3();

function project(p, o) {
  const e = viewProj.elements;
  const x = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12];
  const y = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13];
  const z = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
  const w = e[3] * p.x + e[7] * p.y + e[11] * p.z + e[15];
  const iw = w > 1e-6 ? 1 / w : 1e6;
  o.x = (x * iw * 0.5 + 0.5) * W;
  o.y = (-y * iw * 0.5 + 0.5) * H;
  o.z = z * iw;
  o.w = w;
  return o;
}
const pa = {}, pb = {}, pc = {};

function shadePixel(A, B, C, w0, w1, w2, mode, idxp) {
  if (mode.kind === 'decal') {
    const u = A.uv[0] * w0 + B.uv[0] * w1 + C.uv[0] * w2;
    const v = A.uv[1] * w0 + B.uv[1] * w1 + C.uv[1] * w2;
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    if (d >= 1) return;
    const grad = d < 0.55 ? 0.85 + (0.45 - 0.85) * (d / 0.55) : 0.45 * (1 - (d - 0.55) / 0.45);
    const a = Math.max(0, grad) * mode.opacity;
    img[idxp * 3] += (mode.color[0] - img[idxp * 3]) * a;
    img[idxp * 3 + 1] += (mode.color[1] - img[idxp * 3 + 1]) * a;
    img[idxp * 3 + 2] += (mode.color[2] - img[idxp * 3 + 2]) * a;
    return;
  }
  if (mode.kind === 'bed') {
    const u = A.uv[0] * w0 + B.uv[0] * w1 + C.uv[0] * w2;
    const edge = Math.min(u, 1 - u);
    const mid = smoothstep(0, 0.35, edge);
    const wet = 0.86 + vnoise((A.p.x * w0 + B.p.x * w1 + C.p.x * w2) * 6, (A.p.z * w0 + B.p.z * w1 + C.p.z * w2) * 6) * 0.24;
    const er = 0.318, eg = 0.290, eb = 0.188;
    const wr = 0.212, wg = 0.231, wb = 0.153;
    const r0 = (er + (wr - er) * mid) * wet;
    const g0 = (eg + (wg - eg) * mid) * wet;
    const b0 = (eb + (wb - eb) * mid) * wet;
    const lit = light([r0, g0, b0], { x: 0, y: 1, z: 0 }, 0.62);
    const dpt = pa.w * w0 + pb.w * w1 + pc.w * w2;
    const f = smoothstep(34, 118, dpt) * 0.8;
    img[idxp * 3] = lit[0] + (FOG[0] - lit[0]) * f;
    img[idxp * 3 + 1] = lit[1] + (FOG[1] - lit[1]) * f;
    img[idxp * 3 + 2] = lit[2] + (FOG[2] - lit[2]) * f;
    return;
  }
  vn.set(
    A.n.x * w0 + B.n.x * w1 + C.n.x * w2,
    A.n.y * w0 + B.n.y * w1 + C.n.y * w2,
    A.n.z * w0 + B.n.z * w1 + C.n.z * w2,
  ).normalize();
  let cr = A.c[0] * w0 + B.c[0] * w1 + C.c[0] * w2;
  let cg = A.c[1] * w0 + B.c[1] * w1 + C.c[1] * w2;
  let cb = A.c[2] * w0 + B.c[2] * w1 + C.c[2] * w2;
  if (mode.kind === 'water') {
    const d = mode.data;
    const u = A.uv[0] * w0 + B.uv[0] * w1 + C.uv[0] * w2;
    const v = A.uv[1] * w0 + B.uv[1] * w1 + C.uv[1] * w2;
    const flow = v - time * 0.175;
    const swell = vnoise(u * 3 - 1, flow * 5);
    const current = vnoise(u * 11, flow * 9);
    const chop = vnoise(u * 21 + 5, flow * 17);
    const edge = Math.min(u, 1 - u);
    const depthBand = smoothstep(0.0, 0.12, edge);
    const { deep, shallow, foam, stroke } = d;
    let r = shallow[0] + (deep[0] - shallow[0]) * depthBand * (0.85 + 0.15 * swell);
    let g = shallow[1] + (deep[1] - shallow[1]) * depthBand * (0.85 + 0.15 * swell);
    let b = shallow[2] + (deep[2] - shallow[2]) * depthBand * (0.85 + 0.15 * swell);
    const rp0 = u * 1.6, rp1 = flow * 0.55;
    const refl = vnoise(rp0, rp1) * 0.55 + vnoise(rp0 * 2.3 + 7, rp1 * 2.3 + 7) * 0.3 + vnoise(rp0 * 5.1 - 3, rp1 * 5.1 - 3) * 0.15;
    const columns = smoothstep(0.34, 0.78, refl) * 0.42 * (0.35 + 0.65 * depthBand);
    r += (stroke[0] * 1.15 - r) * columns;
    g += (stroke[1] * 1.15 - g) * columns;
    b += (stroke[2] * 1.15 - b) * columns;
    const warm = 0.14 * smoothstep(0.5, 0.95, swell) * depthBand;
    r += foam[0] * warm; g += foam[1] * warm; b += foam[2] * warm;
    const sky = smoothstep(0.72, 0.95, swell) * 0.22;
    r += (foam[0] * 1.04 - r) * sky; g += (foam[1] * 1.04 - g) * sky; b += (foam[2] * 1.04 - b) * sky;
    const lines = smoothstep(0.55, 0.95, current * 0.65 + chop * 0.4) * 0.26;
    r += foam[0] * lines; g += foam[1] * lines; b += foam[2] * lines;
    const drag = smoothstep(0.66, 0.94, chop * 0.55 + current * 0.5) * 0.40;
    r += (stroke[0] - r) * drag; g += (stroke[1] - g) * drag; b += (stroke[2] - b) * drag;
    const glint = smoothstep(0.92, 0.998, chop * 0.6 + current * 0.55) * 0.55;
    r += foam[0] * glint; g += foam[1] * glint; b += foam[2] * glint;
    const lace = smoothstep(0.06, 0.0, edge) * (0.45 + 0.55 * vnoise(v * 26 - time * 1.2, 3)) * 0.55;
    r += (foam[0] - r) * lace; g += (foam[1] - g) * lace; b += (foam[2] - b) * lace;
    // water light
    const lw = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lw + (r - lw) * 1.04; g = lw + (g - lw) * 1.04; b = lw + (b - lw) * 1.04;
    r = r * 1.16 + 0.045; g = g * 1.16 + 0.050; b = b * 1.16 + 0.032;
    const dpt = pa.w * w0 + pb.w * w1 + pc.w * w2;
    const f = smoothstep(34, 118, dpt) * 0.8;
    img[idxp * 3] = clamp01(r + (FOG[0] - r) * f);
    img[idxp * 3 + 1] = clamp01(g + (FOG[1] - g) * f);
    img[idxp * 3 + 2] = clamp01(b + (FOG[2] - b) * f);
    return;
  }
  const lit = light([cr, cg, cb], vn, 0.94);
  const dpt = pa.w * w0 + pb.w * w1 + pc.w * w2;
  const f = smoothstep(34, 118, dpt) * 0.8;
  img[idxp * 3] = lit[0] + (FOG[0] - lit[0]) * f;
  img[idxp * 3 + 1] = lit[1] + (FOG[1] - lit[1]) * f;
  img[idxp * 3 + 2] = lit[2] + (FOG[2] - lit[2]) * f;
}

function drawTri(A, B, C, mode) {
  project(A.p, pa); project(B.p, pb); project(C.p, pc);
  if (pa.w <= 0.02 || pb.w <= 0.02 || pc.w <= 0.02) return;
  const minX = Math.max(0, Math.floor(Math.min(pa.x, pb.x, pc.x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(pa.x, pb.x, pc.x)));
  const minY = Math.max(0, Math.floor(Math.min(pa.y, pb.y, pc.y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(pa.y, pb.y, pc.y)));
  if (minX > maxX || minY > maxY) return;
  tris++;
  const area = (pb.x - pa.x) * (pc.y - pa.y) - (pc.x - pa.x) * (pb.y - pa.y);
  if (Math.abs(area) < 1e-9) return;
  const inv = 1 / area;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((pb.x - px) * (pc.y - py) - (pc.x - px) * (pb.y - py)) * inv;
      if (w0 < -0.002) continue;
      const w1 = ((pc.x - px) * (pa.y - py) - (pa.x - px) * (pc.y - py)) * inv;
      if (w1 < -0.002) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < -0.002) continue;
      const z = w0 * pa.z + w1 * pb.z + w2 * pc.z;
      const idxp = y * W + x;
      if (mode.kind === 'decal') {
        if (z - 0.004 >= zbuf[idxp]) continue;
        shadePixel(A, B, C, w0, w1, w2, mode, idxp);
        continue;
      }
      if (z >= zbuf[idxp]) continue;
      if (process.env.PIXEL && Math.abs(x - Number(process.env.PIXEL.split(',')[0])) < 2 && Math.abs(y - Number(process.env.PIXEL.split(',')[1])) < 2) {
        console.log('pixel', x, y, 'mode', mode.kind, 'u', (A.uv[0] * w0 + B.uv[0] * w1 + C.uv[0] * w2).toFixed(3));
      }

      if (mode.kind === 'card') {
        const u = A.uv[0] * w0 + B.uv[0] * w1 + C.uv[0] * w2;
        const v = 1 - (A.uv[1] * w0 + B.uv[1] * w1 + C.uv[1] * w2);
        const tex = sampleTexture(mode.tex, u, v);
        if (tex[3] < 0.42) continue;
        zbuf[idxp] = z;
        vn.set(0.30, 0.86, 0.41).normalize();
        const lit = light([tex[0], tex[1], tex[2]], vn, 0.86);
        const dpt = pa.w * w0 + pb.w * w1 + pc.w * w2;
        const f = smoothstep(34, 118, dpt) * 0.8;
        img[idxp * 3] = lit[0] + (FOG[0] - lit[0]) * f;
        img[idxp * 3 + 1] = lit[1] + (FOG[1] - lit[1]) * f;
        img[idxp * 3 + 2] = lit[2] + (FOG[2] - lit[2]) * f;
        continue;
      }

      if (mode.kind === 'terrain') {
        const wx = A.p.x * w0 + B.p.x * w1 + C.p.x * w2;
        const wz = A.p.z * w0 + B.p.z * w1 + C.p.z * w2;
        const ao = A.ao * w0 + B.ao * w1 + C.ao * w2;
        const dpt = pa.w * w0 + pb.w * w1 + pc.w * w2;
        zbuf[idxp] = z;
        const ny = A.n.y * w0 + B.n.y * w1 + C.n.y * w2;
        const lit = terrainShade(
          wx, wz,
          A.n.x * w0 + B.n.x * w1 + C.n.x * w2, ny, A.n.z * w0 + B.n.z * w1 + C.n.z * w2,
          [A.c[0] * w0 + B.c[0] * w1 + C.c[0] * w2, A.c[1] * w0 + B.c[1] * w1 + C.c[1] * w2, A.c[2] * w0 + B.c[2] * w1 + C.c[2] * w2],
          ao, dpt,
        );
        const f = smoothstep(34, 118, dpt) * 0.8;
        img[idxp * 3] = lit[0] + (FOG[0] - lit[0]) * f;
        img[idxp * 3 + 1] = lit[1] + (FOG[1] - lit[1]) * f;
        img[idxp * 3 + 2] = lit[2] + (FOG[2] - lit[2]) * f;
        continue;
      }

      zbuf[idxp] = z;
      shadePixel(A, B, C, w0, w1, w2, mode, idxp);
    }
  }
}

function drawGeometry(geo, m, mode) {
  const pos = geo.getAttribute('position');
  if (!pos) return;
  if (mode.kind === 'card') return drawCards(geo, m, mode);
  const col = geo.getAttribute('aColor');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const aoa = geo.getAttribute('aAO');
  const idx = geo.getIndex();
  const count = idx ? idx.count : pos.count;
  const verts = [];
  for (let i = 0; i < pos.count; i++) {
    v3a.fromBufferAttribute(pos, i).applyMatrix4(m);
    if (nor) vn.fromBufferAttribute(nor, i).transformDirection(m).normalize(); else vn.set(0, 1, 0);
    const c = col ? [col.getX(i), col.getY(i), col.getZ(i)] : [0.5, 0.5, 0.5];
    verts.push({
      p: v3a.clone(), n: vn.clone(), c,
      uv: uv ? [uv.getX(i), uv.getY(i)] : [0, 0],
      ao: aoa ? aoa.getX(i) : 0.85,
    });
  }
  for (let t = 0; t < count; t += 3) {
    const A = verts[idx ? idx.getX(t) : t];
    const B = verts[idx ? idx.getX(t + 1) : t + 1];
    const C = verts[idx ? idx.getX(t + 2) : t + 2];
    if (A && B && C) drawTri(A, B, C, mode);
  }
}

// Leaf cards are billboarded in the vertex shader: the quad lives in the
// camera's right/up plane at an offset inside the plant, with a slow flutter.
// The twin has to do the same or the cards show up as flat discs.
function drawCards(geo, m, mode) {
  const pos = geo.getAttribute('position');
  const uvA = geo.getAttribute('uv');
  const off = geo.getAttribute('aOffset');
  const sizeA = geo.getAttribute('aSize');
  const phaseA = geo.getAttribute('aPhase');
  if (!off) return;
  const idx = geo.getIndex();
  const count = idx ? idx.count : pos.count;
  const scl = (m.elements[0] ** 2 + m.elements[1] ** 2 + m.elements[2] ** 2) ** 0.5;
  const verts = [];
  for (let i = 0; i < pos.count; i++) {
    const centre = new THREE.Vector3(off.getX(i), off.getY(i), off.getZ(i)).applyMatrix4(m);
    const phase = phaseA ? phaseA.getX(i) : 0;
    const rot = phase * 0.35;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const px = pos.getX(i), py = pos.getY(i);
    const corner = [px * cs - py * sn, px * sn + py * cs];
    const s = pos.getZ(i) * (sizeA ? sizeA.getX(i) : 1) * scl;
    const gust = Math.sin(time * 0.6 + centre.x * 0.11 + centre.z * 0.09) * 0.5 + 0.5;
    const flutter = Math.sin(time * 1.7 + phase * 6.2831 + centre.y) * 0.05 * (0.4 + gust);
    const p = new THREE.Vector3(
      centre.x + CAMRIGHT.x * corner[0] * s + WIND.x * flutter * (0.5 + corner[1] * 0.5),
      centre.y + corner[1] * s * 0.92,
      centre.z + CAMRIGHT.z * corner[0] * s + WIND.z * flutter * (0.5 + corner[1] * 0.5),
    );
    verts.push({
      p,
      n: new THREE.Vector3(0.30, 0.86, 0.41).normalize(),
      c: [0.5, 0.5, 0.5],
      uv: uvA ? [uvA.getX(i), uvA.getY(i)] : [0, 0],
      ao: 0.9,
    });
  }
  for (let t = 0; t < count; t += 3) {
    const A = verts[idx ? idx.getX(t) : t];
    const B = verts[idx ? idx.getX(t + 1) : t + 1];
    const C = verts[idx ? idx.getX(t + 2) : t + 2];
    if (A && B && C) drawTri(A, B, C, mode);
  }
}

// ---- draw ---------------------------------------------------------------
if (process.env.DEBUG) {
  for (const cl of clusters) {
    if (!cl.material?.uniforms) continue;
    const u = cl.material.uniforms;
    if (!u.uFlow && !u.uWet) continue;
    cl.geo.computeBoundingBox();
    const b = cl.geo.boundingBox;
    console.log('waterish', cl.name, u.uFall?.value, 'tris', cl.geo.getAttribute('position').count / 3,
      'bb', [b.min.x.toFixed(1), b.min.z.toFixed(1), b.max.x.toFixed(1), b.max.z.toFixed(1)].join(','));
  }
}
for (const cl of clusters) {
  let mode = { kind: 'solid' };
  if (cl.material?.uniforms?.uWet) {
    mode = { kind: 'bed' };
  } else if (cl.material?.uniforms?.uFlow) {
    const u = cl.material.uniforms;
    const col = (c) => (c ? [c.r, c.g, c.b] : [0.5, 0.5, 0.5]);
    mode = {
      kind: 'water',
      data: {
        deep: col(u.uDeep?.value),
        shallow: col(u.uShallow?.value),
        stroke: col(u.uStroke?.value),
        foam: col(u.uFoam?.value),
        fall: u.uFall?.value > 0.5,
      },
    };
  } else if (cl.material?.uniforms?.uMap) {
    mode = { kind: 'card', tex: cl.material.uniforms.uMap.value };
  } else if (cl.geo.getAttribute?.('aAO')) {
    mode = { kind: 'terrain' };
  }
  for (const m of cl.mats) drawGeometry(cl.geo, m, mode);
}

// Soft contact shadow decals, drawn last with a depth bias so they sit on the
// ground they belong to. The game uses the same numbers: a radial falloff,
// multiplied toward a near-black green.
for (const cl of decalClusters) {
  const mode = { kind: 'decal', opacity: cl.opacity, color: cl.color };
  for (const m of cl.mats) drawGeometry(cl.geo, m, mode);
}

// ---- painterly post ------------------------------------------------------
if (POST) {
  const gw = Math.max(2, W >> 2), gh = Math.max(2, H >> 2);
  const glow = new Float32Array(gw * gh * 3);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const i = (Math.min(H - 1, y * 4 + dy) * W + Math.min(W - 1, x * 4 + dx)) * 3;
          r += img[i]; g += img[i + 1]; b += img[i + 2];
        }
      }
      r /= 16; g /= 16; b /= 16;
      const k = smoothstep(0.66, 0.96, 0.299 * r + 0.587 * g + 0.114 * b);
      const i = (y * gw + x) * 3;
      glow[i] = r * k; glow[i + 1] = g * k; glow[i + 2] = b * k;
    }
  }
  const tmp = new Float32Array(glow.length);
  const blur = (src, dst, dx, dy, rad) => {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let r = 0, g = 0, b = 0, ws = 0;
        for (let k = -rad; k <= rad; k++) {
          const sx = Math.min(gw - 1, Math.max(0, x + k * dx));
          const sy = Math.min(gh - 1, Math.max(0, y + k * dy));
          const wt = Math.exp(-(k * k) / (rad * rad * 0.5));
          const i = (sy * gw + sx) * 3;
          r += src[i] * wt; g += src[i + 1] * wt; b += src[i + 2] * wt; ws += wt;
        }
        const i = (y * gw + x) * 3;
        dst[i] = r / ws; dst[i + 1] = g / ws; dst[i + 2] = b / ws;
      }
    }
  };
  blur(glow, tmp, 1, 0, 4);
  blur(tmp, glow, 0, 1, 4);

  const src = img.slice();
  const smear = 0.58, flat = 0.30, grain = 0.045, glowAmt = 0.32, vig = 0.36;
  const dirX = 0.86, dirY = 0.51;
  const s = [0, 0, 0];
  const sample = (x, y, o) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(H - 1, Math.max(0, Math.round(y)));
    const i = (yi * W + xi) * 3;
    o[0] = src[i]; o[1] = src[i + 1]; o[2] = src[i + 2];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const r0 = src[i], g0 = src[i + 1], b0 = src[i + 2];
      const lb = luma([r0, g0, b0]);
      let ar = r0 * 0.30, ag = g0 * 0.30, ab = b0 * 0.30, ws = 0.30;
      for (let k = 1; k <= 3; k++) {
        const o = k * 1.5;
        sample(x + dirX * o, y + dirY * o, s);
        let wt = 0.20 - (k - 1) * 0.04;
        let kk = wt * (1 - smoothstep(0.045, 0.26, Math.abs(luma(s) - lb)));
        ar += s[0] * kk; ag += s[1] * kk; ab += s[2] * kk; ws += kk;
        sample(x - dirX * o, y - dirY * o, s);
        kk = wt * (1 - smoothstep(0.045, 0.26, Math.abs(luma(s) - lb)));
        ar += s[0] * kk; ag += s[1] * kk; ab += s[2] * kk; ws += kk;
      }
      let cr = r0 + (ar / ws - r0) * smear;
      let cg = g0 + (ag / ws - g0) * smear;
      let cb = b0 + (ab / ws - b0) * smear;

      const l = luma([cr, cg, cb]);
      const q = Math.floor(l * 9 + 0.5) / 9;
      const tg = Math.min(1.75, Math.max(0.55, q / Math.max(l, 0.0008)));
      cr += (cr * tg - cr) * flat; cg += (cg * tg - cg) * flat; cb += (cb * tg - cb) * flat;

      const tooth = vnoise(x * 0.55, y * 0.55) * 0.62 + vnoise(x * 1.7 + 31, y * 1.7 + 11) * 0.38;
      const gk = 1 + (tooth - 0.5) * grain;
      cr *= gk; cg *= gk; cb *= gk;

      const gi = (Math.min(gh - 1, y >> 2) * gw + Math.min(gw - 1, x >> 2)) * 3;
      cr += glow[gi] * glowAmt; cg += glow[gi + 1] * glowAmt; cb += glow[gi + 2] * glowAmt;

      cr *= 0.95; cg *= 0.95; cb *= 0.95;
      const l2 = clamp01(luma([cr, cg, cb]));
      const liftW = (1 - smoothstep(0.02, 0.42, l2)) * 0.75;
      cr *= 1 - 0.10 * liftW; cg *= 1; cb *= 1 + 0.06 * liftW;
      const gainW = smoothstep(0.45, 1.0, l2) * 0.85;
      cr *= 1 + 0.05 * gainW; cg *= 1; cb *= 1 - 0.07 * gainW;
      cr = cr + (cr * cr * (3 - 2 * cr) - cr) * 0.22;
      cg = cg + (cg * cg * (3 - 2 * cg) - cg) * 0.22;
      cb = cb + (cb * cb * (3 - 2 * cb) - cb) * 0.22;

      const dx = (x / W - 0.5) * (W / H), dy = y / H - 0.5;
      const vk = 1 - vig * smoothstep(0.34, 1.12, Math.sqrt(dx * dx + dy * dy));
      img[i] = clamp01(cr * vk);
      img[i + 1] = clamp01(cg * vk);
      img[i + 2] = clamp01(cb * vk);
    }
  }
}

// ---- png -----------------------------------------------------------------
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const o = y * (W * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(clamp01(img[i]) * 255);
    raw[o + 1] = Math.round(clamp01(img[i + 1]) * 255);
    raw[o + 2] = Math.round(clamp01(img[i + 2]) * 255);
  }
}
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 255];
    return (crc ^ -1) >>> 0;
  };
})();
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log(`wrote ${out}  tris=${tris}  clusters=${clusters.length}  post=${POST ? 'on' : 'off'}`);
