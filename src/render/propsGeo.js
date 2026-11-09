/**
 * Small geometry factory. Everything is faceted and vertex-coloured so a whole
 * forest of rocks, trunks and canopy masses can share one material and a few
 * instanced draw calls.
 */
import * as THREE from 'three';
import { PALETTE } from '../terrain/terrain.js';

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function paint(geo, fn) {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const c = fn(tmp, nrm ? new THREE.Vector3(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) : new THREE.Vector3(0, 1, 0), i);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function hash(x, y, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1442695041);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const P = PALETTE;

/** Rounded, jittered blob used for canopy masses and bush cores. */
export function blobGeometry({ radius = 1, detail = 1, jitter = 0.16, seed = 1, top, bottom, side }) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = hash(Math.round(v.x * 7 + seed), Math.round(v.y * 7), Math.round(v.z * 7));
    const n2 = hash(Math.round(v.y * 11), Math.round(v.z * 11 + seed), Math.round(v.x * 11));
    v.multiplyScalar(1 + (n - 0.5) * jitter + (n2 - 0.5) * jitter * 0.6);
    v.y *= 0.9;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  paint(flat, (p, n) => {
    const t = Math.max(0, n.y * 0.5 + 0.5);
    let c = mix(bottom, side, Math.min(1, t * 1.3));
    c = mix(c, top, Math.max(0, (t - 0.55) / 0.45));
    const j = 0.94 + hash(Math.round(p.x * 20), Math.round(p.y * 20), Math.round(p.z * 20)) * 0.12;
    return [c[0] * j, c[1] * j, c[2] * j];
  });
  return flat;
}

/** Angular boulder: dark slate sides, sun-bleached top. */
export function rockGeometry(seed = 1) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = hash(Math.round(v.x * 9 + seed * 3), Math.round(v.y * 9), Math.round(v.z * 9));
    v.multiplyScalar(0.82 + n * 0.42);
    if (v.y < 0) v.y *= 0.55;      // bury the base
    v.y += 0.12;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  paint(flat, (p, n) => {
    const up = Math.max(0, n.y);
    let c = mix(P.rockShadow, P.rockMid, Math.min(1, up * 1.4 + 0.12));
    c = mix(c, P.rockLight, Math.max(0, (up - 0.45) / 0.55));
    // stone in this valley is never bare: moss creeps up from the base and
    // pools in the hollows on top, and pale lichen freckles the sunlit faces
    const g1 = hash(Math.round(p.x * 7), Math.round(p.y * 7 + seed), Math.round(p.z * 7));
    const g2 = hash(Math.round(p.x * 21 + seed), Math.round(p.y * 21), Math.round(p.z * 21));
    const moss = clamp01((up - 0.15) * 1.25 + (g1 - 0.5) * 0.9 + 0.18);
    const mossCol = mix3(P.grassShade, P.grassMid, g2 * 0.8 + 0.1);
    c = mix3(c, mossCol, moss * 0.62);
    const lichen = clamp01((g2 - 0.72) * 3.2) * Math.max(0, up);
    c = mix3(c, P.paleStone, lichen * 0.5);
    const j = 0.9 + g2 * 0.16;
    return scale3(c, j);
  });
  return flat;
}

/** A pale sun-bleached cap that sits on top of some boulders. */
export function rockCapGeometry(seed = 1) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = hash(Math.round(v.x * 8 + seed), Math.round(v.y * 8), Math.round(v.z * 8));
    v.multiplyScalar(0.8 + n * 0.3);
    v.y = Math.max(0.12, v.y) * 0.42;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  paint(flat, (p, n) => {
    const up = Math.max(0, n.y);
    const c = mix(P.dirtLight, P.paleStone, Math.min(1, up * 1.2));
    const j = 0.93 + hash(Math.round(p.x * 18), Math.round(p.z * 18), seed) * 0.1;
    return [c[0] * j, c[1] * j, c[2] * j];
  });
  return flat;
}

/**
 * A trunk with a root flare and three branch stubs reaching into the crown —
 * the silhouette cue that turns a green blob on a stick into a tree. Bark is
 * painted in vertical striations; `pale` gives a birch-white trunk with dark
 * dashes. Moss creeps up the north side and wraps the foot.
 */
export function trunkGeometry({ taper = 0.55, moss = 0.4, pale = false } = {}) {
  const parts = [];
  const main = new THREE.CylinderGeometry(0.5 * taper, 0.66, 1, 9, 4, false);
  main.translate(0, 0.5, 0);
  parts.push(main.index ? main.toNonIndexed() : main);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.09 + 0.6;
    const g = new THREE.CylinderGeometry(0.09, 0.17, 0.55, 5, 1, false);
    g.translate(0, 0.275, 0);
    g.rotateZ(0.95);
    g.rotateY(a);
    g.translate(Math.cos(a) * 0.16, 0.60 + i * 0.11, Math.sin(a) * 0.16);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = mergeSimple(parts);
  merged.computeVertexNormals();
  const barkLo = pale ? [0.62, 0.58, 0.50] : P.barkDark;
  const barkHi = pale ? [0.86, 0.83, 0.74] : P.bark;
  const dash = pale ? [0.24, 0.21, 0.17] : P.barkDark;
  return paint(merged, (p, n) => {
    const up = clamp01(p.y);
    let c = mix(barkLo, barkHi, Math.min(1, up * 1.8 + 0.30));
    // vertical striations: bark is never one flat tone
    const ang = Math.atan2(p.z, p.x);
    const stri = hash(Math.round(ang * 15), Math.round(p.y * 26), 3);
    c = mix(c, dash, stri * (pale ? 0.28 : 0.38));
    if (pale) {
      // birch dashes: short dark ticks, denser low down
      const tick = hash(Math.round(ang * 8), Math.round(p.y * 11), 8);
      c = mix(c, dash, Math.pow(tick, 6) * (0.9 - up * 0.4));
    } else {
      const side = hash(Math.round(p.x * 30), Math.round(p.z * 30), 7);
      c = mix(c, P.wood, side * 0.30);
      if (n.x < -0.2) c = mix(c, P.grassShade, moss * 0.55);
    }
    // mossy foot
    c = mix(c, P.grassDeep, clamp01((0.16 - up) / 0.16) * 0.5);
    return c;
  });
}

/** Low-poly cone used as the dark mass inside a pine. */
export function pineCoreGeometry(levels = 4) {
  const geos = [];
  for (let i = 0; i < levels; i++) {
    const t = i / levels;
    const r = 1.0 - t * 0.8;
    const g = new THREE.ConeGeometry(r, 1.0, 7, 1, true);
    // jitter each shell so the silhouette never reads as a clean cone
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const jx = hash(Math.round(pos.getX(k) * 13 + i * 7), Math.round(pos.getZ(k) * 13), i) - 0.5;
      const jz = hash(Math.round(pos.getZ(k) * 13), Math.round(pos.getX(k) * 11 + i), i + 3) - 0.5;
      pos.setX(k, pos.getX(k) * (1 + jx * 0.34));
      pos.setZ(k, pos.getZ(k) * (1 + jz * 0.34));
      pos.setY(k, pos.getY(k) * (0.86 + jx * 0.24));
    }
    g.rotateY(i * 1.13);
    g.translate(0, 0.42 + t * 1.62, 0);
    geos.push(g.toNonIndexed());
  }
  const merged = mergeSimple(geos);
  merged.computeVertexNormals();
  return paint(merged, (p, n) => {
    const t = Math.max(0, Math.min(1, p.y / 2.2));
    let c = mix(P.pineDark, P.pineMid, t * 0.7);
    if (n.y > 0.2) c = mix(c, P.pineLight, 0.3);
    const j = 0.9 + hash(Math.round(p.x * 20), Math.round(p.y * 20), Math.round(p.z * 20)) * 0.18;
    return [c[0] * j, c[1] * j, c[2] * j];
  });
}

export function logGeometry() {
  const geo = new THREE.CylinderGeometry(0.26, 0.3, 1, 8, 1, false);
  geo.rotateZ(Math.PI / 2);
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  return paint(flat, (p, n) => {
    if (Math.abs(n.x) > 0.75) {
      // cut ends
      const r = Math.hypot(p.y, p.z);
      return mix(P.woodLight, P.dirtLight, Math.min(1, r * 1.6));
    }
    const stripe = hash(Math.round(p.x * 12), Math.round(p.y * 40), Math.round(p.z * 40));
    return mix(P.barkDark, P.bark, 0.35 + stripe * 0.65);
  });
}

export function stumpGeometry() {
  const geo = new THREE.CylinderGeometry(0.42, 0.5, 1, 8, 1, false);
  geo.translate(0, 0.5, 0);
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  return paint(flat, (p, n) => {
    if (n.y > 0.7) return mix(P.woodLight, P.dirtLight, 0.35);
    const stripe = hash(Math.round(p.x * 18), Math.round(p.y * 30), Math.round(p.z * 18));
    return mix(P.barkDark, P.bark, 0.3 + stripe * 0.6);
  });
}

/** Tiny helper: merge non-indexed geometries that share attribute layout. */
export function mergeSimple(geos) {
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i);
      pos[(o + i) * 3 + 1] = p.getY(i);
      pos[(o + i) * 3 + 2] = p.getZ(i);
      nor[(o + i) * 3] = n.getX(i);
      nor[(o + i) * 3 + 1] = n.getY(i);
      nor[(o + i) * 3 + 2] = n.getZ(i);
      if (u) {
        uv[(o + i) * 2] = u.getX(i);
        uv[(o + i) * 2 + 1] = u.getY(i);
      }
    }
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/**
 * Helper for boxy building parts: builds a box, optionally paints it with a
 * colour function, and returns a non-indexed geometry ready to merge.
 */
export function part(geo, colorFn) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  if (colorFn) return paint(flat, colorFn);
  return flat;
}

export function paintSolid(geo, color) {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  flat.computeVertexNormals();
  return paint(flat, () => color);
}
