/**
 * MOSSWOOD — procedural terrain
 * -----------------------------
 * The generator is a chain of processes, each leaving an intentional-looking
 * mark, so the valley reads like it was painted and sculpted by hand:
 *
 *   1. river spine ................ a path, and the valley it lives in
 *   2. valley shaping ............. ground rises away from the water
 *   3. domain-warped fBm .......... organic land masses, no visible noise grid
 *   4. hydraulic erosion .......... gravity gullies + sediment fans
 *   5. stratified terracing ....... hand-stacked ledges, sharp risers
 *   6. river carving .............. scoured banks, plunge pools at each fall
 *   7. footpath carving ........... a worn trail choosing the easy route
 *   8. hand-flattened home plot ... a buildable shelf, softened edges
 *   9. horizon AO + painted bands . shadow pockets and flat gouache colour
 *
 * The palette values are sampled directly from the reference paintings.
 * Everything is driven by one integer seed.
 */

import { Noise2D, mulberry32, clamp, lerp, smoothstep, smootherstep } from './noise.js';

export const WORLD = {
  size: 128,
  grid: 257,
  seed: 20261105,
};

const HALF = WORLD.size / 2;
const CELL = WORLD.size / (WORLD.grid - 1);

// ---------------------------------------------------------------------------
// Palette — sampled from the reference paintings (display-space sRGB)
// ---------------------------------------------------------------------------
export const PALETTE = {
  grassSun: [0.624, 0.686, 0.455],   // #9faf74
  grassLight: [0.557, 0.631, 0.380], // #8ea161
  grassMid: [0.455, 0.506, 0.325],   // #748153
  grassDeep: [0.353, 0.455, 0.286],  // #5a7449
  grassShade: [0.239, 0.298, 0.212], // #3d4c36
  grassDark: [0.157, 0.216, 0.157],  // #283728

  dirtLight: [0.635, 0.553, 0.427],  // #a28d6d
  dirtMid: [0.545, 0.469, 0.361],    // #8b785c
  dirtDark: [0.404, 0.341, 0.267],   // #675744
  dirtShadow: [0.278, 0.216, 0.165], // #473729

  rockLight: [0.361, 0.396, 0.463],  // #5c6576
  rockMid: [0.243, 0.267, 0.333],    // #3e4455
  rockDark: [0.161, 0.176, 0.231],   // #292d3b
  rockShadow: [0.086, 0.098, 0.129], // #161921
  stoneWarm: [0.396, 0.365, 0.333],

  paleStone: [0.847, 0.733, 0.518],  // #d8bb84 sun-bleached tops

  waterShallow: [0.478, 0.588, 0.545], // #7a968b
  waterMid: [0.318, 0.435, 0.427],     // #516f6d
  waterDeep: [0.157, 0.267, 0.302],    // #28444d
  waterFoam: [0.933, 0.945, 0.871],    // #eef1de

  wood: [0.545, 0.408, 0.259],
  woodLight: [0.729, 0.588, 0.396],
  woodDark: [0.337, 0.235, 0.157],
  bark: [0.353, 0.243, 0.161],
  barkDark: [0.192, 0.133, 0.098],

  pineDark: [0.106, 0.149, 0.145],
  pineMid: [0.157, 0.220, 0.169],
  pineLight: [0.259, 0.361, 0.239],

  sun: [1.0, 0.937, 0.784],
  fog: [0.784, 0.741, 0.588],
  fogWarm: [0.859, 0.769, 0.545],
  sky: [0.478, 0.545, 0.518],
  window: [1.0, 0.784, 0.396],
  firefly: [1.0, 0.902, 0.494],
};

// ---------------------------------------------------------------------------
// River definition — steps down the valley in tiers, each step a waterfall
// ---------------------------------------------------------------------------
const RIVER = {
  zStart: -HALF * 0.96,
  zEnd: HALF * 0.96,
  tiers: [
    { t0: -0.02, t1: 0.31, y: 12.4 },
    { t0: 0.31, t1: 0.56, y: 9.2 },
    { t0: 0.56, t1: 0.79, y: 5.9 },
    { t0: 0.79, t1: 1.02, y: 2.2 },
  ],
};

function tierAt(t) {
  const T = RIVER.tiers;
  for (let i = 0; i < T.length; i++) if (t <= T[i].t1) return { tier: T[i], index: i };
  return { tier: T[T.length - 1], index: T.length - 1 };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
export function generateWorld(seed = WORLD.seed) {
  const N = WORLD.grid;
  const n = N * N;
  const rng = mulberry32(seed);
  const noiseA = new Noise2D(seed ^ 0x1234);
  const noiseB = new Noise2D(seed ^ 0x89ab);
  const noiseC = new Noise2D(seed ^ 0xfedc);
  const noiseD = new Noise2D(seed ^ 0x0f0f);

  const height = new Float32Array(n);
  const pathMask = new Float32Array(n);
  const riverMask = new Float32Array(n);
  const flatMask = new Float32Array(n);
  const riverDist = new Float32Array(n);
  const riverY = new Float32Array(n);

  const idx = (x, z) => z * N + x;
  const worldX = (x) => -HALF + x * CELL;
  const worldZ = (z) => -HALF + z * CELL;

  // -------------------------------------------------------------------------
  // 1. The river spine
  // -------------------------------------------------------------------------
  const STEPS = 480;
  const river = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const z = lerp(RIVER.zStart, RIVER.zEnd, t);
    const x = -3.0
      + Math.sin(t * 4.4 + 0.55) * 13.0
      + noiseA.noise1(t * 2.05 + 3.1) * 12.0
      + noiseB.noise1(t * 5.7 + 9.2) * 3.6;
    const { tier, index } = tierAt(t);
    const span = Math.max(0.001, tier.t1 - tier.t0);
    const y = tier.y - 0.5 * clamp01((t - tier.t0) / span) - 0.35 * clamp01(1 - (tier.t0 - t) / span);
    const width = 1.95 + (noiseC.noise1(t * 6.1 + 21.0) * 0.5 + 0.5) * 1.25
      + (noiseB.noise1(t * 12.0 + 3.0) * 0.5 + 0.5) * 0.55;
    river.push({ t, x, z, y, width, tier: index });
  }
  const sampleAtT = (t) => river[Math.round(clamp01(t) * STEPS)];

  // z -> nearest river sample (river is z-monotonic)
  const nearestRiver = (wx, wz) => {
    const t0 = (wz - RIVER.zStart) / (RIVER.zEnd - RIVER.zStart);
    let bestD = 1e9, best = null;
    for (let k = -44; k <= 44; k += 4) {
      const t = clamp01(t0 + k * 0.00078);
      const s = sampleAtT(t);
      const d = Math.hypot(s.x - wx, s.z - wz);
      if (d < bestD) { bestD = d; best = s; }
    }
    // refine
    if (best) {
      const t1 = best.t;
      for (let k = -4; k <= 4; k++) {
        const t = clamp01(t1 + k * 0.000195);
        const s = sampleAtT(t);
        const d = Math.hypot(s.x - wx, s.z - wz);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    return { dist: bestD, sample: best };
  };

  // river distance + local water level (the valley is shaped around these)
  for (let z = 0; z < N; z++) {
    const wz = worldZ(z);
    for (let x = 0; x < N; x++) {
      const { dist, sample } = nearestRiver(worldX(x), wz);
      riverDist[idx(x, z)] = dist;
      riverY[idx(x, z)] = sample ? sample.y : 6;
    }
  }

  // -------------------------------------------------------------------------
  // 2 + 3. Valley shaping + warped fBm
  // -------------------------------------------------------------------------
  for (let z = 0; z < N; z++) {
    const wz = worldZ(z);
    for (let x = 0; x < N; x++) {
      const wx = worldX(x);
      const i = idx(x, z);
      const rd = riverDist[i];

      // the whole valley is built relative to the local water surface, so the
      // land steps down with the river instead of floating above it
      const ry = riverY[i];
      const valley = Math.pow(clamp01(rd / 34), 0.9) * 16.5;
      const gorge = smoothstep(15.0, 2.0, rd) * 4.2;

      // domain warp keeps the fBm from looking like fBm
      const warpX = noiseA.fbm(wx * 0.024, wz * 0.024, 3) * 11.0;
      const warpZ = noiseB.fbm(wx * 0.024 + 31.7, wz * 0.024 - 12.3, 3) * 11.0;
      const px = wx + warpX, pz = wz + warpZ;
      const base = noiseA.fbm(px * 0.014, pz * 0.014, 5, 2.03, 0.52);
      const hills = noiseB.ridged(px * 0.021 + 4.1, pz * 0.021 - 7.7, 4);
      const detail = noiseC.fbm(px * 0.085, pz * 0.085, 3);

      let h = ry - 1.1 + valley - gorge + base * 3.4 + hills * hills * 4.6 + detail * 0.8;

      // hills frame the play field so the camera never sees the world edge
      const edge = Math.max(Math.abs(wx), Math.abs(wz)) / HALF;
      h += smootherstep(0.66, 1.0, edge) * 14.0;
      h += smootherstep(0.88, 1.04, edge) * 16.0;

      height[i] = h;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Hydraulic erosion
  // -------------------------------------------------------------------------
  erode(height, N, rng, {
    droplets: Math.round(22000 * (N / 257)),
    steps: 26,
    radius: 2,
    inertia: 0.05,
    capacity: 3.2,
    minSlope: 0.012,
    deposit: 0.26,
    erodeSpeed: 0.34,
    gravity: 4.0,
    evaporation: 0.02,
  });

  // -------------------------------------------------------------------------
  // 5. Stratified terracing — wide plateaus separated by sharp cliff risers
  // -------------------------------------------------------------------------
  // Quantising the raw height would ridge every cell; quantising a *blurred*
  // height and adding the residual detail back gives broad hand-flattened
  // treads with crisp, deliberate risers — exactly the reference ledges.
  const blurred = blurField(blurField(height, N, 6), N, 4);
  for (let z = 0; z < N; z++) {
    const wz = worldZ(z);
    for (let x = 0; x < N; x++) {
      const wx = worldX(x);
      const i = idx(x, z);
      const rd = riverDist[i];
      const h = height[i];
      const hs = blurred[i];

      // slope of the broad landform — ledges belong on hillsides, not flats
      const gx = blurred[idx(Math.min(N - 1, x + 2), z)] - blurred[idx(Math.max(0, x - 2), z)];
      const gz = blurred[idx(x, Math.min(N - 1, z + 2))] - blurred[idx(x, Math.max(0, z - 2))];
      const g = Math.hypot(gx, gz) / (4 * CELL);

      // band thickness breathes across the map so ledges never repeat
      const band = 3.0
        + (noiseC.noise(wx * 0.019, wz * 0.019) * 0.5 + 0.5) * 1.5
        + (noiseA.noise(wx * 0.0068 + 7.0, wz * 0.0068) * 0.5 + 0.5) * 1.0;

      const warp = noiseB.fbm(wx * 0.026 + 9.0, wz * 0.026 - 3.0, 3) * 1.9
        + noiseD.noise(wx * 0.09, wz * 0.09) * 0.5;
      const q = hs + warp;

      const t = q / band;
      const f = t - Math.floor(t);
      const stepped = (Math.floor(t) + smoothstep(0.34, 0.58, f)) * band;
      const residual = (h - hs) * (0.55 + 0.3 * (noiseB.noise(wx * 0.12, wz * 0.12) * 0.5 + 0.5));

      // only on genuine hillsides, and only in patches
      const onSlope = smoothstep(0.1, 0.3, g) * (1.0 - smoothstep(0.75, 1.5, g));
      const region = clamp01(noiseD.fbm(wx * 0.015 - 6.0, wz * 0.015 + 4.0, 3) * 0.5 + 0.85);
      const nearWater = smoothstep(2.2, 9.0, rd);
      const strength = clamp01(onSlope * region * (0.45 + nearWater * 0.55) * 0.95);
      height[i] = lerp(h, stepped + residual, strength);
    }
  }

  // A second, lighter erosion pass weathers the fresh ledges: talus slopes,
  // gullies cutting through the terraces, sediment fans at their feet.
  erode(height, N, rng, {
    droplets: Math.round(5000 * (N / 257)),
    steps: 16,
    radius: 2,
    inertia: 0.06,
    capacity: 2.2,
    minSlope: 0.02,
    deposit: 0.5,
    erodeSpeed: 0.09,
    gravity: 3.2,
    evaporation: 0.035,
  });

  // -------------------------------------------------------------------------
  // 6. Carve the river
  // -------------------------------------------------------------------------
  for (let i = 0; i < n; i++) {
    const x = i % N, z = (i / N) | 0;
    const wx = worldX(x), wz = worldZ(z);
    const { dist, sample } = nearestRiver(wx, wz);
    if (!sample) continue;
    if (dist > sample.width + 9) { riverDist[i] = dist; continue; }
    riverDist[i] = dist;
    const halfW = sample.width;
    const bank = smoothstep(halfW + 2.9, halfW * 0.3, dist);
    const bed = sample.y - 1.45;
    const carve = Math.pow(bank, 1.35);
    let h = height[i];
    h = lerp(h, bed, carve);
    const scour = smoothstep(halfW + 2.2, halfW + 0.1, dist) * (1 - bank);
    h -= scour * 0.55;
    height[i] = h;
    riverMask[i] = Math.max(riverMask[i], smoothstep(halfW + 2.6, halfW * 0.15, dist));
  }

  // -------------------------------------------------------------------------
  // Home plot: on the third tier shelf, a comfortable walk from the water
  // -------------------------------------------------------------------------
  const plotT = 0.66;
  const plotAnchor = sampleAtT(plotT);
  const plot = { x: plotAnchor.x + 13.5, z: plotAnchor.z + 2.0, r: 8.6, y: 0 };
  {
    const gx = clamp(Math.round((plot.x + HALF) / CELL), 0, N - 1);
    const gz = clamp(Math.round((plot.z + HALF) / CELL), 0, N - 1);
    plot.y = height[idx(gx, gz)];
  }

  // -------------------------------------------------------------------------
  // 7. Footpath
  // -------------------------------------------------------------------------
  const pathPts = [];
  const segments = 52;
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const bulge = Math.sin(u * Math.PI);
    const x = lerp(plot.x - 23.0, plot.x + 2.0, u) + Math.sin(u * 5.1) * 3.4 + noiseA.noise1(u * 4.4 + 40) * 5.5 * bulge;
    const z = lerp(plot.z + 21.0, plot.z - 2.5, u) + Math.cos(u * 4.3) * 2.6 + noiseB.noise1(u * 3.2 + 12) * 4.2 * bulge;
    pathPts.push({ x, z });
  }
  // branch trail to the river crossing
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    pathPts.push({
      x: lerp(plot.x - 4.5, plotAnchor.x + 1.2, u) + Math.sin(u * 3.4) * 1.5,
      z: lerp(plot.z + 1.2, plotAnchor.z - 4.0, u) + Math.cos(u * 3.1) * 1.4,
    });
  }

  const applyPath = (pts, widthScale) => {
    for (let p = 0; p < pts.length - 1; p++) {
      const a = pts[p], b = pts[p + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const steps = Math.max(1, Math.ceil(len / 0.35));
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const px = a.x + dx * u;
        const pz = a.z + dz * u;
        const gx0 = Math.max(0, Math.floor((px + HALF) / CELL - 5));
        const gx1 = Math.min(N - 1, Math.ceil((px + HALF) / CELL + 5));
        const gz0 = Math.max(0, Math.floor((pz + HALF) / CELL - 5));
        const gz1 = Math.min(N - 1, Math.ceil((pz + HALF) / CELL + 5));
        const w = (2.35 + noiseD.noise(px * 0.3, pz * 0.3) * 0.9) * widthScale;
        for (let gz = gz0; gz <= gz1; gz++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = worldX(gx), wz = worldZ(gz);
            const d = Math.hypot(wx - px, wz - pz);
            const edge = 1.0 + noiseC.noise(wx * 0.95, wz * 0.95) * 0.42;
            const m = smoothstep(w * edge, w * 0.5 * edge, d);
            if (m > 0.001) {
              const i = idx(gx, gz);
              pathMask[i] = Math.max(pathMask[i], m);
            }
          }
        }
      }
    }
  };
  applyPath(pathPts, 1.0);

  // worn ground is smoothed and slightly sunken
  {
    const smoothH = new Float32Array(n);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        let sum = 0, wsum = 0;
        for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
          const gx = clamp(x + ox, 0, N - 1), gz = clamp(z + oz, 0, N - 1);
          const w = ox === 0 && oz === 0 ? 3 : 1;
          sum += height[gz * N + gx] * w;
          wsum += w;
        }
        smoothH[z * N + x] = sum / wsum;
      }
    }
    for (let i = 0; i < n; i++) {
      const m = pathMask[i];
      if (m > 0.001) height[i] = lerp(height[i], smoothH[i] - 0.2, m * 0.85);
    }
  }

  // -------------------------------------------------------------------------
  // 8. The home clearing
  // -------------------------------------------------------------------------
  {
    let sum = 0, count = 0;
    for (let z = 0; z < N; z++) {
      const wz = worldZ(z);
      if (Math.abs(wz - plot.z) > plot.r) continue;
      for (let x = 0; x < N; x++) {
        const wx = worldX(x);
        if (Math.hypot(wx - plot.x, wz - plot.z) > plot.r * 0.8) continue;
        sum += height[idx(x, z)];
        count++;
      }
    }
    plot.y = count ? sum / count : plot.y;

    for (let z = 0; z < N; z++) {
      const wz = worldZ(z);
      for (let x = 0; x < N; x++) {
        const wx = worldX(x);
        const d = Math.hypot(wx - plot.x, wz - plot.z);
        const m = smoothstep(plot.r + 5.0, plot.r * 0.55, d);
        if (m <= 0.001) continue;
        const i = idx(x, z);
        const micro = noiseC.fbm(wx * 0.38, wz * 0.38, 2) * 0.11;
        height[i] = lerp(height[i], plot.y + micro, m * 0.96);
        flatMask[i] = Math.max(flatMask[i], m);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sample helpers
  // -------------------------------------------------------------------------
  const heightAt = (wx, wz) => {
    const fx = (wx + HALF) / CELL;
    const fz = (wz + HALF) / CELL;
    const x0 = clamp(Math.floor(fx), 0, N - 1);
    const z0 = clamp(Math.floor(fz), 0, N - 1);
    const x1 = Math.min(N - 1, x0 + 1);
    const z1 = Math.min(N - 1, z0 + 1);
    const tx = clamp(fx - x0, 0, 1);
    const tz = clamp(fz - z0, 0, 1);
    const h00 = height[x0 + z0 * N], h10 = height[x1 + z0 * N];
    const h01 = height[x0 + z1 * N], h11 = height[x1 + z1 * N];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  };

  const fieldAt = (field, wx, wz) => {
    const fx = clamp((wx + HALF) / CELL, 0, N - 1.001);
    const fz = clamp((wz + HALF) / CELL, 0, N - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(N - 1, x0 + 1), z1 = Math.min(N - 1, z0 + 1);
    const tx = fx - x0, tz = fz - z0;
    return lerp(lerp(field[x0 + z0 * N], field[x1 + z0 * N], tx),
      lerp(field[x0 + z1 * N], field[x1 + z1 * N], tx), tz);
  };

  const slopeAt = (wx, wz) => {
    const d = CELL * 1.15;
    const hx = heightAt(wx + d, wz) - heightAt(wx - d, wz);
    const hz = heightAt(wx, wz + d) - heightAt(wx, wz - d);
    return 1 - (2 * d) / Math.hypot(hx, 2 * d, hz);
  };

  // -------------------------------------------------------------------------
  // 9a. Horizon AO
  // -------------------------------------------------------------------------
  const ao = new Float32Array(n);
  const DIRS = 6;
  for (let z = 0; z < N; z++) {
    const wz = worldZ(z);
    for (let x = 0; x < N; x++) {
      const wx = worldX(x);
      const i = idx(x, z);
      const h0 = height[i];
      let occ = 0;
      for (let d = 0; d < DIRS; d++) {
        const ang = (d / DIRS) * Math.PI * 2 + 0.37;
        const cx = Math.cos(ang), sz = Math.sin(ang);
        let maxRise = 0;
        let dist = 0.8;
        for (let s = 0; s < 7; s++) {
          const hh = heightAt(wx + cx * dist, wz + sz * dist);
          const rise = (hh - h0) / dist;
          if (rise > maxRise) maxRise = rise;
          dist *= 1.62;
        }
        occ += clamp01(maxRise * 0.95);
      }
      ao[i] = clamp(1.0 - (occ / DIRS) * 0.72, 0.2, 1.0);
    }
  }

  // Baked sun shadows: long painted cast shadows from ridges and cliff walls.
  // The light sits high and to the north-west, so shadows fall to the south-east.
  {
    const SUN = { x: -0.66, y: 0.86, z: -0.42 };
    const lenXZ = Math.hypot(SUN.x, SUN.z);
    const sx = SUN.x / lenXZ, sz = SUN.z / lenXZ;
    const tanElev = SUN.y / lenXZ;
    for (let z = 0; z < N; z++) {
      const wz = worldZ(z);
      for (let x = 0; x < N; x++) {
        const wx = worldX(x);
        const i = idx(x, z);
        const h0 = height[i];
        let t = 0.65;
        let lit = 1.0;
        for (let s = 0; s < 14; s++) {
          const hh = heightAt(wx + sx * t, wz + sz * t);
          if (hh > h0 + t * tanElev + 0.04) { lit = 0.0; break; }
          t *= 1.36;
        }
        ao[i] *= lit === 0 ? 0.56 : 1.0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 9b. Paint the ground
  // -------------------------------------------------------------------------
  const colors = new Float32Array(n * 3);
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  for (let z = 0; z < N; z++) {
    const wz = worldZ(z);
    for (let x = 0; x < N; x++) {
      const wx = worldX(x);
      const i = idx(x, z);
      const h = height[i];
      const slope = slopeAt(wx, wz);
      const rm = riverMask[i];
      const pm = pathMask[i];
      const fm = flatMask[i];

      // ---- grass: macro biomes, meso patches, a whisper of micro break-up
      const macro = noiseA.fbm(wx * 0.017 + 3.3, wz * 0.017 - 8.1, 3);
      const meso = noiseB.fbm(wx * 0.062, wz * 0.062, 3);
      const micro = noiseC.noise(wx * 0.2, wz * 0.2);
      const shadeN = noiseD.fbm(wx * 0.035 - 4.0, wz * 0.035 + 6.0, 2);

      let grass = mix3(PALETTE.grassDeep, PALETTE.grassMid, clamp01(smoothstep(-0.28, 0.06, macro + meso * 0.22)));
      grass = mix3(grass, PALETTE.grassLight, clamp01(smoothstep(-0.04, 0.26, macro + meso * 0.34 + micro * 0.04)));
      grass = mix3(grass, PALETTE.grassSun, clamp01(smoothstep(0.1, 0.4, macro * 0.85 + meso * 0.36 + micro * 0.05)) * 0.9);
      // deep shadowed creases in the grass
      grass = mix3(grass, PALETTE.grassShade, clamp01(smoothstep(0.28, 0.6, slope)) * 0.62);
      grass = mix3(grass, PALETTE.grassDark, clamp01(smoothstep(0.02, 0.3, -macro - meso * 0.2)) * 0.55);
      // sun-bleached higher ground
      grass = mix3(grass, PALETTE.grassSun, clamp01(smoothstep(0.25, 0.6, shadeN)) * 0.18);

      // ---- bare earth patches: brush-stroke ochre
      const patchN = noiseD.fbm(wx * 0.043 + 11.0, wz * 0.043 - 5.0, 3) * 0.5 + 0.5;
      const patchEdge = noiseC.noise(wx * 0.24, wz * 0.24) * 0.05;
      const patch = clamp01(smoothstep(0.565, 0.675, patchN + patchEdge)) * (1.0 - smoothstep(0.24, 0.46, slope));
      let col = mix3(grass, PALETTE.dirtLight, patch * 0.88);
      col = mix3(col, PALETTE.dirtMid, patch * clamp01(smoothstep(0.15, 0.75, meso + 0.4)) * 0.55);

      // ---- trail
      const pathEdge = noiseC.noise(wx * 0.9, wz * 0.9) * 0.18;
      const pmix = clamp01(smoothstep(0.14, 0.5, pm + pathEdge));
      if (pmix > 0.001) {
        col = mix3(col, PALETTE.dirtMid, pmix);
        col = mix3(col, PALETTE.dirtLight, pmix * clamp01(smoothstep(-0.2, 0.45, meso)) * 0.85);
        col = mix3(col, PALETTE.dirtDark, pmix * clamp01(smoothstep(0.15, 0.7, micro + 0.4)) * 0.45);
      }

      // ---- clearing: trodden, slightly paler grass
      if (fm > 0.001) col = mix3(col, PALETTE.grassSun, fm * 0.12);

      // ---- painterly mottle: break the flat wash into brush-ish patches
      const brush = noiseB.fbm(wx * 0.38, wz * 0.38, 2);
      const blotch = noiseA.fbm(wx * 0.11 + 21.0, wz * 0.11 - 13.0, 2);
      const mottle = 1.0 + brush * 0.052 + blotch * 0.045;
      col = [col[0] * mottle, col[1] * (mottle + blotch * 0.02), col[2] * (mottle - blotch * 0.03)];

      // ---- exposed stone on the cliff risers, with horizontal strata
      const rockAmount = smoothstep(0.42, 0.62, slope);
      if (rockAmount > 0.002) {
        const strataN = noiseA.noise(wx * 0.05, h * 0.75) * 0.5 + 0.5;
        const strata = smoothstep(0.3, 0.56, (h * 0.42 + strataN * 0.55) % 1.0);
        let rock = mix3(PALETTE.rockDark, PALETTE.rockMid, strata);
        rock = mix3(rock, PALETTE.rockLight, clamp01(smoothstep(0.55, 0.95, strata)) * 0.8);
        rock = mix3(rock, PALETTE.stoneWarm, 0.1 + 0.12 * (noiseB.noise(wx * 0.22, wz * 0.22) * 0.5 + 0.5));
        col = mix3(col, rock, rockAmount);
      }

      // ---- pale sand on the river shoulder, dark scoured bed
      if (rm > 0.001) {
        const sand = smoothstep(0.06, 0.28, rm) * (1 - smoothstep(0.36, 0.6, rm));
        col = mix3(col, PALETTE.dirtLight, sand * 0.55);
        const bed = smoothstep(0.4, 0.8, rm);
        col = mix3(col, PALETTE.dirtShadow, bed * 0.7);
        col = mix3(col, PALETTE.rockDark, bed * clamp01(smoothstep(0.45, 0.9, slope)) * 0.7);
      }

      colors[i * 3] = col[0];
      colors[i * 3 + 1] = col[1];
      colors[i * 3 + 2] = col[2];
    }
  }

  // -------------------------------------------------------------------------
  // Water description
  // -------------------------------------------------------------------------
  const waterPieces = buildWaterPieces(river);

  // -------------------------------------------------------------------------
  // Scattering
  // -------------------------------------------------------------------------
  const props = scatterProps({
    seed, rng, heightAt, slopeAt,
    pathAt: (x, z) => fieldAt(pathMask, x, z),
    riverAt: (x, z) => fieldAt(riverMask, x, z),
    riverDistAt: (x, z) => fieldAt(riverDist, x, z),
    plot, noiseA, noiseB, noiseC, noiseD,
  });

  const spawn = { x: plot.x - 3.2, z: plot.z + 4.6 };
  spawn.y = heightAt(spawn.x, spawn.z);

  return {
    seed, size: WORLD.size, grid: N, cell: CELL,
    height, colors, ao, pathMask, riverMask, flatMask, riverDist,
    heightAt, fieldAt, slopeAt,
    plot, spawn, path: pathPts, river,
    waterPieces, props, palette: PALETTE,
  };
}

// ---------------------------------------------------------------------------
// Waterfall / pool description
// ---------------------------------------------------------------------------
function buildWaterPieces(river) {
  const tiers = [];
  let current = null;
  for (const s of river) {
    if (!current || current.tier !== s.tier) {
      current = { tier: s.tier, points: [] };
      tiers.push(current);
    }
    current.points.push(s);
  }
  const falls = [];
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1].points, next = tiers[i].points;
    const a = prev[prev.length - 1], b = next[0];
    falls.push({
      x: (a.x + b.x) * 0.5,
      z: (a.z + b.z) * 0.5,
      topY: a.y, bottomY: b.y,
      width: (a.width + b.width) * 0.5,
      drop: a.y - b.y,
    });
  }
  return {
    ribbon: river.map((s) => ({ x: s.x, y: s.y, z: s.z, width: s.width, tier: s.tier })),
    falls,
    tiers: tiers.map((t) => t.points),
  };
}

// ---------------------------------------------------------------------------
// Prop scattering
// ---------------------------------------------------------------------------
function scatterProps(ctx) {
  const { heightAt, slopeAt, pathAt, riverAt, riverDistAt, plot, rng, noiseA, noiseB, noiseC, noiseD } = ctx;
  const HALF = WORLD.size / 2;
  const trees = [], rocks = [], bushes = [], tufts = [], ferns = [], logs = [], stumps = [];

  const claimed = new Map();
  const occupied = (x, z, radius) => {
    const cx = Math.round(x / 2.4), cz = Math.round(z / 2.4);
    const r = Math.ceil(radius / 2.4);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const list = claimed.get(`${cx + dx},${cz + dz}`);
      if (!list) continue;
      for (const p of list) if (Math.hypot(p.x - x, p.z - z) < radius + p.r) return true;
    }
    return false;
  };
  const claim = (x, z, radius) => {
    const k = `${Math.round(x / 2.4)},${Math.round(z / 2.4)}`;
    if (!claimed.has(k)) claimed.set(k, []);
    claimed.get(k).push({ x, z, r: radius });
  };

  const inPlot = (x, z, pad = 0) => Math.hypot(x - plot.x, z - plot.z) < plot.r + pad;
  const okGround = (x, z, maxSlope = 0.45, pathMax = 0.22, riverMax = 0.2) => {
    if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5) return false;
    if (slopeAt(x, z) > maxSlope) return false;
    if (pathAt(x, z) > pathMax) return false;
    if (riverAt(x, z) > riverMax) return false;
    return true;
  };

  const scatterWith = (attempts, test, place) => {
    for (let i = 0; i < attempts; i++) {
      const x = (rng() * 2 - 1) * (HALF - 1.2);
      const z = (rng() * 2 - 1) * (HALF - 1.2);
      if (test(x, z)) place(x, z);
    }
  };

  const makeTree = (x, z, type, scale) => {
    trees.push({
      x, z, y: heightAt(x, z), scale, type,
      rot: rng() * Math.PI * 2,
      variant: Math.floor(rng() * 3),
      hue: rng(),
      girth: 0.82 + rng() * 0.42,
      swayPhase: rng() * Math.PI * 2,
      id: `t${trees.length}`,
    });
    claim(x, z, type === 'pine' ? 1.0 : 1.55);
  };

  // Broadleaf groves in the valley
  scatterWith(4200, (x, z) => {
    if (inPlot(x, z, 4.5)) return false;
    const grove = noiseA.fbm(x * 0.038 + 2.2, z * 0.038 - 4.4, 2) * 0.5 + 0.5;
    const chance = 0.1 + smoothstep(0.42, 0.72, grove) * 0.72;
    if (rng() > chance) return false;
    if (!okGround(x, z, 0.42, 0.18, 0.12)) return false;
    if (occupied(x, z, 1.8)) return false;
    return true;
  }, (x, z) => {
    const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    const pineBias = noiseD.fbm(x * 0.05, z * 0.05, 2) * 0.5 + 0.5;
    const isPine = edge > 0.6 ? rng() < 0.85 : pineBias > 0.66 ? rng() < 0.55 : rng() < 0.1;
    makeTree(x, z, isPine ? 'pine' : 'broad', 0.8 + rng() * 0.7);
  });

  // dense dark pine wall around the play field
  scatterWith(5200, (x, z) => {
    const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    if (edge < 0.55) return false;
    const density = noiseB.fbm(x * 0.07, z * 0.07, 2) * 0.5 + 0.5;
    if (rng() > 0.42 + density * 0.5) return false;
    if (slopeAt(x, z) > 0.78) return false;
    if (occupied(x, z, 1.25)) return false;
    return true;
  }, (x, z) => makeTree(x, z, 'pine', 0.9 + rng() * 0.75));

  // Rocks
  scatterWith(1600, (x, z) => {
    if (inPlot(x, z, 2.0)) return false;
    const s = slopeAt(x, z);
    const nearRiver = riverDistAt(x, z) < 9;
    const chance = nearRiver ? 0.42 : s > 0.3 ? 0.3 : 0.05;
    if (rng() > chance) return false;
    if (occupied(x, z, 1.1)) return false;
    return Math.abs(x) < HALF - 2.5 && Math.abs(z) < HALF - 2.5;
  }, (x, z) => {
    const scale = 0.5 + Math.pow(rng(), 1.7) * 2.1;
    rocks.push({
      x, z, y: heightAt(x, z), scale,
      rot: rng() * Math.PI * 2,
      tilt: (rng() - 0.5) * 0.5,
      variant: Math.floor(rng() * 3),
      pale: rng() > 0.62,
      id: `r${rocks.length}`,
    });
    claim(x, z, 0.68 * scale);
  });

  // Bushes
  scatterWith(2600, (x, z) => {
    if (inPlot(x, z, 0.2)) return false;
    if (!okGround(x, z, 0.48, 0.2, 0.18)) return false;
    const density = noiseC.fbm(x * 0.09 + 7.0, z * 0.09 - 3.0, 2) * 0.5 + 0.5;
    if (rng() > 0.12 + density * 0.55) return false;
    if (occupied(x, z, 1.0)) return false;
    return true;
  }, (x, z) => {
    bushes.push({
      x, z, y: heightAt(x, z),
      scale: 0.5 + rng() * 0.85,
      rot: rng() * Math.PI * 2,
      variant: Math.floor(rng() * 3),
      hue: rng(),
      id: `b${bushes.length}`,
    });
    claim(x, z, 0.5);
  });

  // Grass tufts
  const tuftBudget = 26000;
  const tuftCap = 9500;
  for (let i = 0; i < tuftBudget && tufts.length < tuftCap; i++) {
    const x = (rng() * 2 - 1) * (HALF - 1.2);
    const z = (rng() * 2 - 1) * (HALF - 1.2);
    if (slopeAt(x, z) > 0.46) continue;
    if (pathAt(x, z) > 0.28) continue;
    if (riverAt(x, z) > 0.3) continue;
    const clump = noiseB.fbm(x * 0.13, z * 0.13, 2) * 0.5 + 0.5;
    if (rng() > 0.22 + clump * 0.78) continue;
    if (inPlot(x, z, 0) && rng() < 0.35) continue;
    tufts.push({
      x, y: heightAt(x, z), z,
      scale: 0.55 + rng() * 0.9,
      rot: rng() * Math.PI * 2,
      variant: rng() > 0.86 ? 2 : rng() > 0.42 ? 1 : 0,
      hue: rng(),
      lean: (rng() - 0.5) * 0.6,
    });
  }

  // Ferns & flowering plants
  const fernBudget = 6000;
  for (let i = 0; i < fernBudget && ferns.length < 1500; i++) {
    const x = (rng() * 2 - 1) * (HALF - 1.2);
    const z = (rng() * 2 - 1) * (HALF - 1.2);
    if (slopeAt(x, z) > 0.4) continue;
    if (pathAt(x, z) > 0.2) continue;
    if (riverAt(x, z) > 0.22) continue;
    if (Math.hypot(x - plot.x, z - plot.z) < plot.r * 0.55) continue;
    const shade = noiseD.fbm(x * 0.075 + 3.0, z * 0.075 - 2.0, 2) * 0.5 + 0.5;
    if (rng() > 0.05 + shade * 0.55) continue;
    ferns.push({
      x, y: heightAt(x, z), z,
      scale: 0.5 + rng() * 0.75,
      rot: rng() * Math.PI * 2,
      variant: Math.floor(rng() * 2),
      hue: rng(),
    });
  }

  // Deadfall
  scatterWith(900, (x, z) => {
    if (inPlot(x, z, 2.5)) return false;
    if (!okGround(x, z, 0.42, 0.2, 0.2)) return false;
    if (rng() > 0.2) return false;
    if (occupied(x, z, 2.0)) return false;
    return true;
  }, (x, z) => {
    if (rng() < 0.5) {
      stumps.push({ x, z, y: heightAt(x, z), scale: 0.6 + rng() * 0.6, rot: rng() * Math.PI * 2, height: 0.5 + rng() * 0.7 });
    } else {
      logs.push({ x, z, y: heightAt(x, z), scale: 0.7 + rng() * 0.6, rot: rng() * Math.PI * 2, length: 1.6 + rng() * 2.2 });
    }
    claim(x, z, 1.2);
  });

  return { trees, rocks, bushes, tufts, ferns, logs, stumps };
}

// ---------------------------------------------------------------------------
// Box blur (separable), used by the terrace pass
// ---------------------------------------------------------------------------
export function blurField(src, N, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = radius * 2 + 1;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += src[z * N + clamp(x + k, 0, N - 1)];
      }
      tmp[z * N + x] = sum / win;
    }
  }
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += tmp[clamp(z + k, 0, N - 1) * N + x];
      }
      out[z * N + x] = sum / win;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hydraulic erosion (droplet model)
// ---------------------------------------------------------------------------
export function erode(height, N, rng, opt) {
  const { droplets, steps, radius, inertia, capacity, minSlope, deposit, erodeSpeed, gravity, evaporation } = opt;
  const brush = erosionBrush(radius);
  let px = 0, py = 0, dirX = 0, dirY = 0, speed = 0, water = 0, sediment = 0;

  const sample = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= N - 1 || yi >= N - 1) return -1;
    const u = x - xi, v = y - yi;
    const i = yi * N + xi;
    return lerp(lerp(height[i], height[i + 1], u), lerp(height[i + N], height[i + N + 1], u), v);
  };
  const grad = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const u = x - xi, v = y - yi;
    const i = yi * N + xi;
    return [
      (height[i + 1] - height[i]) * (1 - v) + (height[i + N + 1] - height[i + N]) * v,
      (height[i + N] - height[i]) * (1 - u) + (height[i + N + 1] - height[i + 1]) * u,
    ];
  };

  for (let d = 0; d < droplets; d++) {
    px = rng() * (N - 2) + 1;
    py = rng() * (N - 2) + 1;
    dirX = 0; dirY = 0; speed = 1; water = 1; sediment = 0;
    for (let s = 0; s < steps; s++) {
      const nodeX = Math.floor(px), nodeY = Math.floor(py);
      const cellX = px - nodeX, cellY = py - nodeY;
      if (nodeX < 1 || nodeY < 1 || nodeX >= N - 2 || nodeY >= N - 2) break;

      const [gx, gy] = grad(px, py);
      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.hypot(dirX, dirY);
      if (len < 1e-6) break;
      dirX /= len; dirY /= len;
      px += dirX; py += dirY;

      const hOld = sample(nodeX + cellX, nodeY + cellY);
      const hNew = sample(px, py);
      if (hNew < 0) break;
      const deltaH = hNew - hOld;

      const cap = Math.max(-deltaH * speed * water * capacity, minSlope);
      if (sediment > cap || deltaH > 0) {
        const amount = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - cap) * deposit;
        sediment -= amount;
        const i = nodeY * N + nodeX;
        height[i] += amount * (1 - cellX) * (1 - cellY);
        height[i + 1] += amount * cellX * (1 - cellY);
        height[i + N] += amount * (1 - cellX) * cellY;
        height[i + N + 1] += amount * cellX * cellY;
      } else {
        const amount = Math.min((cap - sediment) * erodeSpeed, -deltaH);
        if (amount > 0) {
          for (let b = 0; b < brush.length; b += 3) {
            const bx = nodeX + brush[b], by = nodeY + brush[b + 1];
            if (bx < 0 || by < 0 || bx >= N || by >= N) continue;
            const bi = by * N + bx;
            height[bi] -= Math.min(height[bi], amount * brush[b + 2]);
          }
          sediment += amount;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + deltaH * -gravity));
      water *= 1 - evaporation;
      if (water < 0.02) break;
    }
  }
}

function erosionBrush(radius) {
  const entries = [];
  let sum = 0;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const dist = Math.sqrt(x * x + y * y);
      if (dist > radius) continue;
      const w = 1 - dist / radius;
      entries.push(x, y, w);
      sum += w;
    }
  }
  for (let i = 2; i < entries.length; i += 3) entries[i] /= sum;
  return entries;
}
