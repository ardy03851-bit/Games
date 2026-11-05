/**
 * Engine: renderer, fixed-angle camera, adaptive quality and the frame loop.
 *
 * The camera is deliberately locked: one yaw, one pitch, no orbit, no zoom.
 * The game is designed to be read exactly one way, like the reference art.
 */
import * as THREE from 'three';
import { shared, clamp } from './shared.js';
import { PostFX } from '../render/postfx.js';

export const CAMERA = {
  fov: 26,
  elevation: 0.985,   // radians above the horizon — fixed
  distance: 43,
  lookAhead: 2.4,
  followLerp: 7.5,
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.frameSamples = [];
    this.quality = 2;
    this.upgradeTimer = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x6b6f5c, 1);
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0.62, 0.63, 0.52);
    this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 420);
    this.camera.position.set(0, 44, 34);
    this.camera.lookAt(0, 0, 0);

    // the painterly repaint pass: created once the scene exists
    this.postfx = null;
    this.usePostFX = true;

    this.target = new THREE.Vector3(0, 0, 0);
    this.desiredTarget = new THREE.Vector3(0, 0, 0);
    this.shake = 0;
    this.shakeSeed = Math.random() * 100;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));

    this.detectQuality();
    this.resize();
    this.initPostFX();
  }

  detectQuality() {
    const ua = navigator.userAgent || '';
    const mobile = /iPad|iPhone|iPod|Android|Mobile/i.test(ua) ||
      (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 1000);
    const small = Math.min(screen.width, screen.height) <= 430;
    this.quality = mobile ? (small ? 1 : 2) : 2;
    this.quality = mobile && small ? 1 : this.quality;
    // iPad-class devices are the primary target: medium defaults, then adapt
    if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) this.quality = 2;
    this.mobile = mobile;
  }

  setQuality(level) {
    this.quality = clamp(level, 0, 2);
    this.postfx?.setQuality(this.quality);
    this.resize();
  }

  initPostFX() {
    if (!this.usePostFX || this.postfx) return;
    try {
      this.postfx = new PostFX(this.renderer, this.scene, this.camera, { quality: this.quality });
      this.postfx.setQuality(this.quality);
      const dpr = this.dprForQuality();
      this.postfx.setSize(window.innerWidth * dpr, window.innerHeight * dpr);
    } catch (err) {
      console.warn('post-processing unavailable, falling back to direct rendering', err);
      this.postfx = null;
      this.usePostFX = false;
    }
  }

  dprForQuality() {
    const raw = window.devicePixelRatio || 1;
    if (this.quality <= 0) return Math.min(raw, 1.15);
    if (this.quality === 1) return Math.min(raw, 1.5);
    return Math.min(raw, 2);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = this.dprForQuality();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';

    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    // keep a consistent amount of the world on screen from phone to desktop
    const fit = clamp(1.62 / this.aspect, 0.82, 1.55);
    this.camera.fov = CAMERA.fov * clamp(1.05 / Math.max(0.6, Math.min(1.3, this.aspect)), 0.94, 1.22);
    this.distance = CAMERA.distance * fit;
    this.camera.updateProjectionMatrix();

    shared.uResolution.value.set(w * dpr, h * dpr);
    if (this.postfx) {
      this.postfx.setQuality(this.quality);
      this.postfx.setSize(w * dpr, h * dpr);
    }
    this.applyCamera(true);
  }

  applyCamera(snap = false) {
    const t = this.target;
    const elev = CAMERA.elevation;
    const d = this.distance;
    const cx = t.x + Math.sin(this.shakeSeed) * this.shake;
    const cz = t.z + Math.cos(this.shakeSeed * 1.7) * this.shake;
    const cy = t.y + Math.sin(elev) * d;
    const czz = t.z + Math.cos(elev) * d;
    if (snap) {
      this.camera.position.set(cx, cy, czz);
    } else {
      const k = 1 - Math.exp(-CAMERA.followLerp * (1 / 60));
      this.camera.position.x += (cx - this.camera.position.x) * k;
      this.camera.position.y += (cy - this.camera.position.y) * k;
      this.camera.position.z += (czz - this.camera.position.z) * k;
    }
    this.camera.lookAt(t.x, t.y + 0.6 - CAMERA.lookAhead, t.z);
    this.camera.updateMatrixWorld();
    shared.uCamRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    shared.uViewDir.value.subVectors(this.camera.position, t).normalize();
  }

  follow(point, dt, instant = false) {
    this.desiredTarget.copy(point);
    if (instant) {
      this.target.copy(point);
      this.applyCamera(true);
      return;
    }
    const k = 1 - Math.exp(-CAMERA.followLerp * dt);
    this.target.x += (this.desiredTarget.x - this.target.x) * k;
    this.target.y += (this.desiredTarget.y - this.target.y) * k;
    this.target.z += (this.desiredTarget.z - this.target.z) * k;
    this.shake *= Math.exp(-9 * dt);
    this.applyCamera(false);
  }

  addShake(amount) {
    this.shake = Math.min(0.55, this.shake + amount);
  }

  /** Convert a client-space point into a ray against the terrain plane. */
  pointerRay(clientX, clientY) {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster.ray;
  }

  worldToScreen(v3) {
    const p = v3.clone().project(this.camera);
    return {
      x: (p.x * 0.5 + 0.5) * window.innerWidth,
      y: (-p.y * 0.5 + 0.5) * window.innerHeight,
      visible: p.z < 1,
    };
  }

  /** Rolling frame-time monitor; nudges the quality tier up or down. */
  monitor(dtMs) {
    this.frameSamples.push(dtMs);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    if (this.frameSamples.length < 60) return;
    let sum = 0;
    for (const s of this.frameSamples) sum += s;
    const avg = sum / this.frameSamples.length;
    this.avgFrame = avg;
    if (avg > 26 && this.quality > 0) {
      this.setQuality(this.quality - 1);
      this.frameSamples.length = 0;
      this.upgradeTimer = 0;
    } else if (avg < 13 && this.quality < 2) {
      this.upgradeTimer += 1;
      if (this.upgradeTimer > 240) {
        this.setQuality(this.quality + 1);
        this.frameSamples.length = 0;
        this.upgradeTimer = 0;
      }
    }
  }

  render() {
    if (this.postfx) {
      try {
        this.postfx.render(this.time);
        if (!this.postfxChecked) this.verifyPostFX();
      } catch (err) {
        console.warn('post-processing failed, drawing directly', err);
        this.postfx.dispose?.();
        this.postfx = null;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Safety net. A shader that fails to compile does not throw — it silently
   * draws nothing, which on an iPad looks exactly like a broken game. So on the
   * first frame we compare a direct render with the repainted one and drop the
   * effect if it came back black.
   */
  verifyPostFX() {
    this.postfxChecked = true;
    const gl = this.renderer.getContext?.();
    if (!gl || !gl.readPixels) return;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const sample = () => {
      const pts = [[0.5, 0.5], [0.3, 0.35], [0.7, 0.4], [0.5, 0.75]];
      const buf = new Uint8Array(4);
      let sum = 0;
      for (const [fx, fy] of pts) {
        gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        sum += (buf[0] + buf[1] + buf[2]) / 3;
      }
      return sum / pts.length;
    };
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    const direct = sample();
    this.postfx.render(this.time);
    const painted = sample();
    if (!(direct > 6) || painted < direct * 0.22) {
      console.warn(`post-processing disabled (direct ${direct.toFixed(1)} → painted ${painted.toFixed(1)})`);
      this.postfx.dispose?.();
      this.postfx = null;
      this.renderer.render(this.scene, this.camera);
    }
  }
}

/**
 * Atmosphere: a slow day cycle that repaints sun colour, ambient, haze and the
 * fireflies. Sun *direction* stays fixed so the baked shadows keep reading.
 */
const KEYS = [
  { t: 0.00, sun: [0.30, 0.38, 0.50], amb: [0.11, 0.15, 0.21], fog: [0.13, 0.18, 0.24], night: 1.0, exp: 0.30 },
  { t: 0.20, sun: [0.86, 0.58, 0.46], amb: [0.26, 0.26, 0.32], fog: [0.55, 0.47, 0.46], night: 0.55, exp: 0.65 },
  { t: 0.30, sun: [0.95, 0.90, 0.76], amb: [0.40, 0.43, 0.41], fog: [0.72, 0.73, 0.65], night: 0.05, exp: 1.0 },
  { t: 0.48, sun: [0.98, 0.95, 0.85], amb: [0.42, 0.45, 0.42], fog: [0.75, 0.77, 0.69], night: 0.0, exp: 1.0 },
  { t: 0.64, sun: [0.96, 0.87, 0.70], amb: [0.40, 0.42, 0.39], fog: [0.69, 0.66, 0.55], night: 0.0, exp: 1.0 },
  { t: 0.76, sun: [0.92, 0.74, 0.55], amb: [0.33, 0.34, 0.35], fog: [0.61, 0.55, 0.48], night: 0.25, exp: 0.95 },
  { t: 0.86, sun: [0.62, 0.44, 0.42], amb: [0.18, 0.20, 0.26], fog: [0.33, 0.30, 0.32], night: 0.8, exp: 0.75 },
  { t: 1.00, sun: [0.30, 0.38, 0.50], amb: [0.11, 0.15, 0.21], fog: [0.13, 0.18, 0.24], night: 1.0, exp: 0.30 },
];

export class Atmosphere {
  constructor(engine, startT = 0.64) {
    this.engine = engine;
    this.t = startT;
    this.speed = 1 / 620;   // full day ≈ 10 minutes
    this.sun = new THREE.Color();
    this.amb = new THREE.Color();
    this.fog = new THREE.Color();
    this.night = 0;
    this.exposure = 1;
    this.listeners = [];
    this.apply();
  }

  sample(t) {
    t = ((t % 1) + 1) % 1;
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const span = Math.max(1e-4, b.t - a.t);
    const f = clamp((t - a.t) / span, 0, 1);
    const mixv = (x, y) => [x[0] + (y[0] - x[0]) * f, x[1] + (y[1] - x[1]) * f, x[2] + (y[2] - x[2]) * f];
    return {
      sun: mixv(a.sun, b.sun),
      amb: mixv(a.amb, b.amb),
      fog: mixv(a.fog, b.fog),
      night: a.night + (b.night - a.night) * f,
      exp: a.exp + (b.exp - a.exp) * f,
    };
  }

  update(dt) {
    this.t = (this.t + dt * this.speed) % 1;
    this.apply();
  }

  apply() {
    const s = this.sample(this.t);
    this.sun.setRGB(s.sun[0], s.sun[1], s.sun[2]);
    this.amb.setRGB(s.amb[0], s.amb[1], s.amb[2]);
    this.fog.setRGB(s.fog[0], s.fog[1], s.fog[2]);
    this.night = s.night;
    this.exposure = s.exp;

    shared.uSunColor.value.copy(this.sun);
    shared.uAmbient.value.copy(this.amb);
    shared.uFogColor.value.copy(this.fog);
    shared.uNightMix.value = this.night;
    this.engine.scene.background.copy(this.fog).multiplyScalar(0.94);
    for (const fn of this.listeners) fn(this);
  }

  get label() {
    const t = this.t;
    if (t < 0.17 || t > 0.9) return 'Midnight';
    if (t < 0.26) return 'Dawn';
    if (t < 0.36) return 'Morning';
    if (t < 0.56) return 'Afternoon';
    if (t < 0.72) return 'Golden hour';
    if (t < 0.82) return 'Dusk';
    return 'Nightfall';
  }
}
