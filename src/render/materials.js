/**
 * Materials — a handful of small hand-written GLSL programs that give the
 * whole game one painting-like shading model:
 *
 *   · three flat light bands instead of a smooth lambert ramp
 *   · baked ambient occlusion multiplied only into the ambient term
 *   · distant haze that warms toward the sun
 *   · wind: every vertex of every plant is displaced on the GPU
 *
 * Display-space colours throughout (renderer output is LinearSRGB, so no
 * conversion happens and the art stays exactly as authored).
 */
import * as THREE from 'three';
import { shared } from '../core/shared.js';

export const COMMON_GLSL = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uNightMix;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// three painted bands — the core of the look
vec3 mossLight(vec3 albedo, vec3 n, float ao) {
  vec3 nn = normalize(n);
  float ndl = dot(nn, uSunDir) * 0.5 + 0.5;
  float b1 = smoothstep(0.38, 0.48, ndl);
  float b2 = smoothstep(0.60, 0.70, ndl);
  float shade = 0.26 + 0.44 * b1 + 0.34 * b2;
  float aoA = mix(0.38, 1.0, ao);
  vec3 amb = uAmbient * aoA * (0.80 + 0.20 * nn.y);
  vec3 sun = uSunColor * shade * mix(0.30, 1.0, ao);
  vec3 col = albedo * (amb + sun);
  // cool bounce into shadowed surfaces, warm kiss on top faces
  col += vec3(0.012, 0.02, 0.028) * (1.0 - b1) * aoA;
  col += vec3(0.035, 0.028, 0.008) * b2 * nn.y;
  return col;
}

// unified painterly grade: gentle desaturation + warm bias ties every asset
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.13);
  c *= vec3(1.025, 1.0, 0.972);
  return c;
}

vec3 applyFog(vec3 col, float dist) {
  float f = smoothstep(uFogNear, uFogFar, dist);
  f = f * f * 0.72 + f * 0.28;
  vec3 haze = uFogColor;
  return grade(mix(col, haze, clamp(f, 0.0, 0.92)));
}
`;

function commonUniforms() {
  return {
    uTime: shared.uTime,
    uSunDir: shared.uSunDir,
    uSunColor: shared.uSunColor,
    uAmbient: shared.uAmbient,
    uFogColor: shared.uFogColor,
    uFogNear: shared.uFogNear,
    uFogFar: shared.uFogFar,
    uWindDir: shared.uWindDir,
    uWindStrength: shared.uWindStrength,
    uCamRight: shared.uCamRight,
    uNightMix: shared.uNightMix,
  };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
export function createTerrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: commonUniforms(),
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aAO;
      varying vec3 vColor;
      varying float vAO;
      varying float vDist;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vColor = aColor;
        vAO = aAO;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: COMMON_GLSL + /* glsl */`
      varying vec3 vColor;
      varying float vAO;
      varying float vDist;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        // painterly break-up so broad colour fields never look like a gradient
        float g1 = vnoise(vWorld.xz * 1.9);
        float g2 = vnoise(vWorld.xz * 0.42 + 11.0);
        float g3 = vnoise(vWorld.xz * 7.0);
        vec3 albedo = vColor * (0.945 + g1 * 0.07 + g2 * 0.06 + g3 * 0.025);
        vec3 n = normalize(vNormalW);
        vec3 col = mossLight(albedo, n, vAO);
        col = applyFog(col, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Foliage cards (billboards + flat branch cards), fully wind-driven
// ---------------------------------------------------------------------------
export function createCardMaterial(map, opts = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uMap: { value: map },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uAlphaCut: { value: opts.alphaCut ?? 0.5 },
      uDither: { value: opts.dither ?? 1.0 },
      uSwayMul: { value: opts.sway ?? 1.0 },
      uOcclude: { value: opts.occlude ?? 1.0 },
      uBrightness: { value: opts.brightness ?? 1.0 },
    },
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    defines: opts.billboard ? { BILLBOARD: '' } : {},
    vertexShader: /* glsl */`
      attribute vec4 aParams;   // x phase · y sway · z tint index · w lean
      attribute vec3 aTint;
      attribute float aImpulse;
      uniform float uTime;
      uniform vec3 uCamRight;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      uniform float uSwayMul;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vDist;
      varying float vHeight;
      varying vec3 vWorld;

      void main() {
        vec3 ip = instanceMatrix[3].xyz;
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        float sz = length(instanceMatrix[2].xyz);
        #ifdef BILLBOARD
          float h = clamp(position.y, 0.0, 1.0);
        #else
          float h = 0.9;
        #endif

        #ifdef BILLBOARD
          vec3 right = normalize(uCamRight);
          vec3 local = right * (position.x * sx) + vec3(0.0, 1.0, 0.0) * (position.y * sy);
          float heightW = h * sy;
        #else
          vec3 axisX = normalize(instanceMatrix[0].xyz);
          vec3 axisZ = normalize(instanceMatrix[2].xyz);
          vec3 local = axisX * (position.x * sx) + axisZ * (position.z * sz);
          float heightW = 0.0;
        #endif

        // ---- wind field: slow gusts + fast flutter, per-instance phase
        float gust = sin(uTime * 0.55 + ip.x * 0.09 + ip.z * 0.11) * 0.5 + 0.5;
        gust = gust * gust;
        float wave = sin(uTime * 1.55 + aParams.x + ip.x * 0.22 + ip.z * 0.31) * 0.62
                   + sin(uTime * 2.75 + aParams.x * 1.7 + ip.z * 0.6) * 0.26
                   + sin(uTime * 5.1 + aParams.x * 2.3 + ip.x * 0.8) * 0.09;
        float bend = wave * aParams.y * (0.34 + gust * 0.95) * uWindStrength * uSwayMul;
        bend += aImpulse * 0.55;
        float lever = pow(h, 1.55);
        float lean = aParams.w;

        vec3 pos = ip + local;
        pos.xz += uWindDir.xy * bend * lever;
        pos.xz += vec2(-uWindDir.y, uWindDir.x) * bend * lever * 0.28;
        pos.xz += uWindDir.xy * lean * lever * 0.35;
        // micro flutter (leaf tips shimmer)
        #ifdef BILLBOARD
          pos.x += sin(uTime * 4.7 + aParams.x * 2.9 + position.y * 5.0) * 0.016 * h * aParams.y;
          pos.z += cos(uTime * 4.1 + aParams.x * 1.3 + position.y * 4.0) * 0.014 * h * aParams.y;
        #else
          pos.y += sin(uTime * 2.3 + aParams.x + position.x * 3.1 + position.z * 2.4) * 0.05 * aParams.y;
        #endif

        vUv = uv;
        vTint = aTint;
        vHeight = h;
        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: COMMON_GLSL + /* glsl */`
      uniform sampler2D uMap;
      uniform float uAlphaCut;
      uniform float uDither;
      uniform float uOcclude;
      uniform float uBrightness;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vDist;
      varying float vHeight;
      varying vec3 vWorld;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        float a = tex.a;

        // soft painted fringe: stochastic dither in a narrow alpha band keeps
        // sprite edges ragged instead of laser-cut
        if (a < uAlphaCut) {
          float d = hash12(floor(gl_FragCoord.xy));
          if (a < uAlphaCut * 0.62 + d * uAlphaCut * 0.85 * uDither) discard;
        }

        // subtle per-card hue drift keeps a field of grass from cloning
        vec3 albedo = tex.rgb * vTint * uTint * uBrightness;

        // foliage volumes read darker underneath
        float ao = mix(0.55, 1.0, smoothstep(0.0, 0.75, vHeight));
        ao *= mix(1.0, 0.82, uNightMix);
        // gentle light from above with a slight camera-facing bias
        vec3 n = normalize(vec3(0.0, 0.94, 0.34));
        vec3 col = mossLight(albedo, n, mix(1.0, ao, uOcclude));
        col = applyFog(col, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return mat;
}

// ---------------------------------------------------------------------------
// Solid painted surfaces (buildings, rocks, trunks, character)
// ---------------------------------------------------------------------------
export function createSolidMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uFlat: { value: opts.flat === false ? 0 : 1 },
      uEmissive: { value: new THREE.Color(0, 0, 0) },
      uBrightness: { value: opts.brightness ?? 1 },
    },
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      varying vec3 vColor;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        vColor = aColor;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: COMMON_GLSL + /* glsl */`
      uniform float uFlat;
      uniform vec3 uEmissive;
      uniform float uBrightness;
      varying vec3 vColor;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        float g = vnoise(vWorld.xz * 3.1 + vWorld.y * 2.0) * 0.06;
        // flat face normals come from the geometry (non-indexed meshes)
        vec3 n = normalize(vNormalW);
        vec3 col = mossLight(vColor * (1.0 + g) * uBrightness, n, 0.92);
        col += uEmissive;
        col = applyFog(col, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------
export function createWaterMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uDeep: { value: new THREE.Color(0.412, 0.451, 0.341) },
      uShallow: { value: new THREE.Color(0.878, 0.839, 0.624) },
      uFoam: { value: new THREE.Color(0.965, 0.953, 0.847) },
      uFlow: { value: opts.flow ?? 0.35 },
      uFall: { value: opts.fall ? 1 : 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: COMMON_GLSL + /* glsl */`
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      uniform float uFlow;
      uniform float uFall;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;

      void main() {
        float t = uTime;
        vec2 uv = vUv;
        // flowing golden water
        float n1 = vnoise(vec2(uv.x * 26.0, uv.y * 9.0 - t * uFlow * 2.2));
        float n2 = vnoise(vec2(uv.x * 55.0 + 7.0, uv.y * 20.0 - t * uFlow * 4.4));
        float sparkle = smoothstep(0.72, 0.92, n1 * 0.6 + n2 * 0.55);
        float streak = smoothstep(0.55, 0.95, n2);

        vec3 col = mix(uDeep, uShallow, 0.42 + 0.5 * n1);
        col += uFoam * sparkle * 0.85;
        col += uFoam * streak * 0.28;

        // shore foam on the ribbon edges
        float edge = min(uv.x, 1.0 - uv.x);
        float foam = smoothstep(0.16, 0.0, edge) * (0.55 + 0.45 * sin(uv.y * 90.0 + t * 3.0));
        col = mix(col, uFoam, clamp(foam, 0.0, 0.85));

        if (uFall > 0.5) {
          // vertical plunges read as pale, streaky curtains of water
          float streakF = smoothstep(0.25, 0.8, vnoise(vec2(uv.x * 34.0, uv.y * 7.0 - t * 5.0)));
          col = mix(uShallow, uFoam, 0.35 + streakF * 0.55);
          col = mix(col, uFoam, smoothstep(0.35, 0.0, uv.y) * 0.3);
        }

        float lum = 0.9 + 0.1 * sin(uTime * 0.8);
        vec3 lit = mossLight(col * lum, normalize(vec3(0.0, 0.9, 0.3)), 0.95);
        lit = applyFog(lit, vDist);
        gl_FragColor = vec4(lit, uOpacity);
      }
    `,
    transparent: false,
  });
}

// ---------------------------------------------------------------------------
// Instanced solids (rock clusters, trunks, bush cores, canopy masses)
// ---------------------------------------------------------------------------
export function createInstancedSolidMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uBrightness: { value: opts.brightness ?? 1 },
      uSwayPow: { value: opts.swayPow ?? 1.6 },
    },
    side: THREE.FrontSide,
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute vec2 aWind;    // x phase · y sway amplitude
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      varying vec3 vColor;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      varying float vDist;
      varying float vHeight;
      void main() {
        vec3 p = position;
        vec4 wp = instanceMatrix * vec4(p, 1.0);
        float h = clamp(p.y, -1.0, 2.0);
        float gust = sin(uTime * 0.55 + wp.x * 0.09 + wp.z * 0.11) * 0.5 + 0.5;
        float wave = sin(uTime * 1.5 + aWind.x + wp.x * 0.2 + wp.z * 0.28) * 0.7
                   + sin(uTime * 2.9 + aWind.x * 1.6) * 0.3;
        float bend = wave * aWind.y * (0.35 + gust) * uWindStrength;
        wp.xz += uWindDir.xy * bend * max(0.0, h);
        wp.xz += vec2(-uWindDir.y, uWindDir.x) * bend * max(0.0, h) * 0.3;

        vec4 wpos = modelMatrix * wp;
        vWorld = wpos.xyz;
        vColor = aColor;
        vHeight = h;
        vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vec4 mv = viewMatrix * wpos;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: COMMON_GLSL + /* glsl */`
      uniform float uBrightness;
      varying vec3 vColor;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      varying float vDist;
      varying float vHeight;
      void main() {
        vec3 n = normalize(vNormalW);
        float g = vnoise(vWorld.xz * 4.0 + vWorld.y) * 0.05;
        vec3 col = mossLight(vColor * (1.0 + g) * uBrightness, n, 0.9);
        col = applyFog(col, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
