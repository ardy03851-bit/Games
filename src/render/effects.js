/**
 * Atmosphere particles: fireflies that only come out at dusk, mist that hangs
 * under the waterfalls, dust puffs under the cube's feet, wood chips when a
 * tree is tapped, and chimney smoke.
 */
import * as THREE from 'three';
import { shared, PALETTE } from '../core/shared.js';

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.72)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class Fireflies {
  constructor(scene, world, count = 260) {
    this.world = world;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0, y = 0, tries = 0;
      do {
        x = (Math.random() * 2 - 1) * world.size * 0.42;
        z = (Math.random() * 2 - 1) * world.size * 0.42;
        y = world.heightAt(x, z) + 0.4 + Math.random() * 2.6;
        tries++;
      } while (world.fieldAt(world.riverMask, x, z) > 0.3 && tries < 8);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uNightMix: shared.uNightMix,
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uColor: { value: new THREE.Color(PALETTE.firefly[0], PALETTE.firefly[1], PALETTE.firefly[2]) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uNightMix;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * 0.32 + aSeed.x * 6.283;
          p.x += sin(t * 1.23 + aSeed.y * 8.0) * 1.1;
          p.y += sin(t * 0.87 + aSeed.z * 6.0) * 0.55 + sin(uTime * 0.4 + aSeed.x * 9.0) * 0.3;
          p.z += cos(t * 1.07 + aSeed.x * 5.0) * 1.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          gl_PointSize = clamp((5.0 + aSeed.y * 5.0) * uPixelRatio * (18.0 / max(dist, 1.0)), 1.0, 22.0);
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.1 + aSeed.z * 2.2) + aSeed.x * 20.0), 2.0);
          float fade = smoothstep(0.0, 0.22, uNightMix) * (1.0 - smoothstep(0.75, 1.0, uNightMix * 0.2));
          vAlpha = twinkle * uNightMix;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.05, d);
          a = pow(a, 1.6);
          gl_FragColor = vec4(uColor * a * vAlpha * 1.5, a * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }

  setPixelRatio(r) {
    this.material.uniforms.uPixelRatio.value = r;
  }
}

export class Mist {
  constructor(scene, world) {
    const falls = world.waterPieces.falls;
    const tex = softDotTexture();
    const count = Math.max(1, falls.length) * 26;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 3);
    let i = 0;
    for (const f of falls) {
      for (let k = 0; k < 26; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * f.width * 1.9;
        positions[i * 3] = f.x + Math.cos(a) * r;
        positions[i * 3 + 1] = f.bottomY + Math.random() * 3.4;
        positions[i * 3 + 2] = f.z + Math.sin(a) * r + 0.6;
        seeds[i * 3] = Math.random();
        seeds[i * 3 + 1] = Math.random();
        seeds[i * 3 + 2] = Math.random();
        i++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uNightMix: shared.uNightMix,
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uColor: { value: new THREE.Color(0.94, 0.91, 0.78) },
        uMap: { value: tex },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          vec3 p = position;
          float t = uTime * 0.18 + aSeed.x * 6.283;
          p.x += sin(t + aSeed.y * 5.0) * 0.9;
          p.y += sin(t * 0.7 + aSeed.z * 4.0) * 0.7 + mod(uTime * 0.22 + aSeed.y, 1.6) * 0.8;
          p.z += cos(t * 0.8 + aSeed.x * 3.0) * 0.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp((26.0 + aSeed.y * 26.0) * uPixelRatio * (20.0 / max(-mv.z, 1.0)), 2.0, 190.0);
          gl_Position = projectionMatrix * mv;
          float pulse = 0.5 + 0.5 * sin(uTime * 0.6 + aSeed.z * 8.0);
          vAlpha = 0.10 + pulse * 0.12;
          vSeed = aSeed.y;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uNightMix;
        uniform sampler2D uMap;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(uColor, a * vAlpha * (1.0 - uNightMix * 0.35));
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
}

/** CPU particle pool for dust, chips, smoke and leaves. */
export class PuffPool {
  constructor(scene, capacity = 420) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setDrawRange(0, capacity);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uMap: { value: softDotTexture() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * uPixelRatio * (26.0 / max(-mv.z, 1.0)), 0.0, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.002) discard;
          float a = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(p, opts = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = opts.vx ?? 0;
    this.vel[i * 3 + 1] = opts.vy ?? 0.4;
    this.vel[i * 3 + 2] = opts.vz ?? 0;
    const c = opts.color || [0.7, 0.65, 0.5];
    this.col[i * 3] = c[0];
    this.col[i * 3 + 1] = c[1];
    this.col[i * 3 + 2] = c[2];
    this.size[i] = opts.size ?? 0.5;
    this.life[i] = opts.life ?? 1.0;
    this.maxLife[i] = opts.life ?? 1.0;
    this.gravity[i] = opts.gravity ?? -0.4;
    this.alpha[i] = opts.alpha ?? 0.9;
  }

  update(dt) {
    let active = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) { this.alpha[i] = 0; active = true; }
        continue;
      }
      this.life[i] -= dt;
      active = true;
      this.vel[i * 3 + 1] += this.gravity[i] * dt;
      this.vel[i * 3] *= 0.985;
      this.vel[i * 3 + 2] *= 0.985;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t * t * 0.9;
      this.size[i] += dt * 0.35;
    }
    if (active) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}
