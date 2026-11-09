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
uniform vec3 uViewDir;
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

// four painted bands — the core of the look: hard edges, no lambert ramp.
// The references separate light and shadow almost violently: a lit turf top is
// double the value of the same turf in shade. We keep that contrast and add a
// cool sky rim so silhouettes never dissolve into the background.
vec3 mossLight(vec3 albedo, vec3 n, float ao) {
  vec3 nn = normalize(n);
  float ndl = dot(nn, uSunDir) * 0.5 + 0.5;
  float b1 = smoothstep(0.395, 0.445, ndl);
  float b2 = smoothstep(0.560, 0.610, ndl);
  float b3 = smoothstep(0.735, 0.790, ndl);
  float shade = 0.050 + 0.29 * b1 + 0.25 * b2 + 0.25 * b3;
  float aoA = mix(0.34, 1.0, ao);
  // shadow is cool, not just dark: a blue-green wash keeps the darks alive
  vec3 amb = uAmbient * aoA * (0.74 + 0.26 * nn.y) * vec3(0.90, 1.00, 1.14);
  vec3 sun = uSunColor * shade * mix(0.26, 1.0, ao);
  vec3 col = albedo * (amb + sun);
  // camera fill: the fixed camera looks down from the south, so anything
  // facing it gets a soft bounce. Without this every wall facing the player is
  // a black slab — the references never let that happen.
  float fill = clamp(dot(nn, -uViewDir) * 0.5 + 0.5, 0.0, 1.0);
  // only *walls* catch the bounce — flat ground keeps its painted shade pools
  float wall = 1.0 - 0.78 * clamp(nn.y, 0.0, 1.0);
  col += albedo * uAmbient * 0.55 * fill * fill * wall;
  // sky rim: upward faces catch a pale, slightly blue wash like the paintings
  float rim = smoothstep(0.35, 1.0, nn.y) * (0.55 + 0.45 * b2);
  col += albedo * vec3(0.035, 0.052, 0.065) * rim;
  // cool bounce into the shadow band, warm kiss on the top band
  col += vec3(0.010, 0.022, 0.036) * (1.0 - b1) * aoA;
  col += vec3(0.062, 0.048, 0.016) * b3 * max(0.0, nn.y);
  // painted saturation — the reference art is richer than a physical model
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, 1.12);
  return max(col, vec3(0.0));
}

// Painted ground texture. Four layers, all in world space and all faded with
// distance so the near ground is shaggy and the far ground stays clean:
//   · clumps — soft dark tufts, the "bunched grass" of the paintings
//   · hatching — dark strokes down the fall line of the slope
//   · blades — bright short strokes on grass only
//   · dabs — small dark flecks where a patch breaks up
vec3 groundDetail(vec2 p, vec2 slopeDir, float fade, float greenish) {
  vec2 dir = vec2(-0.30, 0.954);
  float across = dot(p, vec2(-dir.y, dir.x));
  float along = dot(p, dir);

  // clumps: low frequency, thresholded so they read as shapes not haze
  float clumpN = vnoise(p * 0.62 + 4.0) * 0.6 + vnoise(p * 1.45 - 2.0) * 0.4;
  float clump = smoothstep(0.52, 0.86, clumpN) * greenish;

  // dark hatching, aligned to the fall line of the slope
  vec2 sdir = slopeDir;
  float sa = dot(p, vec2(-sdir.y, sdir.x)) * 6.2;
  float sl = dot(p, sdir) * 2.4;
  float cellA = floor(sa);
  float cellL = floor(sl * 1.7);
  float hh = hash12(vec2(cellA, cellL));
  float wob = sin(sl * 7.0 + hh * 6.2831) * 0.34;
  float stroke = step(0.58, hh) * smoothstep(0.52, 0.06, abs(fract(sa) - 0.5 + wob * 0.2));
  stroke += step(0.76, hash12(vec2(cellA + 4.0, cellL * 1.3))) *
            smoothstep(0.45, 0.05, abs(fract(sa * 2.1 + 0.3) - 0.5)) * 0.7;

  // bright blade strokes: short, dense, only where the ground is grassy
  float bx = floor(across * 22.0);
  float bz = floor(along * 12.0);
  float bh = hash12(vec2(bx, bz));
  float blade = step(0.48, bh) *
    smoothstep(0.5, 0.02, abs(fract(across * 22.0 + bh * 0.6) - 0.5 + sin(along * 26.0 + bh * 5.0) * 0.30));

  float gx = floor(p.x * 5.0), gz = floor(p.y * 5.0);
  float dab = step(0.86, hash12(vec2(gx, gz))) * (0.4 + 0.6 * hash12(vec2(gx + 7.0, gz)));

  vec3 dark = vec3(-0.060, -0.046, -0.034) * clamp(stroke, 0.0, 1.0) * (1.0 - greenish * 0.40);
  vec3 tuft = vec3(-0.055, -0.020, -0.030) * clump;
  vec3 light = vec3(0.080, 0.098, 0.030) * clamp(blade, 0.0, 1.0) * greenish;
  vec3 dabs = vec3(-0.055, -0.048, -0.028) * dab * (1.0 - greenish * 0.5);
  return (dark + tuft + light + dabs) * fade;
}

// unified painterly grade: gentle desaturation + warm bias ties every asset
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.07);
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
    uViewDir: shared.uViewDir,
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
    uniforms: {
      ...commonUniforms(),
      uGround: { value: null },
    },
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
      uniform sampler2D uGround;
      varying vec3 vColor;
      varying float vAO;
      varying float vDist;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      // The painted ground tile is mid-grey, so (sample * 2 - 1) is a signed
      // brush offset. Two octaves: a broad one that reads as dabs of paint at
      // walking distance, a finer one that reads as grain up close.
      float groundPaint(vec2 p, float fade) {
        if (fade < 0.01) return 0.0;
        float a = texture2D(uGround, p * 0.42).r * 2.0 - 1.0;
        float b = texture2D(uGround, p * 1.55 + vec2(0.37, 0.19)).r * 2.0 - 1.0;
        float c = texture2D(uGround, p * 4.1 + vec2(0.71, 0.53)).r * 2.0 - 1.0;
        return (a * 0.52 + b * 0.31 + c * 0.17) * fade;
      }

      void main() {
        vec3 n = normalize(vNormalW);
        float slope = 1.0 - n.y;
        float fade = smoothstep(96.0, 22.0, vDist);
        vec2 p = vWorld.xz;

        // --- broad washes -------------------------------------------------
        // Three octaves of very low frequency noise, each pulling the vertex
        // colour toward a sunlit or shaded neighbour. This is what stops the
        // ground reading as one flat fill: it gives the big soft pools of the
        // reference paintings.
        float w1 = vnoise(p * 0.085 + 3.7);
        float w2 = vnoise(p * 0.26 - 8.0);
        float w3 = vnoise(p * 0.72 + 21.0);
        vec3 albedo = vColor;
        float pool = smoothstep(0.34, 0.82, w1 * 0.7 + w3 * 0.3);
        albedo *= mix(0.94, 1.07, pool);
        albedo *= mix(1.06, 0.78, smoothstep(0.50, 0.90, w2));
        albedo *= 0.975 + w3 * 0.05;
        // pools are not just darker, they are a different green: sun-dried
        // yellow-green in the open, blue-green in the shade
        albedo = mix(albedo, albedo * vec3(1.06, 1.02, 0.86), pool * 0.55);
        albedo = mix(albedo, albedo * vec3(0.90, 0.99, 1.10), smoothstep(0.45, 0.9, w2) * 0.45);

        // --- deep shade pools under the canopy ----------------------------
        float shadeN = vnoise(p * 0.055 + 3.7) * 0.62 + vnoise(p * 0.13 - 8.0) * 0.38;
        albedo *= mix(0.58, 1.06, smoothstep(0.26, 0.66, shadeN));

        // --- stroked texture ----------------------------------------------
        float greenish = smoothstep(0.005, 0.075, albedo.g - albedo.r);
        // fall line of the slope: strokes follow it, like a brush pushed downhill
        vec2 slopeDir = normalize(vec2(n.x, n.z) + vec2(0.001, 0.001));
        albedo += groundDetail(p, slopeDir, fade, greenish);

        // --- slopes: bare earth and rock get a darker, cooler wash ---------
        float steep = smoothstep(0.16, 0.55, slope);
        albedo *= mix(1.0, 0.74, steep);
        albedo = mix(albedo, albedo * vec3(0.86, 0.88, 0.96), steep * 0.5);

        // --- painted ground tile -------------------------------------------
        // The brushwork is what makes the ground read as a painting rather than
        // a fill. It rides on top of the washes above, only where grass grows,
        // and fades out with distance so it never turns into noise.
        float gtext = groundPaint(p, fade);
        float grassy = smoothstep(0.02, 0.30, greenish);
        albedo *= 1.0 + gtext * (0.30 * grassy + 0.14 * (1.0 - grassy));
        albedo += vec3(0.012, 0.016, 0.006) * gtext * grassy;

        // --- sun pools: the light breaking through the canopy --------------
        // Big soft warm patches with hard-ish edges. This is the single thing
        // that makes a meadow look painted rather than evenly lit.
        float dap = vnoise(p * 0.085 + 11.0) * 0.62 + vnoise(p * 0.205 - 5.0) * 0.38;
        float sunlit = smoothstep(0.50, 0.84, dap) * (0.45 + 0.55 * n.y);
        albedo += vec3(0.085, 0.082, 0.030) * sunlit * greenish;
        // and the cool shadow side of those pools
        albedo *= 1.0 - 0.10 * smoothstep(0.34, 0.10, dap) * greenish;

        // --- the painting's paper tooth -----------------------------------
        float tooth = vnoise(p * 9.0) * 0.6 + vnoise(p * 3.1) * 0.4;
        albedo *= 0.975 + tooth * 0.05;

        vec3 col = mossLight(albedo, n, vAO);
        col = applyFog(col, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

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
/**
 * Painted river water. The surface carries its own story in `aFoam`: white
 * chutes on the falls, turbulent plunge pools, calm glassy runs. The shader
 * layers depth tone, dragged tree reflections, current lines, sparkles, bank
 * lace and a sky sheen — and it respects the day cycle, so at midnight the
 * river goes dark and moonlit instead of glowing like paper.
 */
export function createWaterMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uDeep: { value: new THREE.Color(0.263, 0.298, 0.208) },
      uShallow: { value: new THREE.Color(0.580, 0.545, 0.345) },
      uFoam: { value: new THREE.Color(0.880, 0.860, 0.700) },
      uStroke: { value: new THREE.Color(0.190, 0.230, 0.150) },
      uSky: { value: new THREE.Color(0.70, 0.68, 0.56) },
      uFlow: { value: opts.flow ?? 0.35 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute float aFoam;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      varying float vFoam;
      void main() {
        vUv = uv;
        vFoam = aFoam;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // gentle swell on the runs; the chutes stay flat and fast
        float calm = 1.0 - clamp(aFoam, 0.0, 1.0);
        wp.y += (sin(wp.x * 0.85 + wp.z * 0.62 + uTime * 1.5) * 0.026
               + sin(wp.x * 1.9 - wp.z * 1.3 - uTime * 2.2) * 0.014) * calm;
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
      uniform vec3 uStroke;
      uniform vec3 uSky;
      uniform float uFlow;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      varying float vFoam;

      vec3 waterLight(vec3 col, float day) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, 1.12);
        col *= 0.52 + 0.58 * day;
        col += vec3(0.008, 0.012, 0.014) * (0.4 + 0.6 * day);
        return col;
      }

      void main() {
        float t = uTime;
        vec2 uv = vUv;
        float foam = clamp(vFoam, 0.0, 1.0);
        float day = 1.0 - uNightMix;
        // white water races: stretch the noise along the flow and run it fast
        float speed = uFlow * (0.5 + foam * 2.6);
        float flow = uv.y - t * speed;

        float edge = min(uv.x, 1.0 - uv.x);
        float depthBand = smoothstep(0.0, 0.16, edge);

        // --- one clean depth wash: pale shoulder, deep midstream
        vec3 col = mix(uShallow, uDeep, depthBand);

        // --- broad swell: two slow octaves, thresholded into painted bands
        float swell = vnoise(vec2(uv.x * 2.2 + 1.3, flow * 1.1)) * 0.65
                    + vnoise(vec2(uv.x * 4.5 - 2.1, flow * 1.9)) * 0.35;
        col = mix(col, uDeep * 0.80, smoothstep(0.62, 0.92, swell) * 0.22 * depthBand);

        // --- long current strokes: a few dark brushes following the flow
        float ln = vnoise(vec2(uv.x * 7.0 + 4.0, flow * 1.3));
        col = mix(col, uStroke, smoothstep(0.58, 0.84, ln) * 0.55 * depthBand * (1.0 - foam * 0.7));

        // --- sky sheen: the pale wash the reference rivers hold midstream
        float sheen = smoothstep(0.52, 0.90, swell * 0.5 + ln * 0.5) * depthBand;
        col = mix(col, uSky * (0.35 + 0.65 * day), sheen * 0.22 * (1.0 - foam));

        // --- cream highlights: sparse, flat, hard-edged like gouache
        float hi = vnoise(vec2(uv.x * 3.5 + 9.0, flow * 1.0));
        col = mix(col, uFoam * (0.55 + 0.55 * day), smoothstep(0.90, 0.985, hi) * 0.30 * depthBand);

        // --- sparkles: tiny and rare; at night they turn to moon glints
        float glint = smoothstep(0.965, 0.999, vnoise(vec2(uv.x * 14.0, flow * 8.0)));
        vec3 glintCol = mix(vec3(0.62, 0.70, 0.82), uFoam, day);
        col += glintCol * glint * (0.18 + 0.24 * day) * depthBand;

        // --- white water: chute and plunge pool boil into foam
        if (foam > 0.01) {
          float vs = vnoise(vec2(uv.x * 6.0 + 3.0, flow * 2.2));
          float vs2 = vnoise(vec2(uv.x * 7.0 + 2.0, flow * 3.5));
          float boil = smoothstep(0.30, 0.80, vs * 0.6 + vs2 * 0.5);
          float amt = foam * (0.42 + 0.58 * boil);
          col = mix(col, uFoam * (0.55 + 0.55 * day), amt);
          col = mix(col, uStroke * 1.05, foam * smoothstep(0.78, 0.98, vs2) * 0.20);
        }

        // --- cream lace along both banks
        float lace = smoothstep(0.055, 0.0, edge) * (0.45 + 0.55 * vnoise(vec2(uv.y * 26.0 - t * 1.2, 3.0)));
        col = mix(col, uFoam * (0.5 + 0.6 * day), clamp(lace, 0.0, 0.6));

        vec3 lit = waterLight(col, day);
        lit = applyFog(lit, vDist);
        gl_FragColor = vec4(lit, uOpacity);
      }
    `,
    transparent: false,
  });
}

// ---------------------------------------------------------------------------
// Splash: the boiling disc sitting in every plunge pool. Radial foam that
// spins slowly and fades to nothing at the rim — replaces the old axis-aligned
// foam rectangles, which read as paper laid on the ground.
// ---------------------------------------------------------------------------
export function createSplashMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uFoam: { value: new THREE.Color(0.83, 0.82, 0.68) },
      uWet: { value: new THREE.Color(0.30, 0.32, 0.22) },
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
      uniform vec3 uFoam;
      uniform vec3 uWet;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float t = uTime;
        float n = vnoise(vec2(p.x * 5.0 + t * 0.7, p.y * 5.0 - t * 0.9)) * 0.6
                + vnoise(vec2(p.x * 11.0 - t * 1.3, p.y * 11.0 + t * 1.1)) * 0.4;
        float body = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.55);
        float boil = smoothstep(0.45, 0.9, n) * body;
        float day = 1.0 - uNightMix;
        vec3 col = mix(uWet, uFoam * (0.5 + 0.6 * day), 0.35 + 0.65 * boil);
        col += uFoam * smoothstep(0.72, 0.98, n) * 0.35 * body;
        float a = body * (0.55 + 0.4 * boil);
        vec3 lit = col * (0.5 + 0.6 * day) + vec3(0.02, 0.025, 0.03);
        lit = applyFog(lit, vDist);
        gl_FragColor = vec4(lit, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}


// ---------------------------------------------------------------------------
// River bed — a slightly wider, darker strip under the ribbon. Without it a
// flat water strip looks like a plank laid on the grass.
// ---------------------------------------------------------------------------
export function createRiverbedMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uWet: { value: new THREE.Color(0.212, 0.231, 0.153) },
      uEdge: { value: new THREE.Color(0.318, 0.290, 0.188) },
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
      uniform vec3 uWet;
      uniform vec3 uEdge;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vDist;
      void main() {
        float edge = min(vUv.x, 1.0 - vUv.x);
        float mid = smoothstep(0.0, 0.35, edge);
        vec3 col = mix(uEdge, uWet, mid);
        float wet = vnoise(vWorld.xz * 6.0 + uTime * 0.05);
        col *= 0.86 + wet * 0.24;
        // pebbles catching light at the waterline
        float pebble = smoothstep(0.82, 0.98, vnoise(vWorld.xz * 22.0));
        col += vec3(0.16, 0.155, 0.12) * pebble * (1.0 - mid * 0.6);
        vec3 lit = mossLight(col, normalize(vec3(0.0, 1.0, 0.0)), 0.62);
        lit = applyFog(lit, vDist);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Leaf cards — instanced, camera-facing painted quads layered over the solid
// crowns. This is where the scalloped, brushy silhouette comes from.
// ---------------------------------------------------------------------------
export function createLeafCardMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...commonUniforms(),
      uMap: { value: opts.texture || null },
      uBrightness: { value: opts.brightness ?? 1 },
      uAlphaTest: { value: opts.alphaTest ?? 0.42 },
      uSway: { value: opts.sway ?? 0.06 },
    },
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0,
    depthWrite: true,
    vertexShader: /* glsl */`
      attribute vec3 aOffset;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform vec2 uWindDir;
      uniform vec3 uCamRight;
      uniform float uWindStrength;
      uniform float uSway;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vDist;
      varying float vPhase;

      void main() {
        vUv = uv;
        vPhase = aPhase;
        // card centre in world space
        vec4 centre = instanceMatrix * vec4(aOffset, 1.0);
        centre = modelMatrix * centre;
        float scl = length(instanceMatrix[0].xyz);

        // billboard: the camera never rotates, so right/up are constants
        vec3 right = uCamRight;
        vec3 upv = vec3(0.0, 1.0, 0.0);
        float rot = aPhase * 0.35;
        float cs = cos(rot), sn = sin(rot);
        vec2 corner = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs);
        float s = position.z * aSize * scl;

        // slow leaf flutter, one phase per card
        float gust = sin(uTime * 0.6 + centre.x * 0.11 + centre.z * 0.09) * 0.5 + 0.5;
        vec3 swayDir = vec3(uWindDir.x, 0.0, uWindDir.y);
        float flutter = sin(uTime * 1.7 + aPhase * 6.2831 + centre.y) * uSway * (0.4 + gust);

        vec3 wp = centre.xyz + right * corner.x * s + upv * corner.y * s * 0.92;
        wp += swayDir * flutter * (0.5 + corner.y * 0.5);
        vWorld = wp;
        vNormalW = normalize(vec3(0.30, 0.86, 0.41));
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: COMMON_GLSL + /* glsl */`
      uniform sampler2D uMap;
      uniform float uBrightness;
      uniform float uAlphaTest;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying float vDist;
      varying float vPhase;

      void main() {
        vec4 tex = texture2D(uMap, vUv);
        if (tex.a < uAlphaTest) discard;
        vec3 albedo = tex.rgb;
        // a little sun-side lift so cards are not flat stamps
        float lift = smoothstep(0.2, 0.9, vUv.y) * 0.16 + vPhase * 0.06;
        albedo *= uBrightness + lift;
        vec3 n = normalize(vNormalW);
        // soft self-shading across the card face
        float ao = 0.72 + 0.28 * smoothstep(0.15, 0.85, vUv.y);
        vec3 col = mossLight(albedo, n, ao);
        // alpha-to-coverage-ish softening: blend the edge toward the card colour
        col = mix(col, col * 0.86, (1.0 - smoothstep(uAlphaTest, uAlphaTest + 0.25, tex.a)));
        col = applyFog(col, vDist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
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
    side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
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
