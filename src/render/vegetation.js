/**
 * Vegetation — scatters every plant, rock and dead log into instanced meshes.
 *
 * The animation rule from the brief: no plant is one rigid piece. Grass tufts,
 * fern fronds, individual bush clusters, canopy leaf clusters and pine fronds
 * all live in instanced buffers with their own phase, so the wind shears
 * through a bush part by part.
 */
import * as THREE from 'three';
import { FoliageField } from './foliage.js';
import { createInstancedSolidMaterial } from './materials.js';
import {
  blobGeometry, rockGeometry, rockCapGeometry, trunkGeometry, pineCoreGeometry,
  logGeometry, stumpGeometry,
} from './propsGeo.js';
import { PALETTE, WORLD } from '../terrain/terrain.js';

const P = PALETTE;
const TINTS = [
  [0.99, 1.01, 0.94],
  [0.90, 0.96, 0.90],
  [1.02, 0.98, 0.87],
  [0.83, 0.92, 0.84],
  [0.96, 1.0, 0.96],
  [0.88, 0.94, 0.84],
];

function tintFor(hue) {
  const t = TINTS[Math.floor(hue * TINTS.length) % TINTS.length];
  return [t[0], t[1], t[2]];
}

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

export class Vegetation {
  constructor(scene, world, textures) {
    this.scene = scene;
    this.world = world;
    this.tex = textures;
    this.fields = [];
    this.meshes = [];
    this.nodes = { trees: [], rocks: [], bushes: [], logs: [] };
    this.build();
  }

  field(opts, name) {
    const f = new FoliageField(opts);
    f.name = name;
    this.fields.push(f);
    return f;
  }

  build() {
    const { world, tex } = this;
    const props = world.props;
    const solidMat = createInstancedSolidMaterial();

    const grass = this.field({
      texture: tex.grass_tuft, billboard: true, sway: 1.35, alphaCut: 0.38,
      brightness: 0.86, occlude: 0.85,
    }, 'grass');
    const fern = this.field({
      texture: tex.fern_card, billboard: true, sway: 0.42, alphaCut: 0.4,
      brightness: 1.0, occlude: 0.9,
    }, 'ferns');
    const bushCards = this.field({
      texture: tex.foliage_broadleaf, billboard: true, sway: 0.34, alphaCut: 0.42,
      brightness: 0.95, occlude: 0.95,
    }, 'bushleaves');
    const canopy = this.field({
      texture: tex.foliage_broadleaf, billboard: true, sway: 0.3, alphaCut: 0.42,
      brightness: 0.9, occlude: 0.95,
    }, 'canopy');
    const pine = this.field({
      texture: tex.pine_branch, billboard: false, sway: 0.5, alphaCut: 0.4,
      brightness: 1.0, occlude: 0.9, droop: 0.35,
    }, 'pinefronds');
    const shrooms = this.field({
      texture: tex.mushrooms, billboard: true, sway: 0.05, alphaCut: 0.45,
      brightness: 1.0, occlude: 0.8,
    }, 'mushrooms');

    // ---------------------------------------------------------------- grass
    for (const t of props.tufts) {
      const h = (0.58 + t.scale * 0.62);
      const w = h * 0.52;
      grass.add({ x: t.x, y: t.y - 0.06, z: t.z },
        { sx: w * 1.02, sy: h },
        { phase: (t.x * 1.7 + t.z * 2.3) % 6.283, sway: 0.85 + t.scale * 0.5, tint: tintFor(t.hue), lean: t.lean });
    }

    // ---------------------------------------------------------------- ferns
    for (const f of props.ferns) {
      const h = 0.85 + f.scale * 0.95;
      const w = h * 1.16;
      fern.add({ x: f.x, y: f.y - 0.08, z: f.z }, { sx: w, sy: h },
        { phase: Math.random() * 6.283, sway: 0.32 + f.scale * 0.2, tint: tintFor(f.hue), lean: (f.hue - 0.5) * 0.4 });
    }

    // -------------------------------------------------------------- mushrooms
    let mushroomBudget = 420;
    for (const f of props.ferns) {
      if (mushroomBudget <= 0) break;
      if (Math.random() > 0.22) continue;
      mushroomBudget--;
      const h = 0.2 + Math.random() * 0.22;
      shrooms.add({ x: f.x + (Math.random() - 0.5) * 0.7, y: f.y - 0.04, z: f.z + (Math.random() - 0.5) * 0.7 },
        { sx: h, sy: h }, { phase: Math.random() * 6.283, sway: 0.06, tint: [1, 1, 1], lean: 0 });
    }

    // ---------------------------------------------------------------- bushes
    const bushCoreGeo = blobGeometry({
      radius: 0.62, detail: 1, jitter: 0.3, seed: 3,
      top: P.grassMid, side: P.grassDeep, bottom: P.grassShade,
    });
    const bushCores = new SolidBatch(bushCoreGeo, solidMat, 'bushcores');
    const shadowItems = [];

    for (const b of props.bushes) {
      const s = b.scale;
      const bushHeight = 0.62 * s + 0.34;
      bushCores.add(new THREE.Vector3(b.x, b.y + bushHeight * 0.34, b.z),
        new THREE.Vector3(1.05 * s, 0.8 * s, 1.05 * s), null,
        [b.hue * 6.283, 0.012 * s]);

      const cards = 6 + Math.floor(b.hue * 4);
      for (let i = 0; i < cards; i++) {
        const a = (i / cards) * Math.PI * 2 + b.rot;
        const rad = (0.22 + Math.random() * 0.34) * s;
        const cardH = (0.72 + Math.random() * 0.4) * s + 0.2;
        bushCards.add({
          x: b.x + Math.cos(a) * rad,
          y: b.y + 0.14 + Math.random() * bushHeight * 0.55,
          z: b.z + Math.sin(a) * rad,
        }, { sx: cardH * 1.15, sy: cardH }, {
          phase: Math.random() * 6.283,
          sway: 0.35 + Math.random() * 0.3,
          tint: tintFor(b.hue * 0.8 + Math.random() * 0.2),
          lean: (Math.random() - 0.5) * 0.5,
        });
      }
      shadowItems.push({ x: b.x, z: b.z, y: b.y, r: 0.8 * s + 0.25, a: 0.34 });
      this.nodes.bushes.push({ x: b.x, y: b.y, z: b.z, r: 1.0 * s, id: b.id, field: bushCards, from: bushCards.items.length - cards, count: cards, kind: 'bush' });
    }

    // ----------------------------------------------------------------- trees
    const trunkGeo = trunkGeometry();
    const trunkBatch = new SolidBatch(trunkGeo, solidMat, 'trunks');
    const broadCoreGeo = blobGeometry({
      radius: 1, detail: 1, jitter: 0.34, seed: 11,
      top: P.grassMid, side: P.grassDeep, bottom: P.grassShade,
    });
    const pineCoreGeo = pineCoreGeometry(5);
    const broadCores = new SolidBatch(broadCoreGeo, solidMat, 'broadcores');
    const pineCores = new SolidBatch(pineCoreGeo, solidMat, 'pinecores');

    const q = new THREE.Quaternion();
    const e = new THREE.Euler();

    for (const t of props.trees) {
      const s = t.scale;
      if (t.type === 'broad') {
        const trunkH = (1.5 + t.hue * 0.9) * s;
        const girth = (0.34 + t.girth * 0.14) * s;
        e.set(0, t.rot, 0);
        q.setFromEuler(e);
        trunkBatch.add(new THREE.Vector3(t.x, t.y - 0.2, t.z),
          new THREE.Vector3(girth, trunkH + 0.2, girth), q.clone(), [t.swayPhase, 0.006]);

        const canopyY = t.y + trunkH * 0.92;
        const canopyR = (1.15 + t.hue * 0.55) * s;
        // dark mass gives the crown volume
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + t.rot;
          broadCores.add(
            new THREE.Vector3(t.x + Math.cos(a) * canopyR * 0.32, canopyY + 0.55 * s + Math.random() * 0.3, t.z + Math.sin(a) * canopyR * 0.32),
            new THREE.Vector3(canopyR * 0.85, canopyR * 0.72, canopyR * 0.85),
            null, [t.swayPhase + i, 0.008],
          );
        }
        // leaf clusters — each one sways on its own
        const cards = 14 + Math.floor(t.hue * 6);
        const startIdx = canopy.items.length;
        for (let i = 0; i < cards; i++) {
          const a = (i / cards) * Math.PI * 2 + t.rot * 1.7;
          const ring = 0.5 + Math.random() * 0.55;
          const cardH = (1.55 + Math.random() * 1.0) * s;
          canopy.add({
            x: t.x + Math.cos(a) * canopyR * ring,
            y: canopyY + (Math.random() - 0.15) * canopyR * 0.7,
            z: t.z + Math.sin(a) * canopyR * ring,
          }, { sx: cardH * 1.05, sy: cardH }, {
            phase: Math.random() * 6.283,
            sway: 0.25 + Math.random() * 0.22,
            tint: tintFor(t.hue * 0.7 + Math.random() * 0.3),
            lean: (Math.random() - 0.5) * 0.35,
          });
        }
        this.nodes.trees.push({
          x: t.x, y: t.y, z: t.z, r: 0.8 * s, id: t.id, kind: 'tree',
          field: canopy, from: startIdx, count: cards, trunkH: trunkH,
        });
        shadowItems.push({ x: t.x + 0.5 * s, z: t.z + 0.65 * s, y: t.y, r: canopyR * 1.25, a: 0.4 });
      } else {
        // ------------------------------------------------------- pine trees
        const trunkH = (2.3 + t.hue * 1.4) * s;
        const girth = (0.26 + t.girth * 0.1) * s;
        e.set(0, t.rot, 0);
        q.setFromEuler(e);
        trunkBatch.add(new THREE.Vector3(t.x, t.y - 0.2, t.z),
          new THREE.Vector3(girth, trunkH + 0.2, girth), q.clone(), [t.swayPhase, 0.004]);

        const layers = 9;
        const startIdx = pine.items.length;
        let cardCount = 0;
        for (let i = 0; i < layers; i++) {
          const f = i / (layers - 1);
          const y = t.y + trunkH * (0.28 + f * 0.68);
          const radius = (1.75 * Math.pow(1 - f, 0.7) + 0.34) * s;
          const perLayer = 4;
          for (let k = 0; k < perLayer; k++) {
            pine.add({ x: t.x, y, z: t.z },
              { sx: radius * 3.2, sy: 1 },
              {
                rot: t.rot + (k / perLayer) * Math.PI * 2 + i * 0.55,
                phase: Math.random() * 6.283,
                sway: 0.2 + Math.random() * 0.15,
                tint: [0.88 + t.hue * 0.2, 0.94 + t.hue * 0.12, 0.88 + t.hue * 0.14],
                lean: 0,
              });
            cardCount++;
          }
        }
        pineCores.add(new THREE.Vector3(t.x, t.y - 0.1, t.z),
          new THREE.Vector3(0.78 * s, trunkH * 0.82, 0.78 * s), null, [t.swayPhase, 0.006]);
        this.nodes.trees.push({
          x: t.x, y: t.y, z: t.z, r: 0.7 * s, id: t.id, kind: 'tree',
          field: pine, from: startIdx, count: cardCount, trunkH,
        });
        shadowItems.push({ x: t.x + 0.8 * s, z: t.z + 0.9 * s, y: t.y, r: (1.5 * s) * 1.1, a: 0.34 });
      }
    }

    // ----------------------------------------------------------------- rocks
    const rockVariants = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
    const rockMaterials = rockVariants.map(() => createInstancedSolidMaterial());
    const rockBatches = rockVariants.map((g, i) => new SolidBatch(g, rockMaterials[i], `rocks${i}`));
    const capGeo = rockCapGeometry(5);
    const capBatch = new SolidBatch(capGeo, createInstancedSolidMaterial(), 'rockcaps');
    for (const r of props.rocks) {
      const scale = r.scale;
      e.set(r.tilt, r.rot, r.tilt * 0.6);
      q.setFromEuler(e);
      const y = r.y - 0.28 * scale;
      rockBatches[r.variant % 3].add(new THREE.Vector3(r.x, y, r.z),
        new THREE.Vector3(scale, scale * (0.62 + r.scale * 0.16), scale), q.clone());
      if (r.pale) {
        capBatch.add(new THREE.Vector3(r.x, y + scale * 0.34, r.z),
          new THREE.Vector3(scale * 0.82, scale * 0.34, scale * 0.82), q.clone());
      }
      shadowItems.push({ x: r.x + 0.35 * scale, z: r.z + 0.45 * scale, y: r.y, r: scale * 0.95, a: 0.33 });
      this.nodes.rocks.push({ x: r.x, y: r.y, z: r.z, r: scale * 0.85, id: r.id, kind: 'rock' });
    }

    // -------------------------------------------------------- logs & stumps
    const logBatch = new SolidBatch(logGeometry(), createInstancedSolidMaterial(), 'logs');
    for (const l of props.logs) {
      e.set(0, l.rot, (Math.random() - 0.5) * 0.1);
      q.setFromEuler(e);
      logBatch.add(new THREE.Vector3(l.x, l.y + 0.2, l.z),
        new THREE.Vector3(l.length, 0.85, 0.85), q.clone());
      shadowItems.push({ x: l.x + 0.3, z: l.z + 0.4, y: l.y, r: l.length * 0.5, a: 0.3 });
      this.nodes.logs.push({ x: l.x, y: l.y, z: l.z, r: 0.6, id: `log${l.x.toFixed(1)}`, kind: 'log' });
    }
    const stumpBatch = new SolidBatch(stumpGeometry(), createInstancedSolidMaterial(), 'stumps');
    for (const st of props.stumps) {
      e.set(0, st.rot, 0);
      q.setFromEuler(e);
      stumpBatch.add(new THREE.Vector3(st.x, st.y - 0.1, st.z),
        new THREE.Vector3(st.scale * 1.15, st.height, st.scale * 1.15), q.clone());
      shadowItems.push({ x: st.x + 0.25, z: st.z + 0.3, y: st.y, r: st.scale * 0.9, a: 0.28 });
    }

    // ---------------------------------------------------------------- build
    this.batches = { bushCores, trunkBatch, broadCores, pineCores, capBatch, logBatch, stumpBatch, rockBatches };
    bushCores.build(this.scene);
    trunkBatch.build(this.scene);
    broadCores.build(this.scene);
    pineCores.build(this.scene);
    for (const b of rockBatches) b.build(this.scene);
    capBatch.build(this.scene);
    logBatch.build(this.scene);
    stumpBatch.build(this.scene);

    for (const f of this.fields) this.meshes.push(f.build(this.scene));

    this.shadows = new ShadowDecals(this.scene, shadowItems, world);
    this.bushCards = bushCards;
    this.canopy = canopy;
    this.pine = pine;
    this.grass = grass;
  }

  update(dt) {
    for (const f of this.fields) f.update(dt);
    // thin the grass when the camera is very close to the ground? not needed.
    void dt;
  }

  /** Make a plant react when it is gathered from. */
  nudge(node, strength = 1) {
    if (node.field) {
      const idx = [];
      for (let i = 0; i < node.count; i++) idx.push(node.from + i);
      node.field.impulse(idx, strength);
    }
  }
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
