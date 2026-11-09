/**
 * Plants — every piece of greenery is real geometry, painted flat.
 *
 * The reference paintings never use photographic leaf cards: a plant is a
 * handful of brush strokes with hard edges and a light/dark split. So each
 * generator below builds small faceted shapes, bakes the light into vertex
 * colours, and lets one instanced draw call scatter thousands of them.
 *
 *   grassTuft  · a fan of tapered blades
 *   fern       · arcing fronds
 *   bush       · a dark core wrapped in leaf lobes
 *   canopy     · overlapping lobes with lighter dabs around the rim
 *   pine       · stacked, jagged needle skirts
 *   mushroom   · stem + cap
 */
import * as THREE from 'three';
import { PALETTE } from '../terrain/terrain.js';

const P = PALETTE;

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const scale3 = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

function hash(...args) {
  let h = 2166136261;
  for (const a of args) {
    h ^= Math.imul((a * 1000) | 0, 374761393);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
  }
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Foliage reads lit-from-above in the reference paintings, so painted plants
 * get their normals pulled toward the sky instead of being physically correct.
 */
function biasNormals(geo, up = 0.72) {
  const n = geo.getAttribute('normal');
  if (!n) return geo;
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i) * (1 - up), y = n.getY(i) * (1 - up) + up, z = n.getZ(i) * (1 - up);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(i, x / l, y / l, z / l);
  }
  n.needsUpdate = true;
  return geo;
}

/** Raw non-indexed geometry from explicit triangles + a colour per vertex. */
class Painter {
  constructor() {
    this.pos = [];
    this.col = [];
  }
  tri(a, b, c, ca, cb, cc) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  }
  quad(a, b, c, d, ca, cb, cc, cd) {
    this.tri(a, b, c, ca, cb, cc);
    this.tri(a, c, d, ca, cc, cd);
  }
  get count() {
    return this.pos.length / 3;
  }
  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    geo.computeVertexNormals();
    return geo;
  }
}

/** Append one painted geometry onto a Painter, transformed. */
function absorb(painter, geo, matrix, tint = [1, 1, 1]) {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('aColor');
  const v = new THREE.Vector3();
  const tri = [];
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix);
    tri.push([v.x, v.y, v.z, col.getX(i) * tint[0], col.getY(i) * tint[1], col.getZ(i) * tint[2]]);
    if (tri.length === 3) {
      painter.tri(
        [tri[0][0], tri[0][1], tri[0][2]], [tri[1][0], tri[1][1], tri[1][2]], [tri[2][0], tri[2][1], tri[2][2]],
        [tri[0][3], tri[0][4], tri[0][5]], [tri[1][3], tri[1][4], tri[1][5]], [tri[2][3], tri[2][4], tri[2][5]],
      );
      tri.length = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Blades — the ground cover that gives the reference its "textured" ground
// ---------------------------------------------------------------------------

/**
 * One tapered blade: three rows of vertices, curved and leaning outward.
 * The face points at the camera (the game camera never moves), with a jitter
 * so a tuft never looks like a row of identical fins.
 */
function addBlade(painter, {
  angle, lean, height, width, curve, base = [0, 0, 0],
  cBase, cMid, cTip, seed,
}) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const rows = 2;
  const pts = [];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const y = height * t;
    const out = lean * Math.pow(t, 1.5);
    const w = width * (1 - t * 0.86) * (1 + Math.sin(t * 3.1 + seed) * 0.12);
    const wobble = Math.sin(t * 2.4 + seed * 6.2831) * curve;
    const cx = base[0] + ca * (out + wobble);
    const cz = base[2] + sa * (out + wobble);
    pts.push([
      [cx - sa * w, base[1] + y, cz + ca * w],
      [cx + sa * w, base[1] + y, cz - ca * w],
      t,
    ]);
  }
  const shadeAt = (t) => {
    const j = 0.94 + hash(seed, t, 3) * 0.12;
    return scale3(t < 0.5 ? mix(cBase, cMid, t * 2) : mix(cMid, cTip, (t - 0.5) * 2), j);
  };
  const c0 = shadeAt(0), c1 = shadeAt(1);
  const a = pts[0], b = pts[1];
  painter.quad(a[0], a[1], b[1], b[0], c0, c0, c1, c1);
}

/** A tuft of blades — the unit of ground cover. */
export function grassTuftGeometry(opts = {}) {
  const { blades = 5, height = 0.52, spread = 0.13, seed = 1 } = opts;
  const p = new Painter();
  for (let i = 0; i < blades; i++) {
    const r = hash(seed, i, 1);
    const r2 = hash(seed, i, 2);
    const r3 = hash(seed, i, 3);
    const angle = (r3 - 0.5) * 1.15;                 // faces the camera, jittered
    const h = height * (0.6 + r * 0.85);
    const tone = 0.9 + r2 * 0.22;
    addBlade(p, {
      angle,
      lean: spread * (0.5 + r2 * 1.6),
      height: h,
      width: 0.026 + r3 * 0.014,
      curve: spread * 0.35,
      base: [(r2 - 0.5) * spread * 1.5, 0, (r3 - 0.5) * spread * 1.5],
      cBase: scale3(mix(P.grassMid, P.grassLight, 0.30), tone * 0.98),
      cMid: scale3(mix(P.grassLight, P.grassSun, 0.30), tone),
      cTip: scale3(mix(P.grassSun, P.grassLight, 0.15), tone * 1.06),
      seed: seed * 7.3 + i * 1.7,
    });
  }
  return biasNormals(p.build(), 0.62);
}

// ---------------------------------------------------------------------------
// Ferns
// ---------------------------------------------------------------------------
export function fernGeometry(seed = 2) {
  const p = new Painter();
  const fronds = 5;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + seed * 0.7;
    const r = hash(seed, i, 1);
    addBlade(p, {
      angle: a - Math.PI / 2 + (r - 0.5) * 0.5,
      lean: 0.34 + r * 0.22,
      height: 0.62 + r * 0.28,
      width: 0.075,
      curve: 0.05,
      cBase: P.grassDeep,
      cMid: mix(P.grassMid, P.grassLight, 0.35),
      cTip: mix(P.grassLight, P.grassSun, 0.45),
      seed: seed + i * 2.1,
    });
  }
  return biasNormals(p.build(), 0.55);
}

// ---------------------------------------------------------------------------
// Bushes and canopies — volumes made of overlapping painted lobes
// ---------------------------------------------------------------------------
/**
 * A leafy mass: a few overlapping jittered blobs whose vertex colours already
 * carry the light (bright on the sun side, near-black underneath) plus a hint
 * of leaf-scale noise, so the surface reads as painted foliage.
 */
function leafyMass({ lobes, seed, jitter = 0.3, dark, mid, light, hi = null, radius = 1 }) {
  const painter = new Painter();
  const sun = new THREE.Vector3(-0.55, 0.72, 0.42).normalize();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < lobes.length; i++) {
    const [x, y, z, r] = lobes[i];
    const geo = new THREE.IcosahedronGeometry(r, i === 0 ? 1 : 0);
    const pos = geo.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      v.set(pos.getX(k), pos.getY(k), pos.getZ(k));
      const h = hash(Math.round(v.x * 11 + seed + i), Math.round(v.y * 11), Math.round(v.z * 11));
      const h2 = hash(Math.round(v.y * 13), Math.round(v.z * 13 + i), Math.round(v.x * 13 + seed));
      v.multiplyScalar(1 + (h - 0.5) * jitter + (h2 - 0.5) * jitter * 0.5);
      pos.setXYZ(k, v.x, v.y * 0.88, v.z);
    }
    const flat = geo.index ? geo.toNonIndexed() : geo;
    flat.computeVertexNormals();
    const fp = flat.getAttribute('position');
    const fn = flat.getAttribute('normal');
    // per-vertex tone, baked from a fixed sun so the mass is painted, not lit
    const cols = new Float32Array(fp.count * 3);
    for (let k = 0; k < fp.count; k++) {
      n.set(fn.getX(k), fn.getY(k), fn.getZ(k));
      const lit = Math.max(0, n.dot(sun));            // 0 … 1
      const up = Math.max(0, n.y);
      let c = mix(dark, mid, Math.min(1, lit * 1.7));
      c = mix(c, light, Math.max(0, lit - 0.55) * 1.1 + Math.max(0, up - 0.5) * 0.35);
      // sun-struck dabs on the very top of the crown, like the key art
      if (hi) c = mix(c, hi, Math.max(0, lit - 0.78) * 1.7 + Math.max(0, up - 0.72) * 0.55);
      const leaf = hash(Math.round(fp.getX(k) * 6), Math.round(fp.getY(k) * 6 + i), Math.round(fp.getZ(k) * 6));
      const j = 0.90 + leaf * 0.22;
      cols[k * 3] = c[0] * j; cols[k * 3 + 1] = c[1] * j; cols[k * 3 + 2] = c[2] * j;
    }
    flat.setAttribute('aColor', new THREE.BufferAttribute(cols, 3));
    absorb(painter, flat, new THREE.Matrix4().makeTranslation(x * radius, y * radius, z * radius)
      .multiply(new THREE.Matrix4().makeScale(radius, radius, radius)));
  }
  return biasNormals(painter.build(), 0.30);
}

export function bushGeometry(seed = 3) {
  const lobes = [
    [0, 0.42, 0, 0.5], [0.3, 0.30, 0.16, 0.38], [-0.28, 0.26, -0.18, 0.36],
    [0.06, 0.52, -0.22, 0.32],
  ];
  // the blob sits on the ground, so lift it a little
  const geo = leafyMass({
    lobes, seed, jitter: 0.36,
    dark: P.grassDeep, mid: P.grassMid, light: P.grassLight,
    hi: mix(P.grassLight, P.grassSun, 0.4),
  });
  geo.translate(0, 0.06, 0);
  return geo;
}

export function canopyGeometry(seed = 11) {
  // A crown is a dome of lobes: a big heart, a ring of shoulders and a cap.
  // Overlapping lobes with jittered rims give the scalloped silhouette the
  // reference paintings have; the vertex paint carries the light.
  const lobes = [
    [0, 0.60, 0, 0.62], [0.42, 0.42, 0.16, 0.46], [-0.40, 0.38, -0.18, 0.44],
    [0.10, 0.32, -0.44, 0.40], [-0.14, 0.36, 0.42, 0.40], [0.32, 0.62, -0.28, 0.34],
    [-0.30, 0.60, 0.26, 0.32], [0.02, 0.86, 0.02, 0.34],
  ];
  const geo = leafyMass({
    lobes, seed, jitter: 0.40,
    dark: P.grassShade, mid: P.grassMid, light: P.grassLight,
    hi: mix(P.grassLight, P.grassSun, 0.55),
  });
  geo.scale(1.0, 1.08, 1.0);
  return geo;
}

// ---------------------------------------------------------------------------
// Pines — stacked needle skirts with a jagged rim
// ---------------------------------------------------------------------------
export function pineGeometry({ layers = 8, seed = 5, height = 2.0, radius = 1.0 } = {}) {
  const p = new Painter();
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = height * (0.10 + t * 0.84);
    const r = radius * (1 - t * 0.80) * (0.86 + hash(seed, i, 1) * 0.28);
    const drop = height * (0.09 + (1 - t) * 0.10);
    // Each layer is a ring of narrow, drooping needle blades with gaps between
    // them — a solid cone reads as a paper cut-out from the fixed camera, but
    // a fringed skirt catches light on some blades and leaves the rest in
    // shadow, which is what a pine looks like in the paintings.
    const blades = 15 + ((i * 5) % 4);
    for (let k = 0; k < blades; k++) {
      const h1 = hash(seed, i, k, 1);
      const a = (k / blades) * Math.PI * 2 + i * 0.47 + h1 * 0.22;
      const halfW = (0.085 + h1 * 0.075) * Math.PI;   // angular width of the blade
      const len = r * (0.78 + hash(seed, i, k, 2) * 0.42);
      const tipY = y - drop * (0.7 + hash(seed, i, k, 3) * 0.9);
      const odd = k % 2 === 0;
      const tipCol = scale3(
        mix(P.pineMid, P.pineLight, odd ? 0.62 : 0.18),
        0.92 + h1 * 0.18,
      );
      const rootCol = mix(P.pineDark, P.pineMid, 0.25);
      const a0 = a - halfW, a1 = a + halfW;
      const inner = 0.015 + r * 0.06;
      const c = [Math.cos(a) * len, tipY, Math.sin(a) * len];
      p.tri(
        [Math.cos(a0) * inner, y + height * 0.03, Math.sin(a0) * inner],
        c,
        [Math.cos(a1) * inner, y + height * 0.03, Math.sin(a1) * inner],
        rootCol, tipCol, rootCol,
      );
      // underside: a darker, shorter blade underneath, offset back
      p.tri(
        [Math.cos(a0) * inner * 2.0, y - drop * 0.55, Math.sin(a0) * inner * 2],
        [Math.cos(a) * len * 0.78, tipY - drop * 0.35, Math.sin(a) * len * 0.78],
        [Math.cos(a1) * inner * 2, y - drop * 0.55, Math.sin(a1) * inner * 2],
        scale3(rootCol, 0.66), scale3(tipCol, 0.52), scale3(rootCol, 0.66),
      );
    }
  }
  return biasNormals(p.build(), 0.40);
}

// ---------------------------------------------------------------------------
// Reeds — the wet fringe along the waterline
// ---------------------------------------------------------------------------
/**
 * A clump of tall blades leaning over the water, some carrying a cattail head.
 * They sway harder than grass (bigger wind amplitude in the batch).
 */
export function reedGeometry(seed = 4, cattails = true) {
  const p = new Painter();
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const r = hash(seed, i, 1);
    const r2 = hash(seed, i, 2);
    addBlade(p, {
      angle: (i / blades) * 2.2 - 1.1 + (r - 0.5) * 0.5,
      lean: 0.10 + r2 * 0.22,
      height: 0.8 + r * 0.55,
      width: 0.030 + r2 * 0.012,
      curve: 0.09,
      cBase: mix(P.grassShade, P.grassDeep, 0.5),
      cMid: mix(P.grassMid, P.grassLight, 0.35),
      cTip: mix(P.grassLight, P.grassSun, 0.55),
      seed: seed * 3.7 + i * 1.3,
    });
  }
  if (cattails) {
    for (let k = 0; k < 2; k++) {
      const a = k * 2.4 + hash(seed, k, 5) * 1.2 - 0.6;
      const h = 1.05 + hash(seed, k, 6) * 0.35;
      const ca = Math.cos(a), sa = Math.sin(a);
      // stem
      addBlade(p, {
        angle: a, lean: 0.04, height: h, width: 0.014, curve: 0.02,
        cBase: P.grassDeep, cMid: P.grassMid, cTip: P.grassMid,
        seed: seed * 5.1 + k * 2.7,
      });
      // head: a little crossed cigar of quads at the top
      const hx = ca * 0.04, hz = sa * 0.04;
      const w = 0.045;
      const head = P.barkDark;
      const headHi = P.bark;
      for (let q = 0; q < 2; q++) {
        const ux = q === 0 ? 1 : 0, uz = q === 0 ? 0 : 1;
        p.quad(
          [hx - ux * w, h - 0.02, hz - uz * w], [hx + ux * w, h - 0.02, hz + uz * w],
          [hx + ux * w * 0.7, h + 0.16, hz + uz * w * 0.7], [hx - ux * w * 0.7, h + 0.16, hz - uz * w * 0.7],
          head, head, headHi, headHi,
        );
      }
    }
  }
  return biasNormals(p.build(), 0.45);
}

// ---------------------------------------------------------------------------
// Flowers
// ---------------------------------------------------------------------------
/**
 * A tiny meadow flower: one bent stem and a ring of petals seen from above.
 *
 * Only a handful of triangles each, but they are the single cheapest way to
 * break a big green field into something you want to walk through — the
 * reference paintings are full of pale specks in the grass.
 */
export function flowerGeometry(seed = 3, opts = {}) {
  const {
    petals = 6,
    petalCol = [0.92, 0.93, 0.84],
    heartCol = [0.86, 0.72, 0.32],
    stemH = 0.26 + (seed % 3) * 0.05,
  } = opts;
  const p = new Painter();
  const lean = (hash(seed, 1) - 0.5) * 0.16;

  // stem: a thin tapered blade so it catches the light like grass
  addBlade(p, {
    angle: hash(seed, 2) * 0.8 - 0.4,
    lean,
    height: stemH,
    width: 0.014,
    curve: lean * 0.5,
    base: [0, 0, 0],
    cBase: scale3(P.grassDeep, 0.9),
    cMid: scale3(P.grassMid, 0.98),
    cTip: scale3(P.grassMid, 1.05),
    seed: seed * 3.1,
  });

  // petals: a shallow disc of triangles around the head
  const head = [lean * 0.7, stemH, 0];
  const r = 0.075 + (seed % 4) * 0.008;
  const yaw = hash(seed, 5) * Math.PI * 2;
  for (let i = 0; i < petals; i++) {
    const a0 = yaw + (i / petals) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / petals * 0.72;
    const am = (a0 + a1) * 0.5;
    const inner = 0.02;
    const tipR = r * (0.82 + hash(seed, i, 7) * 0.4);
    const lift = 0.012;
    const shade = (i % 2 === 0 ? 1.0 : 0.9);
    const c = scale3(petalCol, shade);
    p.tri(
      [head[0] + Math.cos(a0) * inner, head[1], head[2] + Math.sin(a0) * inner],
      [head[0] + Math.cos(am) * tipR, head[1] + lift, head[2] + Math.sin(am) * tipR],
      [head[0] + Math.cos(a1) * inner, head[1], head[2] + Math.sin(a1) * inner],
      c, scale3(c, 1.06), c,
    );
  }
  // heart
  const heartR = r * 0.34;
  for (let i = 0; i < 4; i++) {
    const a0 = yaw + (i / 4) * Math.PI * 2;
    const a1 = a0 + Math.PI / 2;
    p.tri(
      [head[0], head[1] + 0.02, head[2]],
      [head[0] + Math.cos(a0) * heartR, head[1] + 0.016, head[2] + Math.sin(a0) * heartR],
      [head[0] + Math.cos(a1) * heartR, head[1] + 0.016, head[2] + Math.sin(a1) * heartR],
      heartCol, heartCol, heartCol,
    );
  }
  return biasNormals(p.build(), 0.7);
}

/** The three meadow flowers: bone-white, warm yellow, soft violet. */
export const FLOWER_KINDS = [
  { id: 'white', petalCol: [0.90, 0.91, 0.82], heartCol: [0.80, 0.66, 0.28], seed: 3 },
  { id: 'yellow', petalCol: [0.88, 0.80, 0.36], heartCol: [0.62, 0.44, 0.16], seed: 11 },
  { id: 'violet', petalCol: [0.72, 0.64, 0.84], heartCol: [0.82, 0.74, 0.42], seed: 19 },
];

// ---------------------------------------------------------------------------
// Mushrooms
// ---------------------------------------------------------------------------
export function mushroomGeometry(seed = 9) {
  const p = new Painter();
  const stem = new THREE.CylinderGeometry(0.055, 0.07, 0.2, 5, 1, false);
  stem.translate(0, 0.1, 0);
  const sf = stem.index ? stem.toNonIndexed() : stem;
  sf.computeVertexNormals();
  const sc = new Float32Array(sf.getAttribute('position').count * 3);
  for (let i = 0; i < sc.length / 3; i++) {
    sc[i * 3] = 0.86; sc[i * 3 + 1] = 0.82; sc[i * 3 + 2] = 0.7;
  }
  sf.setAttribute('aColor', new THREE.BufferAttribute(sc, 3));
  absorb(p, sf, new THREE.Matrix4());

  const cap = new THREE.SphereGeometry(0.16, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
  cap.translate(0, 0.2, 0);
  const cf = cap.index ? cap.toNonIndexed() : cap;
  cf.computeVertexNormals();
  const cc = new Float32Array(cf.getAttribute('position').count * 3);
  const capCol = mix(P.dirtLight, P.paleStone, 0.55);
  for (let i = 0; i < cc.length / 3; i++) {
    cc[i * 3] = capCol[0]; cc[i * 3 + 1] = capCol[1]; cc[i * 3 + 2] = capCol[2];
  }
  cf.setAttribute('aColor', new THREE.BufferAttribute(cc, 3));
  absorb(p, cf, new THREE.Matrix4());
  return p.build();
}

/**
 * A set of camera-facing leaf cards, in crown-local space.
 *
 * One geometry holds several quads; the vertex shader billboards each of them
 * around the centre and flutters it on its own phase. Layered over the solid
 * lobes they turn a faceted blob into a soft, brushy crown.
 */
export function leafCardSet({ count = 6, radius = 1, seed = 1, size = 0.6 } = {}) {
  const pos = [];
  const uv = [];
  const nor = [];
  const offsets = [];
  const sizes = [];
  const phases = [];

  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = hash(seed, i, 4);
    const r2 = hash(seed, i, 5);
    const r3 = hash(seed, i, 6);
    // shell distribution: keep the cards out of the very centre
    const y = (i / Math.max(1, count - 1)) * 1.5 - 0.75 + (r - 0.5) * 0.25;
    const ring = Math.sqrt(Math.max(0, 1 - y * y)) * (0.62 + r2 * 0.40);
    const a = i * golden + r3 * 0.6;
    const ox = Math.cos(a) * ring * radius;
    const oz = Math.sin(a) * ring * radius;
    const oy = y * radius * 0.85;

    const s = size * (0.72 + r * 0.55);
    const corners = [
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(corners[k][0], corners[k][1], corners[k][2]);
      uv.push(uvs[k][0], uvs[k][1]);
      nor.push(0, 1, 0);
      offsets.push(ox, oy, oz);
      sizes.push(s);
      phases.push(r3 + i * 0.11);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aOffset', new THREE.Float32BufferAttribute(offsets, 3));
  geo.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geo.computeBoundingSphere();
  geo.boundingSphere.radius *= 2;
  return geo;
}
