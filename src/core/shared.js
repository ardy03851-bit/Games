/**
 * Shared state: uniforms, palette bridge and small helpers used by every
 * renderer module. Everything is authored in display space (sRGB) so the
 * colours you see are the colours painted in the reference art.
 */
import * as THREE from 'three';
import { PALETTE } from '../terrain/terrain.js';
export { PALETTE };

export const COL = {};
for (const [k, v] of Object.entries(PALETTE)) COL[k] = new THREE.Color(v[0], v[1], v[2]);

export const QUALITY = {
  level: 2,           // 0 low · 1 medium · 2 high
  dprCap: 2,
};

export const shared = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.58, 0.79, -0.37).normalize() },
  uSunColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
  uAmbient: { value: new THREE.Color(0.35, 0.39, 0.34) },
  uFogColor: { value: new THREE.Color(0.62, 0.63, 0.52) },
  uFogNear: { value: 32 },
  uFogFar: { value: 104 },
  uWindDir: { value: new THREE.Vector2(0.86, 0.32).normalize() },
  uWindStrength: { value: 1.0 },
  uCamRight: { value: new THREE.Vector3(1, 0, 0) },
  uNightMix: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
};

export const PAL = PALETTE;

export function hexLerp(a, b, t, out = new THREE.Color()) {
  return out.setRGB(
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  );
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** Deterministic per-position pseudo random for scattering decisions. */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
