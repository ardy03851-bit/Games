/**
 * Vegetation — every plant in the world, scattered as instanced geometry.
 *
 * Nothing here is a textured card: grass is a fan of painted blades, a bush is
 * a dark core wrapped in leaf lobes, a broadleaf crown is a stack of painted
 * lobes with bright dabs around the rim, and a pine is a tower of jagged needle
 * skirts. Each clump carries its own wind phase, so the whole forest breathes
 * subtly instead of swaying in lockstep.
 */
import * as THREE from 'three';
import { PALETTE, WORLD } from '../terrain/terrain.js';
import { QUALITY } from '../core/shared.js';
import { createInstancedSolidMaterial } from './materials.js';
import {
  rockGeometry, rockCapGeometry, trunkGeometry, logGeometry, stumpGeometry,
} from './propsGeo.js';
import {
  grassTuftGeometry, fernGeometry, bushGeometry, canopyGeometry,
  pineGeometry, mushroomGeometry,
} from './plants.js';

const P = PALETTE;

/** Collects instance transforms for the faceted "solid" props. */
class SolidBatch {
  constructor(geometry, material, name) {
    this.geometry = geometry;
    this.material = material;
    this.name = name;
    this.items = [];
  }
  add(pos, scale, quat = null, wind = null) {
    this.items.push({ pos, scale, quat: quat || new THREE.Quaternion(), wind: wind || [0, 0] });
  }
  build(scene) {
    if (!this.items.length) return null;
    const count = this.items.length;
    const geo = this.geometry.clone();
    const wind = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      wind[i * 2] = this.items[i].wind[0];
      wind[i * 2 + 1] = this.items[i].wind[1];
    }
    geo.setAttribute('aWind', new THREE.InstancedBufferAttribute(wind, 2));
    const mesh = new THREE.InstancedMesh(geo, this.material, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const it = this.items[i];
      m.compose(it.pos, it.quat, it.scale);
      m.toArray(mesh.instanceMatrix.array, i * 16);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = this.name;
    scene.add(mesh);
    return mesh;
  }
}

const TWO_PI = Math.PI * 2;

export class Vegetation {
  constructor(scene, world, textures) {
    this.scene = scene;
    this.world = world;
    this.tex = textures;          // kept for API compatibility; unused
    this.meshes = [];
    this.nodes = { trees: [], rocks: [], bushes: [], logs: [] };
    this.build();
  }

  build() {
    const { world } = this;
    const props = world.props;
    const leafMat = createInstancedSolidMaterial({ doubleSide: true });
    const solidMat = createInstancedSolidMaterial();
    const shadowItems = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const rnd = (a, b) => a + Math.random() * (b - a);

    // ------------------------------------------------------------ grass tufts
    const tuftGeos = [
      grassTuftGeometry({ blades: 4, height: 0.58, spread: 0.15, seed: 2 }),
      grassTuftGeometry({ blades: 5, height: 0.46, spread: 0.12, seed: 7 }),
      grassTuftGeometry({ blades: 3, height: 0.72, spread: 0.17, seed: 13 }),
    ];
    const tuftBatches = tuftGeos.map((g, i) => new SolidBatch(g, leafMat, `grass${i}`));
    // the grass carpet is the biggest vertex budget: thin it on weak devices
    const clumps = QUALITY.level >= 2 ? 3 : QUALITY.level === 1 ? 2 : 1;
    for (const t of props.tufts) {
      for (let k = 0; k < clumps; k++) {
        e.set(0, rnd(0, TWO_PI), 0);
        q.setFromEuler(e);
        const s = (0.72 + t.scale * 0.66) * (k === 0 ? 1.0 : 0.65 + Math.random() * 0.45);
        const ox = k === 0 ? 0 : rnd(-0.42, 0.42);
        const oz = k === 0 ? 0 : rnd(-0.42, 0.42);
        tuftBatches[((t.hue * 3) | 0) % 3].add(
          new THREE.Vector3(t.x + ox, t.y - 0.04, t.z + oz),
          new THREE.Vector3(s, s * rnd(0.9, 1.35), s),
          q.clone(),
          [rnd(0, TWO_PI), 0.03 + t.scale * 0.025],
        );
      }
    }

    // ---------------------------------------------------------------- ferns
    const fernGeos = [fernGeometry(2), fernGeometry(9)];
    const fernBatches = fernGeos.map((g, i) => new SolidBatch(g, leafMat, `ferns${i}`));
    for (const f of props.ferns) {
      e.set(0, rnd(0, TWO_PI), 0);
      q.setFromEuler(e);
      const s = 0.75 + f.scale * 0.55;
      fernBatches[(f.hue * 2) | 0].add(
        new THREE.Vector3(f.x, f.y - 0.05, f.z),
        new THREE.Vector3(s, s, s),
        q.clone(),
        [rnd(0, TWO_PI), 0.02 + f.scale * 0.02],
      );
    }

    // ------------------------------------------------------------ mushrooms
    const mushroomBatch = new SolidBatch(mushroomGeometry(), solidMat, 'mushrooms');
    let shroomBudget = 320;
    for (const f of props.ferns) {
      if (shroomBudget <= 0) break;
      if (Math.random() > 0.2) continue;
      shroomBudget--;
      const s = rnd(0.8, 1.5);
      e.set(0, rnd(0, TWO_PI), 0);
      q.setFromEuler(e);
      mushroomBatch.add(
        new THREE.Vector3(f.x + rnd(-0.5, 0.5), f.y - 0.02, f.z + rnd(-0.5, 0.5)),
        new THREE.Vector3(s, s, s), q.clone(), [0, 0.004],
      );
    }

    // --------------------------------------------------------------- bushes
    const bushGeos = [bushGeometry(3), bushGeometry(8)];
    const bushBatches = bushGeos.map((g, i) => new SolidBatch(g, solidMat, `bushes${i}`));
    for (const b of props.bushes) {
      const s = b.scale;
      e.set(0, b.rot, 0);
      q.setFromEuler(e);
      bushBatches[(b.hue * 2) | 0].add(
        new THREE.Vector3(b.x, b.y - 0.06, b.z),
        new THREE.Vector3(1.15 * s + 0.35, 1.0 * s + 0.35, 1.15 * s + 0.35),
        q.clone(), [b.hue * TWO_PI, 0.012 * s],
      );
      shadowItems.push({ x: b.x, z: b.z, y: b.y, r: 0.8 * s + 0.25, a: 0.34 });
      this.nodes.bushes.push({ x: b.x, y: b.y, z: b.z, r: 1.0 * s, id: b.id, kind: 'bush' });
    }

    // ---------------------------------------------------------------- trees
    const trunkBatch = new SolidBatch(trunkGeometry(), solidMat, 'trunks');
    const canopyGeos = [canopyGeometry(11), canopyGeometry(23), canopyGeometry(31)];
    const canopyBatches = canopyGeos.map((g, i) => new SolidBatch(g, solidMat, `canopy${i}`));
    const pineGeos = [
      pineGeometry({ layers: 7, seed: 5 }),
      pineGeometry({ layers: 8, seed: 12 }),
    ];
    const pineBatches = pineGeos.map((g, i) => new SolidBatch(g, solidMat, `pines${i}`));

    for (const t of props.trees) {
      const s = t.scale;
      if (t.type === 'broad') {
        const trunkH = (1.5 + t.hue * 0.9) * s;
        const girth = (0.34 + t.girth * 0.14) * s;
        e.set(0, t.rot, 0);
        q.setFromEuler(e);
        trunkBatch.add(
          new THREE.Vector3(t.x, t.y - 0.2, t.z),
          new THREE.Vector3(girth, trunkH + 0.2, girth), q.clone(), [t.swayPhase, 0.004],
        );
        const canopyY = t.y + trunkH * 0.72;
        const canopyR = (1.75 + t.hue * 0.8) * s;
        canopyBatches[(t.hue * 3) | 0].add(
          new THREE.Vector3(t.x, canopyY, t.z),
          new THREE.Vector3(canopyR * 1.05, canopyR * 0.95, canopyR * 1.05),
          q.clone(), [t.swayPhase, 0.008],
        );
        this.nodes.trees.push({
          x: t.x, y: t.y, z: t.z, r: 0.8 * s, id: t.id, kind: 'tree', trunkH,
        });
        shadowItems.push({ x: t.x + 0.5 * s, z: t.z + 0.65 * s, y: t.y, r: canopyR * 1.15, a: 0.42 });
      } else {
        const trunkH = (2.3 + t.hue * 1.4) * s;
        const girth = (0.26 + t.girth * 0.1) * s;
        e.set(0, t.rot, 0);
        q.setFromEuler(e);
        trunkBatch.add(
          new THREE.Vector3(t.x, t.y - 0.2, t.z),
          new THREE.Vector3(girth, trunkH + 0.2, girth), q.clone(), [t.swayPhase, 0.003],
        );
        const radius = (2.15 + t.hue * 0.6) * s;
        pineBatches[(t.hue * 2) | 0].add(
          new THREE.Vector3(t.x, t.y - 0.05, t.z),
          new THREE.Vector3(radius, trunkH * 1.12, radius),
          q.clone(), [t.swayPhase, 0.006],
        );
        this.nodes.trees.push({
          x: t.x, y: t.y, z: t.z, r: 0.7 * s, id: t.id, kind: 'tree', trunkH,
        });
        shadowItems.push({ x: t.x + 0.8 * s, z: t.z + 0.9 * s, y: t.y, r: radius * 1.1, a: 0.36 });
      }
    }

    // ---------------------------------------------------------------- rocks
    const rockVariants = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
    const rockMaterials = rockVariants.map(() => createInstancedSolidMaterial());
    const rockBatches = rockVariants.map((g, i) => new SolidBatch(g, rockMaterials[i], `rocks${i}`));
    const capBatch = new SolidBatch(rockCapGeometry(5), createInstancedSolidMaterial(), 'rockcaps');
    for (const r of props.rocks) {
      const s = r.scale;
      e.set(r.tilt, r.rot, r.tilt * 0.6);
      q.setFromEuler(e);
      const y = r.y - 0.28 * s;
      rockBatches[r.variant % 3].add(
        new THREE.Vector3(r.x, y, r.z),
        new THREE.Vector3(s, s * (0.62 + r.scale * 0.16), s), q.clone(),
      );
      if (r.pale) {
        capBatch.add(
          new THREE.Vector3(r.x, y + s * 0.34, r.z),
          new THREE.Vector3(s * 0.82, s * 0.34, s * 0.82), q.clone(),
        );
      }
      shadowItems.push({ x: r.x + 0.35 * s, z: r.z + 0.45 * s, y: r.y, r: s * 0.95, a: 0.33 });
      this.nodes.rocks.push({ x: r.x, y: r.y, z: r.z, r: s * 0.85, id: r.id, kind: 'rock' });
    }

    // -------------------------------------------------------- logs & stumps
    const logBatch = new SolidBatch(logGeometry(), createInstancedSolidMaterial(), 'logs');
    for (const l of props.logs) {
      e.set(0, l.rot, rnd(-0.05, 0.05));
      q.setFromEuler(e);
      logBatch.add(
        new THREE.Vector3(l.x, l.y + 0.2, l.z),
        new THREE.Vector3(l.length, 0.85, 0.85), q.clone(),
      );
      shadowItems.push({ x: l.x + 0.3, z: l.z + 0.4, y: l.y, r: l.length * 0.5, a: 0.3 });
      this.nodes.logs.push({ x: l.x, y: l.y, z: l.z, r: 0.6, id: `log${l.x.toFixed(1)}`, kind: 'log' });
    }
    const stumpBatch = new SolidBatch(stumpGeometry(), createInstancedSolidMaterial(), 'stumps');
    for (const st of props.stumps) {
      e.set(0, st.rot, 0);
      q.setFromEuler(e);
      stumpBatch.add(
        new THREE.Vector3(st.x, st.y - 0.1, st.z),
        new THREE.Vector3(st.scale * 1.15, st.height, st.scale * 1.15), q.clone(),
      );
      shadowItems.push({ x: st.x + 0.25, z: st.z + 0.3, y: st.y, r: st.scale * 0.9, a: 0.28 });
    }

    // ---------------------------------------------------------------- build
    this.batches = {
      tuftBatches, fernBatches, bushBatches, canopyBatches, pineBatches,
      trunkBatch, capBatch, logBatch, stumpBatch, rockBatches, mushroomBatch,
    };
    for (const b of [
      ...tuftBatches, ...fernBatches, ...bushBatches, ...canopyBatches, ...pineBatches,
      trunkBatch, ...rockBatches, capBatch, logBatch, stumpBatch, mushroomBatch,
    ]) {
      this.meshes.push(b.build(this.scene));
    }

    this.shadows = new ShadowDecals(this.scene, shadowItems, world);
  }

  update() {
    // wind lives in the vertex shader; nothing to tick here
  }

  /** Kept for the gather interaction: the wind gust already reads as a reaction. */
  nudge() {}
}

/**
 * Soft contact shadows. No shadow maps: a painterly game wants a soft,
 * deliberately placed dark shape, not a physically simulated one.
 */
class ShadowDecals {
  constructor(scene, items, world) {
    this.group = new THREE.Group();
    this.group.name = 'shadows';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    this.tex = tex;
    this.material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.55,
      color: new THREE.Color(0.055, 0.075, 0.055),
      depthWrite: false,
      blending: THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const count = items.length;
    const mesh = new THREE.InstancedMesh(geo, this.material, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const it = items[i];
      const h = Math.max(
        world.heightAt(it.x, it.z),
        world.heightAt(it.x + it.r * 0.5, it.z + it.r * 0.5) - 0.25,
      );
      m.compose(
        new THREE.Vector3(it.x, h + 0.08, it.z),
        q,
        new THREE.Vector3(it.r * 2.15, 1, it.r * 1.75),
      );
      m.toArray(mesh.instanceMatrix.array, i * 16);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.mesh = mesh;
    this.group.add(mesh);
    scene.add(this.group);
  }

  setNight(night) {
    this.material.opacity = 0.55 * (1 - night * 0.5);
  }
}

export const VEGETATION_WORLD = WORLD;
