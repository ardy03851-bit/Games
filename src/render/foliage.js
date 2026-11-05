/**
 * FoliageField — one instanced mesh per sprite type.
 *
 * Two card modes:
 *   billboard  · cylindrical billboard around Y (the camera yaw never changes,
 *                so a billboard reads as a painted sprite from every angle)
 *   ground     · flat card lying in XZ, used for pine fronds
 *
 * Every instance carries its own wind phase, sway amplitude and tint, so a
 * bush is never one rigid object: each leaf cluster buffers its own motion.
 */
import * as THREE from 'three';
import { createCardMaterial } from './materials.js';

export class FoliageField {
  constructor({ texture, billboard = true, sway = 1, alphaCut = 0.45, occlude = 1, brightness = 1, droop = 0.2, name = 'foliage' }) {
    this.droop = droop;
    this.texture = texture;
    this.billboard = billboard;
    this.sway = sway;
    this.alphaCut = alphaCut;
    this.occlude = occlude;
    this.brightness = brightness;
    this.name = name;
    this.items = [];
    this.mesh = null;
    this.activeImpulses = false;
  }

  add(pos, scale, opts = {}) {
    this.items.push({
      x: pos.x, y: pos.y, z: pos.z,
      sx: scale.sx ?? scale.s ?? 1,
      sy: scale.sy ?? scale.s ?? 1,
      rot: opts.rot ?? 0,
      phase: opts.phase ?? Math.random() * Math.PI * 2,
      sway: opts.sway ?? 1,
      tint: opts.tint ?? [1, 1, 1],
      lean: opts.lean ?? 0,
      impulse: 0,
    });
    return this.items.length - 1;
  }

  build(scene) {
    const count = this.items.length;
    if (!count) return null;

    const base = new THREE.PlaneGeometry(1, 1, 2, 2);
    if (this.billboard) {
      base.translate(0, 0.5, 0);
    } else {
      base.rotateX(-Math.PI / 2);
      // fronds hang: outer edge droops, so pine skirts catch the light properly
      const bp = base.getAttribute('position');
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i), z = bp.getZ(i);
        const r = Math.hypot(x, z) * 2;
        bp.setY(i, bp.getY(i) - this.droop * r * r);
      }
      base.computeVertexNormals();
    }

    const geo = base;

    const params = new Float32Array(count * 4);
    const tints = new Float32Array(count * 3);
    const impulses = new Float32Array(count);
    const matrices = new Float32Array(count * 16);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const it = this.items[i];
      v.set(it.x, it.y, it.z);
      s.set(it.sx, it.sy, it.sx);
      if (this.billboard) q.identity();
      else q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
      m.compose(v, q, s);
      m.toArray(matrices, i * 16);
      params[i * 4] = it.phase;
      params[i * 4 + 1] = it.sway;
      params[i * 4 + 2] = 0;
      params[i * 4 + 3] = it.lean;
      tints[i * 3] = it.tint[0];
      tints[i * 3 + 1] = it.tint[1];
      tints[i * 3 + 2] = it.tint[2];
      impulses[i] = 0;
    }

    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    this.impulseAttr = new THREE.InstancedBufferAttribute(impulses, 1);
    geo.setAttribute('aImpulse', this.impulseAttr);

    const mat = createCardMaterial(this.texture, {
      billboard: this.billboard,
      alphaCut: this.alphaCut,
      dither: 1.0,
      sway: this.sway,
      occlude: this.occlude,
      brightness: this.brightness,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = this.name;
    this.mesh = mesh;
    this.impulseData = impulses;
    scene.add(mesh);
    return mesh;
  }

  /** Kick one or more instances (used when the player gathers from a plant). */
  impulse(indices, strength = 1) {
    for (const i of indices) {
      if (i >= 0 && i < this.impulseData.length) {
        this.impulseData[i] = Math.max(this.impulseData[i], strength);
        this.activeImpulses = true;
      }
    }
  }

  update(dt) {
    if (!this.activeImpulses || !this.impulseAttr) return;
    let any = false;
    const data = this.impulseData;
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 0.001) {
        data[i] *= Math.exp(-3.4 * dt);
        any = true;
      } else if (data[i] !== 0) {
        data[i] = 0;
      }
    }
    this.impulseAttr.needsUpdate = true;
    if (!any) this.activeImpulses = false;
  }
}

/** Load the painted sprites once; resolves to a name → texture map. */
export function loadSpriteTextures(paths, onProgress) {
  const loader = new THREE.TextureLoader();
  const names = Object.keys(paths);
  let done = 0;
  return Promise.all(names.map((name) => new Promise((resolve) => {
    loader.load(paths[name], (tex) => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      done += 1;
      onProgress?.(done / names.length);
      resolve([name, tex]);
    }, undefined, () => {
      done += 1;
      onProgress?.(done / names.length);
      resolve([name, null]);
    });
  }))).then((entries) => Object.fromEntries(entries.filter(([, t]) => t)));
}
