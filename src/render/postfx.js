/**
 * Painterly post-processing.
 *
 * The reference paintings are made of a few flat washes of colour with soft,
 * slightly smeared edges, a visible canvas tooth and a warm halo around every
 * light. Raw WebGL output is none of those things: it is crisp, faceted and
 * evenly lit. This module renders the world into a texture and then repaints
 * it, in four cheap passes:
 *
 *   1. bright pass        – quarter-res copy of everything that glows
 *   2. two blur passes    – separable gaussian, gives lights a painted halo
 *   3. composite          – brush-direction smear, soft posterisation, canvas
 *                           tooth, split-tone grade, vignette
 *
 * Everything runs at a fraction of device resolution so an iPad keeps its
 * frame rate; the smear hides the reduction.
 */
import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMMON = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

const BRIGHT = /* glsl */ `
  uniform sampler2D tScene;
  uniform vec2 uTexel;
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  ${COMMON}
  void main() {
    // four taps: the quarter-res copy averages instead of aliasing
    vec3 c = texture2D(tScene, vUv + uTexel * vec2(-0.5, -0.5)).rgb;
    c += texture2D(tScene, vUv + uTexel * vec2(0.5, -0.5)).rgb;
    c += texture2D(tScene, vUv + uTexel * vec2(-0.5, 0.5)).rgb;
    c += texture2D(tScene, vUv + uTexel * vec2(0.5, 0.5)).rgb;
    c *= 0.25;
    float l = luma(c);
    float w = smoothstep(uThreshold, uThreshold + uKnee, l);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uDir;      // texel-sized step
  varying vec2 vUv;
  void main() {
    vec3 sum = texture2D(tSrc, vUv).rgb * 0.2270270270;
    sum += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    sum += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    sum += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    sum += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tGlow;
  uniform vec2  uRes;        // scene pixel size
  uniform float uTime;
  uniform float uFlat;       // how hard the colour gets posterised
  uniform float uSmear;      // brush-direction smear
  uniform float uGrain;      // canvas tooth
  uniform float uGlow;
  uniform float uVignette;
  uniform float uWarm;
  uniform float uExposure;
  uniform vec3  uLift;       // shadow tint
  uniform vec3  uGain;       // highlight tint
  varying vec2 vUv;
  ${COMMON}

  void main() {
    vec2 texel = 1.0 / uRes;
    vec3 base = texture2D(tScene, vUv).rgb;

    // ---- brush smear: 5 taps along one diagonal, edge-aware -----------------
    // The reference art is painted with one brush direction, so sampling along
    // a fixed axis softens the polygon facets without smearing silhouettes.
    vec2 dir = normalize(vec2(0.86, 0.51));
    float lb = luma(base);
    vec3 acc = base * 0.30;
    float wsum = 0.30;
    for (int i = 0; i < 4; i++) {
      float o = (float(i) + 1.0) * 1.45;
      vec2 off = dir * texel * o;
      vec3 a = texture2D(tScene, vUv + off).rgb;
      vec3 b = texture2D(tScene, vUv - off).rgb;
      float w = 0.22 - float(i) * 0.035;
      // only blend neighbours of similar brightness: keeps trunks and edges
      float wa = w * (1.0 - smoothstep(0.045, 0.26, abs(luma(a) - lb)));
      float wb = w * (1.0 - smoothstep(0.045, 0.26, abs(luma(b) - lb)));
      acc += a * wa + b * wb;
      wsum += wa + wb;
    }
    vec3 c = mix(base, acc / wsum, uSmear);

    // ---- soft posterisation: big flat washes, no visible banding ------------
    float l = luma(c);
    float bands = 13.0;
    float q = floor(l * bands + 0.5) / bands;
    float target = q / max(l, 0.0008);
    c = mix(c, c * clamp(target, 0.55, 1.75), uFlat);

    // ---- canvas tooth -------------------------------------------------------
    float tooth = vnoise(vUv * uRes * 0.55) * 0.62 + vnoise(vUv * uRes * 1.7 + 31.0) * 0.38;
    float weave = sin(vUv.x * uRes.x * 0.62) * sin(vUv.y * uRes.y * 0.78);
    c *= 1.0 + (tooth - 0.5) * uGrain + weave * uGrain * 0.08;
    // a few dried-brush flecks that sit in the paint rather than on top of it
    float fleck = smoothstep(0.86, 1.0, vnoise(vUv * uRes * 0.17 + 9.0));
    c = mix(c, c * 1.12, fleck * 0.30);

    // ---- glow: lights get a painted halo -----------------------------------
    vec3 glow = texture2D(tGlow, vUv).rgb;
    c += glow * uGlow;
    c += glow * glow * uGlow * 0.85;

    // ---- split-tone grade ---------------------------------------------------
    c *= uExposure;
    float l2 = clamp(luma(c), 0.0, 1.0);
    c = mix(c, c * uLift, (1.0 - smoothstep(0.02, 0.42, l2)) * 0.75);
    c = mix(c, c * uGain, smoothstep(0.45, 1.0, l2) * 0.85);
    // gentle S-curve instead of a hard contrast. The curve is only valid on
    // [0,1]: HDR pixels (lantern glass, sunlit foam) would otherwise fold
    // per-channel into impossible hues, so shoulder them into range first.
    c = min(c, vec3(1.0));
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
    // pull saturation toward the painting's muted greens
    float g = dot(c, vec3(0.3333));
    c = mix(vec3(g), c, 0.98);
    c *= uWarm;

    // ---- vignette -----------------------------------------------------------
    float r = length((vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
    c *= 1.0 - uVignette * smoothstep(0.34, 1.12, r);

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

export class PostFX {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = opts.quality ?? 2;
    this.width = 2;
    this.height = 2;
    this.scale = 1;

    const halfFloat = renderer.capabilities?.isWebGL2 !== false;
    const type = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    };

    this.rtScene = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtGlowA = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: false, type: THREE.UnsignedByteType });
    this.rtGlowB = new THREE.WebGLRenderTarget(2, 2, { ...rtOpts, depthBuffer: false, type: THREE.UnsignedByteType });

    const quad = new THREE.PlaneGeometry(2, 2);
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(quad, null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BRIGHT,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uThreshold: { value: 0.66 },
        uKnee: { value: 0.30 },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR,
      uniforms: {
        tSrc: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.compMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        tGlow: { value: this.rtGlowB.texture },
        uRes: { value: new THREE.Vector2(2, 2) },
        uTime: { value: 0 },
        uFlat: { value: 0.30 },
        uSmear: { value: 0.58 },
        uGrain: { value: 0.05 },
        uGlow: { value: 0.34 },
        uVignette: { value: 0.36 },
        uWarm: { value: 1.0 },
        uExposure: { value: 0.95 },
        uLift: { value: new THREE.Color(0.90, 1.00, 1.06) },
        uGain: { value: new THREE.Color(1.05, 1.0, 0.93) },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  setQuality(level) {
    this.quality = level;
    this.scale = level >= 2 ? 0.92 : level === 1 ? 0.8 : 0.7;
    this.compMat.uniforms.uSmear.value = level >= 2 ? 0.52 : 0.46;
    this.compMat.uniforms.uGrain.value = level >= 2 ? 0.05 : 0.04;
    this.setSize(this.width, this.height);
  }

  setSize(w, h) {
    this.width = Math.max(2, Math.floor(w));
    this.height = Math.max(2, Math.floor(h));
    const s = this.scale;
    const sw = Math.max(2, Math.floor(this.width * s));
    const sh = Math.max(2, Math.floor(this.height * s));
    this.rtScene.setSize(sw, sh);
    this.rtGlowA.setSize(Math.max(2, sw >> 2), Math.max(2, sh >> 2));
    this.rtGlowB.setSize(Math.max(2, sw >> 2), Math.max(2, sh >> 2));
    this.compMat.uniforms.uRes.value.set(sw, sh);
    this.brightMat.uniforms.uTexel.value.set(2 / sw, 2 / sh);
  }

  /** Copy of the render-target size so the engine can keep DPR honest. */
  get targetSize() {
    return { width: this.rtScene.width, height: this.rtScene.height };
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(time = 0) {
    const r = this.renderer;
    // 1. the world
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

    // 2. glow
    this.pass(this.brightMat, this.rtGlowA);
    const gw = this.rtGlowA.width;
    const gh = this.rtGlowA.height;
    this.blurMat.uniforms.tSrc.value = this.rtGlowA.texture;
    this.blurMat.uniforms.uDir.value.set(1.6 / gw, 0);
    this.pass(this.blurMat, this.rtGlowB);
    this.blurMat.uniforms.tSrc.value = this.rtGlowB.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1.6 / gh);
    this.pass(this.blurMat, this.rtGlowA);
    this.compMat.uniforms.tGlow.value = this.rtGlowA.texture;

    // 3. repaint
    this.compMat.uniforms.uTime.value = time;
    this.pass(this.compMat, null);
    r.setRenderTarget(null);
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtGlowA, this.rtGlowB]) rt.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
  }
}
