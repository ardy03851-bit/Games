/**
 * Painted textures, generated at runtime.
 *
 * The reference art is unmistakably brushed: leaf masses are dozens of
 * overlapping dabs with a ragged, slightly soft silhouette, and nothing is a
 * perfect circle. Low-poly blobs can never look like that, so the trees and
 * bushes wear "leaf cards" — instanced quads carrying these textures — layered
 * over their solid cores.
 *
 * The textures are synthesised in plain JavaScript rather than drawn on a
 * canvas so the same code produces identical results in the software preview
 * renderer, which is how the art gets reviewed without a browser.
 */
import * as THREE from 'three';
import { PALETTE } from '../terrain/terrain.js';

const P = PALETTE;

/* ------------------------------------------------------------------ noise */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------- leaf mass painter */
/**
 * Paint a clump of leaves into an RGBA buffer.
 *
 * @param {object} o
 * @param {number} o.size        texture edge in pixels
 * @param {number} o.seed        deterministic seed
 * @param {number[]} o.dark      deepest tone
 * @param {number[]} o.mid
 * @param {number[]} o.light
 * @param {number[]} o.highlight brightest tone, used for sun-facing dabs
 * @param {number} o.dabs        how many leaves to stamp
 * @param {number} o.spread      cluster radius as a fraction of the texture
 */
export function paintLeafMass(o) {
  const size = o.size ?? 192;
  const rnd = mulberry(o.seed ?? 1);
  const buffer = new Float32Array(size * size * 4); // rgb + alpha
  const depth = new Float32Array(size * size);      // how "inside" a pixel is

  const cx = size * 0.5;
  const cy = size * 0.5;
  const spread = (o.spread ?? 0.34) * size;

  // a handful of sub-clumps so the mass is lumpy, not a disc
  const lobes = [];
  const lobeCount = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < lobeCount; i++) {
    const a = rnd() * Math.PI * 2;
    const r = spread * (0.35 + rnd() * 0.5);
    lobes.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r * 0.92,
      r: spread * (0.4 + rnd() * 0.4),
    });
  }

  const rgb = (c) => [c[0] * 255, c[1] * 255, c[2] * 255];

  const stamp = (x, y, rx, ry, ang, col, alpha) => {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const rr = Math.max(rx, ry);
    const x0 = Math.max(0, Math.floor(x - rr)), x1 = Math.min(size - 1, Math.ceil(x + rr));
    const y0 = Math.max(0, Math.floor(y - rr)), y1 = Math.min(size - 1, Math.ceil(y + rr));
    const c = rgb(col);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - x, dy = py - y;
        const u = (dx * cos + dy * sin) / rx;
        const v = (-dx * sin + dy * cos) / ry;
        const d = u * u + v * v;
        if (d > 1) continue;
        const edge = clamp01((1 - d) * 3.2);
        const i = (py * size + px) * 4;
        const w = edge * alpha;
        if (buffer[i + 3] + w < 0.001) continue;
        const inv = 1 / Math.max(0.0001, buffer[i + 3] + w);
        buffer[i] = (buffer[i] * buffer[i + 3] + c[0] * w) * inv;
        buffer[i + 1] = (buffer[i + 1] * buffer[i + 3] + c[1] * w) * inv;
        buffer[i + 2] = (buffer[i + 2] * buffer[i + 3] + c[2] * w) * inv;
        buffer[i + 3] = buffer[i + 3] + w;
        depth[py * size + px] = Math.max(depth[py * size + px], clamp01(1 - d));
      }
    }
  };

  // 1. dark underpainting: the shape of the mass
  for (const lobe of lobes) {
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * lobe.r;
      const x = lobe.x + Math.cos(a) * r;
      const y = lobe.y + Math.sin(a) * r;
      stamp(x, y, lobe.r * 0.34, lobe.r * 0.30, rnd() * Math.PI, o.dark, 0.85);
    }
  }

  // 2. mid dabs: the body of the leaves
  const dabs = o.dabs ?? 260;
  for (let i = 0; i < dabs; i++) {
    const lobe = lobes[(rnd() * lobes.length) | 0];
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.65) * lobe.r * 1.15;
    const x = lobe.x + Math.cos(a) * r;
    const y = lobe.y + Math.sin(a) * r * 0.95;
    const tone = rnd();
    const col = tone < 0.42 ? o.mid : tone < 0.8 ? mix3(o.mid, o.light, 0.7) : o.light;
    const s = size * (0.012 + rnd() * 0.016);
    stamp(x, y, s, s * (0.62 + rnd() * 0.4), rnd() * Math.PI, col, 0.95);
  }

  // 3. sun-facing highlights on the upper-left of every lobe
  for (let i = 0; i < dabs * 0.7; i++) {
    const lobe = lobes[(rnd() * lobes.length) | 0];
    const a = -2.2 + rnd() * 1.9;
    const r = Math.pow(rnd(), 0.5) * lobe.r * 0.85;
    const x = lobe.x + Math.cos(a) * r;
    const y = lobe.y + Math.sin(a) * r;
    const s = size * (0.009 + rnd() * 0.012);
    stamp(x, y, s, s * 0.7, rnd() * Math.PI, o.highlight, 0.8);
  }

  // 4. scalloped silhouette: knock out pixels near the rim with noise so the
  //    edge reads as separate leaves rather than a smooth blob
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let a = clamp01(buffer[i + 3]);
      if (a <= 0.02) continue;
      const d = depth[y * size + x];
      const n = Math.sin(x * 3.1 + y * 1.7) * 0.5 + 0.5;
      const rim = clamp01((a - 0.20) / 0.55);
      const cut = rim < 0.5 ? (n > rim * 1.35 ? 0.15 : 1) : 1;
      a *= 0.45 + 0.55 * d;
      a *= cut;
      if (a <= 0.02) continue;
      out[i] = Math.min(255, buffer[i]);
      out[i + 1] = Math.min(255, buffer[i + 1]);
      out[i + 2] = Math.min(255, buffer[i + 2]);
      out[i + 3] = Math.min(255, a * 255);
    }
  }

  return { size, data: out };
}

/* ------------------------------------------------------- ground paint tile */
/**
 * A seamless tile of painterly ground: overlapping soft dabs, short blade
 * strokes and grit. It is stored around mid-grey so the terrain shader can use
 * it as a *modulation* — multiply by (sample * 2 - 1) — which keeps the vertex
 * palette in charge of hue while the texture supplies the brushwork.
 *
 * Everything wraps, so the tile repeats without a seam.
 */
export function paintGroundTile(size = 256, seed = 501) {
  const rnd = mulberry(seed);
  const buf = new Float32Array(size * size * 3).fill(0.5);

  const wrapStamp = (x, y, rx, ry, ang, delta, alpha) => {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const rr = Math.max(rx, ry) + 1;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bx = x + ox * size, by = y + oy * size;
        if (bx + rr < 0 || bx - rr > size || by + rr < 0 || by - rr > size) continue;
        const x0 = Math.max(0, Math.floor(bx - rr)), x1 = Math.min(size - 1, Math.ceil(bx + rr));
        const y0 = Math.max(0, Math.floor(by - rr)), y1 = Math.min(size - 1, Math.ceil(by + rr));
        for (let py = y0; py <= y1; py++) {
          const dy = py - by;
          for (let px = x0; px <= x1; px++) {
            const dx = px - bx;
            const u = (dx * cos + dy * sin) / rx;
            const v = (-dx * sin + dy * cos) / ry;
            const d = u * u + v * v;
            if (d > 1) continue;
            const fall = (1 - d) * (1 - d);
            const i = (py * size + px) * 3;
            const k = alpha * fall;
            buf[i] += delta[0] * k;
            buf[i + 1] += delta[1] * k;
            buf[i + 2] += delta[2] * k;
          }
        }
      }
    }
  };

  // --- broad soft dabs: the base brushwork
  for (let i = 0; i < 520; i++) {
    const light = rnd() < 0.5;
    const amt = (light ? 1 : -1) * (0.05 + rnd() * 0.13);
    const delta = [
      amt * (light ? 1.0 : 0.9),
      amt * (light ? 1.02 : 1.0),
      amt * (light ? 0.72 : 1.18),
    ];
    wrapStamp(
      rnd() * size, rnd() * size,
      4 + rnd() * 16, 2 + rnd() * 7,
      rnd() * Math.PI,
      delta, 0.55,
    );
  }

  // --- blade strokes: short bright flicks, the thing that reads as grass from
  // a distance
  for (let i = 0; i < 1500; i++) {
    const light = rnd() < 0.62;
    const amt = (light ? 1 : -1) * (0.10 + rnd() * 0.22);
    wrapStamp(
      rnd() * size, rnd() * size,
      1.1 + rnd() * 2.2, 3 + rnd() * 8,
      rnd() * Math.PI,
      [amt, amt * 1.04, amt * 0.6],
      0.85,
    );
  }

  // --- dry flecks: tiny warm specks that break the green
  for (let i = 0; i < 420; i++) {
    const amt = 0.10 + rnd() * 0.18;
    wrapStamp(
      rnd() * size, rnd() * size,
      0.9 + rnd() * 1.6, 0.9 + rnd() * 1.6,
      0, [amt * 1.3, amt * 1.0, amt * 0.2], 0.9,
    );
  }

  // --- grit / paper tooth
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const o = (y * size + x) * 4;
      const n = (rnd() - 0.5) * 0.05;
      out[o] = Math.max(0, Math.min(255, (buf[i] + n) * 255));
      out[o + 1] = Math.max(0, Math.min(255, (buf[i + 1] + n) * 255));
      out[o + 2] = Math.max(0, Math.min(255, (buf[i + 2] + n) * 255));
      out[o + 3] = 255;
    }
  }
  return { size, data: out };
}

export function groundTexture() {
  if (cache.has('ground')) return cache.get('ground');
  const raw = paintGroundTile();
  const tex = new THREE.DataTexture(raw.data, raw.size, raw.size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  tex.userData.cpu = raw;
  cache.set('ground', tex);
  return tex;
}

/* ------------------------------------------------------------- the library */
const cache = new Map();

const LEAF_RECIPES = {
  canopyA: {
    seed: 11, size: 192, spread: 0.33, dabs: 340,
    dark: P.grassDeep, mid: P.grassMid, light: P.grassLight,
    highlight: mix3(P.grassLight, P.grassSun, 0.6),
  },
  canopyB: {
    seed: 27, size: 192, spread: 0.35, dabs: 320,
    dark: P.grassDeep, mid: mix3(P.grassDeep, P.grassMid, 0.6), light: P.grassLight,
    highlight: mix3(P.grassLight, P.grassSun, 0.4),
  },
  canopyC: {
    seed: 43, size: 192, spread: 0.31, dabs: 340,
    dark: P.pineDark, mid: P.pineMid, light: P.pineLight,
    highlight: mix3(P.pineLight, P.grassSun, 0.45),
  },
  birch: {
    seed: 91, size: 192, spread: 0.34, dabs: 330,
    dark: [0.300, 0.380, 0.160], mid: [0.460, 0.550, 0.230],
    light: [0.600, 0.680, 0.300], highlight: [0.740, 0.800, 0.420],
  },
  bush: {
    seed: 61, size: 160, spread: 0.36, dabs: 300,
    dark: P.grassDeep, mid: P.grassMid, light: P.grassLight,
    highlight: mix3(P.grassLight, P.grassSun, 0.4),
  },
  fern: {
    seed: 77, size: 160, spread: 0.34, dabs: 220,
    dark: P.grassShade, mid: P.grassDeep, light: P.grassMid, highlight: P.grassLight,
  },
};

export function leafTexture(name = 'canopyA') {
  if (cache.has(name)) return cache.get(name);
  const recipe = LEAF_RECIPES[name] || LEAF_RECIPES.canopyA;
  const raw = paintLeafMass(recipe);
  const tex = new THREE.DataTexture(raw.data, raw.size, raw.size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData.cpu = raw;      // the preview renderer samples this directly
  cache.set(name, tex);
  return tex;
}

export function leafTextureNames() {
  return Object.keys(LEAF_RECIPES);
}

/** Nearest-neighbour-ish bilinear sample of a CPU texture, for tools. */
export function sampleTexture(tex, u, v) {
  const cpu = tex?.userData?.cpu;
  if (!cpu) return [0, 0, 0, 0];
  const { size, data } = cpu;
  const x = Math.max(0, Math.min(size - 1, u * (size - 1)));
  const y = Math.max(0, Math.min(size - 1, v * (size - 1)));
  const i = ((y | 0) * size + (x | 0)) * 4;
  return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255];
}
