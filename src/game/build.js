/**
 * Building.
 *
 * Everything is snapped to a 1 unit grid, sits on the terrain, and is assembled
 * from painted primitives. Fences and dry-stone walls discover their neighbours
 * and re-draw themselves, so a wall built one stone at a time still reads as one
 * continuous thing.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { paintSolid } from '../render/propsGeo.js';
import { createSolidMaterial } from '../render/materials.js';
import { PALETTE } from '../terrain/terrain.js';
import { shared } from '../core/shared.js';

const P = PALETTE;
const C = (v, f = 1) => [v[0] * f, v[1] * f, v[2] * f];

// ---------------------------------------------------------------------------
// A tiny builder for painted geometry kits
// ---------------------------------------------------------------------------
class Kit {
  constructor() {
    this.solid = [];
    this.glow = [];
  }
  raw(geo, color, glow = false) {
    const g = paintSolid(geo, color);
    (glow ? this.glow : this.solid).push(g);
    return this;
  }
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, glow = false) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return this.raw(g, color, glow);
  }
  cyl(rt, rb, h, seg, color, x = 0, y = 0, z = 0, rx = 0, rz = 0, glow = false) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return this.raw(g, color, glow);
  }
  cone(r, h, seg, color, x = 0, y = 0, z = 0, glow = false) {
    const g = new THREE.ConeGeometry(r, h, seg);
    g.translate(x, y, z);
    return this.raw(g, color, glow);
  }
  geometry(list) {
    const arr = list && list.length ? list : (this.solid.length ? this.solid : this.glow);
    if (!arr.length) return null;
    if (arr.length === 1) return arr[0];
    return mergeGeometries(arr, false);
  }
}

const materials = new WeakMap();
function solidMaterial() {
  if (!materials.has(solidMaterial)) {
    materials.set(solidMaterial, createSolidMaterial({ brightness: 1.0 }));
  }
  return materials.get(solidMaterial);
}
const glowMaterial = createSolidMaterial({ brightness: 1.0 });
export function getGlowMaterial() { return glowMaterial; }
export function updateGlowMaterial(night, baseColor) {
  // window light: warm, only after the sun drops
  const k = Math.max(0, Math.min(1, (night - 0.08) * 1.5));
  glowMaterial.uniforms.uEmissive.value.setRGB(
    baseColor[0] * k * 0.85, baseColor[1] * k * 0.62, baseColor[2] * k * 0.30,
  );
}

// ---------------------------------------------------------------------------
// Item definitions
// ---------------------------------------------------------------------------
const ITEMS = {
  path: {
    name: 'Dirt Path', icon: 'path', size: [1, 1], cost: {}, decal: true,
    build() {
      return { decal: true, tint: C(P.dirtMid, 0.95) };
    },
  },
  fence: {
    name: 'Fence', icon: 'fence', size: [1, 1], cost: { wood: 2 }, connects: true,
    build() {
      const kit = new Kit();
      kit.cyl(0.075, 0.09, 0.82, 6, P.wood, 0, 0.41, 0);
      kit.box(0.19, 0.05, 0.19, C(P.woodDark, 0.9), 0, 0.84, 0);
      return { kit };
    },
  },
  wall: {
    name: 'Stone Wall', icon: 'wall', size: [1, 1], cost: { stone: 3 }, connects: true,
    build() {
      const kit = new Kit();
      kit.box(0.5, 0.2, 0.5, C(P.rockMid, 0.95), 0, 0.1, 0);
      kit.box(0.44, 0.18, 0.44, C(P.rockLight, 0.95), 0.04, 0.28, -0.03);
      return { kit };
    },
  },
  bench: {
    name: 'Bench', icon: 'bench', size: [1, 1], cost: { wood: 4 },
    build() {
      const kit = new Kit();
      kit.box(0.9, 0.07, 0.34, P.wood, 0, 0.42, 0);
      kit.box(0.9, 0.28, 0.06, C(P.wood, 0.9), 0, 0.62, -0.16);
      for (const sx of [-0.34, 0.34]) {
        kit.box(0.07, 0.42, 0.3, P.woodDark, sx, 0.21, 0);
      }
      kit.box(0.72, 0.05, 0.22, C(P.woodLight, 0.95), 0, 0.36, 0);
      return { kit };
    },
  },
  lantern: {
    name: 'Lantern', icon: 'lantern', size: [1, 1], cost: { wood: 2, fiber: 2 }, light: 1.0,
    build() {
      const kit = new Kit();
      kit.cyl(0.07, 0.1, 1.45, 6, C(P.woodDark, 1.1), 0, 0.72, 0);
      kit.box(0.24, 0.06, 0.24, P.wood, 0, 1.46, 0);
      kit.box(0.2, 0.26, 0.2, C(P.wood, 0.8), 0, 1.34, 0);
      const kitGlow = new Kit();
      kitGlow.box(0.16, 0.2, 0.16, [1.0, 0.86, 0.52], 0, 1.34, 0, 0, 0, 0, true);
      kitGlow.box(0.26, 0.05, 0.26, P.woodDark, 0, 1.53, 0, 0, 0, 0, false);
      return { kit, kitGlow, light: { x: 0, y: 1.35, z: 0, r: 3.2, color: [1.0, 0.78, 0.42] } };
    },
  },
  campfire: {
    name: 'Campfire', icon: 'fire', size: [1, 1], cost: { wood: 3, stone: 4 }, light: 1.0,
    build() {
      const kit = new Kit();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        kit.box(0.17, 0.13, 0.17, C(P.rockMid, 0.9 + i * 0.02), Math.cos(a) * 0.33, 0.06, Math.sin(a) * 0.33, 0, a, 0);
      }
      kit.cyl(0.05, 0.06, 0.5, 5, P.barkDark, 0, 0.14, 0, Math.PI / 2, 0.4);
      kit.cyl(0.05, 0.06, 0.5, 5, P.barkDark, 0, 0.14, 0, Math.PI / 2, -0.9);
      const flame = { scale: 1 };
      const kitGlow = new Kit();
      kitGlow.cone(0.17, 0.5, 6, [1.0, 0.62, 0.24], 0, 0.42, 0, true);
      kitGlow.cone(0.1, 0.32, 5, [1.0, 0.85, 0.45], 0, 0.5, 0, true);
      return { kit, kitGlow, flame, light: { x: 0, y: 0.6, z: 0, r: 4.2, color: [1.0, 0.66, 0.30] } };
    },
  },
  garden: {
    name: 'Garden Bed', icon: 'garden', size: [2, 1], cost: { wood: 4, fiber: 2 },
    build() {
      const kit = new Kit();
      kit.box(1.85, 0.16, 0.85, P.wood, 0, 0.08, 0);
      for (const s of [-1, 1]) {
        kit.box(0.1, 0.3, 0.9, C(P.woodLight, 0.95), s * 0.92, 0.16, 0);
      }
      kit.box(1.7, 0.06, 0.7, C(P.dirtDark, 1.15), 0, 0.19, 0);
      const sprouts = [];
      for (let i = 0; i < 5; i++) {
        const sx = -0.62 + i * 0.31;
        const k = new Kit();
        k.cyl(0.015, 0.02, 0.22, 4, P.grassDeep, 0, 0.11, 0);
        k.box(0.12, 0.02, 0.09, P.grassMid, 0.03, 0.22, 0, 0, 0.6, 0.2);
        k.box(0.1, 0.02, 0.08, P.grassMid, -0.03, 0.18, 0.02, 0, -0.7, -0.2);
        sprouts.push({ geo: k.geometry(), x: sx, z: (i % 2 ? 0.14 : -0.12) });
      }
      return { kit, sprouts };
    },
  },
  planter: {
    name: 'Flower Box', icon: 'flower', size: [1, 1], cost: { wood: 3, fiber: 2 },
    build() {
      const kit = new Kit();
      kit.box(0.72, 0.26, 0.44, P.wood, 0, 0.13, 0);
      kit.box(0.66, 0.05, 0.38, C(P.dirtDark, 1.2), 0, 0.26, 0);
      const flowers = [
        [1.0, 0.86, 0.62], [0.94, 0.72, 0.46], [0.98, 0.94, 0.78], [0.86, 0.90, 0.62],
      ];
      for (let i = 0; i < 4; i++) {
        const fx = -0.24 + i * 0.16;
        const fz = (i % 2 ? 0.06 : -0.06);
        kit.cyl(0.008, 0.012, 0.2, 4, P.grassDeep, fx, 0.34, fz);
        kit.box(0.09, 0.05, 0.09, flowers[i], fx, 0.44, fz, 0.4, i, 0.2);
      }
      kit.box(0.7, 0.05, 0.1, C(P.woodLight, 0.9), 0, 0.3, 0.16);
      return { kit };
    },
  },
  sign: {
    name: 'Signpost', icon: 'sign', size: [1, 1], cost: { wood: 2 },
    build() {
      const kit = new Kit();
      kit.cyl(0.055, 0.07, 1.1, 6, P.woodDark, 0, 0.55, 0);
      kit.box(0.62, 0.28, 0.06, P.wood, 0.06, 1.02, 0, 0, 0.18, 0.05);
      kit.box(0.5, 0.05, 0.07, C(P.woodLight, 0.9), 0.06, 1.0, 0.01, 0, 0.18, 0.05);
      return { kit };
    },
  },
  well: {
    name: 'Well', icon: 'well', size: [1, 1], cost: { stone: 6, wood: 4 },
    build() {
      const kit = new Kit();
      kit.cyl(0.52, 0.56, 0.28, 9, C(P.rockMid, 0.98), 0, 0.14, 0);
      kit.cyl(0.46, 0.5, 0.22, 9, C(P.rockLight, 1.02), 0, 0.36, 0);
      kit.cyl(0.4, 0.4, 0.06, 9, [0.12, 0.14, 0.15], 0, 0.47, 0);
      for (const s of [-1, 1]) {
        kit.box(0.08, 0.95, 0.08, P.woodDark, s * 0.42, 0.7, 0);
      }
      kit.box(1.1, 0.08, 0.9, C(P.wood, 0.9), 0, 1.2, 0, 0.1, 0, 0);
      kit.cyl(0.05, 0.05, 0.8, 6, P.wood, 0, 1.1, 0.1, 0, Math.PI / 2);
      kit.box(0.16, 0.14, 0.16, P.woodLight, 0.1, 0.95, 0.14);
      return { kit };
    },
  },
  bridge: {
    name: 'Bridge', icon: 'bridge', size: [2, 1], cost: { wood: 8 }, overWater: true,
    build() {
      const kit = new Kit();
      for (let i = 0; i < 9; i++) {
        const x = -0.9 + i * 0.225;
        const c = i % 2 ? P.wood : C(P.wood, 0.92);
        kit.box(0.2, 0.07, 1.0, c, x, 0.06, 0, 0, 0, (Math.random() - 0.5) * 0.02);
      }
      for (const s of [-1, 1]) {
        kit.box(1.9, 0.06, 0.07, P.woodDark, 0, 0.42, s * 0.46);
        kit.box(1.9, 0.05, 0.05, C(P.woodDark, 0.9), 0, 0.24, s * 0.46);
        for (const px of [-0.85, 0, 0.85]) {
          kit.box(0.09, 0.5, 0.09, P.woodDark, px, 0.25, s * 0.46);
        }
      }
      return { kit };
    },
  },
  hut: {
    name: 'Cabin', icon: 'cabin', size: [2, 2], cost: { wood: 18, fiber: 6, stone: 4 }, light: 1.0,
    build() {
      const kit = new Kit();
      // stone footing
      kit.box(1.95, 0.2, 1.75, C(P.rockMid, 0.95), 0, 0.1, 0);
      // walls
      kit.box(1.7, 1.15, 1.5, C(P.wood, 0.86), 0, 0.72, 0);
      // horizontal log courses
      for (let i = 0; i < 5; i++) {
        kit.box(1.76, 0.07, 1.56, C(P.woodDark, 0.9 + i * 0.02), 0, 0.26 + i * 0.22, 0);
      }
      // door
      kit.box(0.44, 0.72, 0.07, C(P.woodDark, 0.7), 0.28, 0.56, 0.78);
      kit.box(0.05, 0.05, 0.05, [0.85, 0.72, 0.4], 0.12, 0.56, 0.81);
      // gable roof
      kit.box(2.15, 0.1, 1.05, C(P.grassDeep, 0.9), 0, 1.52, 0.48, -0.62, 0, 0);
      kit.box(2.15, 0.1, 1.05, C(P.grassDeep, 0.84), 0, 1.52, -0.48, 0.62, 0, 0);
      kit.box(2.2, 0.09, 0.16, C(P.grassShade, 1.0), 0, 1.83, 0);
      // roof moss clumps
      for (let i = 0; i < 5; i++) {
        const rx = -0.8 + i * 0.4;
        kit.box(0.22, 0.07, 0.2, C(P.grassMid, 0.9), rx, 1.58 + (i % 2) * 0.06, 0.42 + (i % 2) * 0.05, -0.62, 0, 0);
      }
      // porch
      kit.box(1.9, 0.1, 0.42, C(P.wood, 0.92), 0, 0.1, 1.0);
      kit.box(0.3, 0.08, 0.22, C(P.rockLight, 0.9), 0.6, 0.05, 1.24);
      // chimney
      kit.box(0.26, 0.62, 0.26, C(P.rockLight, 0.95), -0.62, 1.62, -0.32);
      kit.box(0.32, 0.08, 0.32, P.rockMid, -0.62, 1.95, -0.32);
      const kitGlow = new Kit();
      kitGlow.box(0.3, 0.3, 0.06, [1.0, 0.82, 0.46], -0.34, 0.82, 0.78, 0, 0, 0, true);
      kitGlow.box(0.34, 0.34, 0.05, C(P.woodDark, 0.8), -0.34, 0.82, 0.75);
      kitGlow.box(0.05, 0.34, 0.06, C(P.woodDark, 0.8), -0.34, 0.82, 0.8);
      kitGlow.box(0.34, 0.05, 0.06, C(P.woodDark, 0.8), -0.34, 0.82, 0.8);
      return {
        kit, kitGlow,
        light: { x: -0.34, y: 0.85, z: 1.0, r: 4.0, color: [1.0, 0.78, 0.42] },
        smoke: { x: -0.62, y: 2.1, z: -0.32 },
      };
    },
  },
  sapling: {
    name: 'Sapling', icon: 'tree', size: [1, 1], cost: { fiber: 3 }, grows: true,
    build() {
      const kit = new Kit();
      kit.cyl(0.06, 0.09, 0.85, 6, P.bark, 0, 0.42, 0);
      kit.box(0.34, 0.03, 0.05, C(P.grassMid, 0.95), 0.16, 0.62, 0, 0, 0.4, 0.3);
      kit.box(0.3, 0.03, 0.05, C(P.grassMid, 0.9), -0.15, 0.78, 0.02, 0, -0.6, -0.3);
      const crown = new Kit();
      crown.raw(new THREE.IcosahedronGeometry(0.4, 1), C(P.grassDeep, 1.05));
      return { kit, crowns: [{ geo: crown.geometry(), x: 0, y: 1.1, z: 0 }] };
    },
  },
};

export const ITEM_ORDER = [
  'path', 'fence', 'wall', 'gate',
  'bench', 'lantern', 'campfire', 'garden', 'planter', 'sign', 'well', 'bridge', 'hut', 'sapling',
].filter((id) => ITEMS[id]);

export const ITEM_LIST = ITEM_ORDER.map((id) => ({
  id,
  ...ITEMS[id],
  cost: ITEMS[id].cost,
}));

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
class Building {
  constructor(def, id, cx, cz, rot, world) {
    this.type = id;
    this.def = def;
    this.cx = cx;
    this.cz = cz;
    this.rot = rot;
    this.world = world;
    this.size = def.size || [1, 1];
    this.group = new THREE.Group();
    this.group.name = `build:${id}`;
    this.built = 0;               // growth 0..1 for saplings / gardens
    this.age = 0;
    this.neighbours = 0;
    this.rebuild();
  }

  terrainY() {
    const w = this.world;
    const [sw, sd] = this.size;
    let maxY = -Infinity, sum = 0, n = 0;
    for (let ix = 0; ix <= 2; ix++) {
      for (let iz = 0; iz <= 2; iz++) {
        const x = this.cx - sw / 2 + (ix / 2) * sw;
        const z = this.cz - sd / 2 + (iz / 2) * sd;
        const h = w.heightAt(x, z);
        maxY = Math.max(maxY, h);
        sum += h;
        n++;
      }
    }
    const [w0, d0] = this.size;
    if (w0 === 1 && d0 === 1) return w.heightAt(this.cx, this.cz);
    return maxY * 0.62 + (sum / n) * 0.38;
  }

  rebuild() {
    const def = this.def;
    while (this.group.children.length) this.group.remove(this.group.children[0]);
    const res = def.build(this) || {};
    this.result = res;
    const y = this.terrainY();
    this.baseY = y;
    this.group.position.set(this.cx, y, this.cz);
    this.group.rotation.y = this.rot;

    if (res.decal) {
      const geo = new THREE.PlaneGeometry(def.size[0] - 0.02, def.size[1] - 0.02, 2, 2);
      geo.rotateX(-Math.PI / 2);
      const g = paintSolid(geo, res.tint);
      const mesh = new THREE.Mesh(g, solidMaterial());
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.mesh = mesh;
      // decals live in world space so they can hug the terrain exactly
      this.group.position.set(0, 0, 0);
      this.group.rotation.y = 0;
      this.decalReposition();
      return;
    }

    if (res.sprouts) {
      for (const s of res.sprouts) {
        const m = new THREE.Mesh(s.geo, solidMaterial());
        m.position.set(s.x, 0.19, s.z);
        m.scale.setScalar(0.0001);
        m.userData.grow = true;
        m.userData.target = 0.8 + Math.random() * 0.5;
        this.group.add(m);
      }
    }
    if (res.crowns) {
      for (const c of res.crowns) {
        const m = new THREE.Mesh(c.geo, solidMaterial());
        m.position.set(c.x, c.y, c.z);
        m.userData.crown = true;
        this.group.add(m);
      }
    }

    if (res.kit) {
      const geo = res.kit.geometry();
      if (geo) {
        const mesh = new THREE.Mesh(geo, solidMaterial());
        mesh.frustumCulled = false;
        this.group.add(mesh);
      }
    }
    if (res.kitGlow) {
      const geo = res.kitGlow.geometry();
      if (geo) {
        const mesh = new THREE.Mesh(geo, glowMaterial);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.glowMesh = mesh;
      }
    }
    if (res.light) {
      this.lightInfo = res.light;
      this.lightSprite = makeGlowSprite(res.light.color, res.light.r);
      this.lightSprite.position.set(res.light.x, res.light.y, res.light.z);
      this.group.add(this.lightSprite);
    }
    if (res.smoke) this.smokeInfo = res.smoke;
    if (res.flame) {
      this.flame = this.group.children.find((c) => c.isMesh && c.material === glowMaterial) || null;
    }
    this.rebuildConnections();
  }

  decalReposition() {
    // dirt paths follow the terrain directly in world space
    this.group.position.set(0, 0, 0);
    const mesh = this.mesh;
    if (!mesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const w = this.world;
    for (let i = 0; i < pos.count; i++) {
      const wx = this.cx + pos.getX(i);
      const wz = this.cz + pos.getZ(i);
      pos.setY(i, w.heightAt(wx, wz) + 0.05);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  rebuildConnections() {
    const def = this.def;
    if (!def.connects) return;
    const mat = solidMaterial();
    // remove old rails
    if (this.railMesh) {
      this.group.remove(this.railMesh);
      this.railMesh.geometry.dispose();
      this.railMesh = null;
    }
    const spots = [];
    // neighbours are resolved by the build system, which sets this.linkMask
    const mask = this.linkMask || 0;
    const kit = new Kit();
    if (def.icon === 'fence') {
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        const a = d * Math.PI / 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        const len = 0.5;
        const cx = dx * len * 0.5, cz = dz * len * 0.5;
        kit.box(0.06, 0.09, len, P.wood, cx, 0.5, cz, 0, a, 0);
        kit.box(0.05, 0.07, len, C(P.wood, 0.9), cx, 0.28, cz, 0, a, 0);
      }
    } else {
      for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d))) continue;
        const a = d * Math.PI / 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        kit.box(0.34, 0.28, 0.34, C(P.rockMid, 0.95), dx * 0.36, 0.16, dz * 0.36, 0, a, 0);
        kit.box(0.3, 0.2, 0.3, C(P.rockLight, 0.92), dx * 0.36, 0.36, dz * 0.36, 0, a + 0.4, 0);
      }
    }
    const geo = kit.geometry();
    if (geo) {
      this.railMesh = new THREE.Mesh(geo, mat);
      this.railMesh.frustumCulled = false;
      this.group.add(this.railMesh);
    }
  }

  update(dt, night, effects) {
    this.age += dt;
    if (this.def.grows) {
      this.built = Math.min(1, this.built + dt * 0.06);
      const s = 0.55 + this.built * 0.45;
      this.group.scale.setScalar(s);
      for (const c of this.group.children) {
        if (c.userData.crown) c.scale.setScalar(0.6 + this.built * 0.6);
      }
    }
    for (const c of this.group.children) {
      if (c.userData.grow) {
        const target = c.userData.target;
        c.scale.setScalar(Math.min(target * 1.1, 0.2 + this.age * 0.05));
      }
    }
    if (this.lightSprite) {
      const k = Math.max(0, (night - 0.1) * 1.4);
      this.lightSprite.material.opacity = Math.min(1, k);
      const flicker = 0.92 + Math.sin(this.age * 7.3) * 0.05 + Math.sin(this.age * 13.1) * 0.03;
      this.lightSprite.scale.setScalar(this.lightInfo.r * (0.85 + k * 0.4) * flicker);
      this.lightSprite.visible = k > 0.02;
    }
    if (this.def.icon === 'fire' && this.glowMesh) {
      const f = 0.9 + Math.sin(this.age * 9.7) * 0.08 + Math.sin(this.age * 17.3) * 0.05;
      this.glowMesh.scale.set(0.9 + f * 0.12, f, 0.9 + f * 0.12);
    }
    if (this.smokeInfo && effects && Math.random() < dt * 5) {
      const p = new THREE.Vector3(this.smokeInfo.x, this.smokeInfo.y, this.smokeInfo.z);
      this.group.localToWorld(p);
      effects.smoke(p.x, p.y, p.z);
    }
  }

  serialize() {
    return { t: this.type, x: this.cx, z: this.cz, r: this.rot, a: this.age, b: this.built };
  }
}

function makeGlowSprite(color, size) {
  if (!makeGlowSprite.tex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,235,180,0.45)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    makeGlowSprite.tex = tex;
  }
  const mat = new THREE.SpriteMaterial({
    map: makeGlowSprite.tex,
    color: new THREE.Color(color[0], color[1], color[2]),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  return s;
}

// ---------------------------------------------------------------------------
// Build system
// ---------------------------------------------------------------------------
export class BuildSystem {
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.buildings = [];
    this.resources = opts.resources;
    this.onChange = opts.onChange || (() => {});
    this.effects = opts.effects;
    this.ghostGroup = new THREE.Group();
    this.ghostGroup.visible = false;
    scene.add(this.ghostGroup);
    this.activeItem = null;
    this.rot = 0;
    this.ghostPos = new THREE.Vector3();
    this.valid = false;
    this.removeMode = false;
    this.ghostMaterial = new THREE.MeshBasicMaterial({
      color: 0x9fe07a, transparent: true, opacity: 0.42, depthWrite: false,
    });
    this.ghostMaterialBad = new THREE.MeshBasicMaterial({
      color: 0xe07a6a, transparent: true, opacity: 0.42, depthWrite: false,
    });
    this.cache = new Map();
    this.grid = new Map();
  }

  itemAt(x, z) {
    const sw = Math.floor(x), sz = Math.floor(z);
    for (const b of this.buildings) {
      const [w, d] = b.size;
      if (Math.abs(b.cx - (sw + 0.5)) <= w / 2 && Math.abs(b.cz - (sz + 0.5)) <= d / 2) return b;
    }
    return null;
  }

  footprintFree(cx, cz, size) {
    const [w, d] = size;
    for (const b of this.buildings) {
      const [bw, bd] = b.size;
      if (Math.abs(b.cx - cx) < (w + bw) / 2 - 0.01 && Math.abs(b.cz - cz) < (d + bd) / 2 - 0.01) {
        return false;
      }
    }
    return true;
  }

  canAfford(def) {
    for (const [k, v] of Object.entries(def.cost || {})) {
      if ((this.resources[k] || 0) < v) return false;
    }
    return true;
  }

  pay(def) {
    for (const [k, v] of Object.entries(def.cost || {})) {
      this.resources[k] = (this.resources[k] || 0) - v;
    }
  }

  refund(def, fraction = 0.5) {
    for (const [k, v] of Object.entries(def.cost || {})) {
      this.resources[k] = (this.resources[k] || 0) + Math.floor(v * fraction);
    }
  }

  select(id) {
    this.removeMode = false;
    this.activeItem = id;
    this.refreshGhost();
  }

  deselect() {
    this.activeItem = null;
    this.removeMode = false;
    this.ghostGroup.visible = false;
  }

  toggleRemove(on) {
    this.removeMode = on;
    if (on) this.activeItem = null;
    this.ghostGroup.visible = false;
  }

  snap(v) {
    return Math.floor(v) + 0.5;
  }

  refreshGhost() {
    while (this.ghostGroup.children.length) this.ghostGroup.remove(this.ghostGroup.children[0]);
    if (!this.activeItem) { this.ghostGroup.visible = false; return; }
    const def = ITEMS[this.activeItem];
    const key = `ghost:${this.activeItem}`;
    let geo = this.cache.get(key);
    if (!geo) {
      const res = def.build(null);
      geo = res.kit ? res.kit.geometry() : null;
      this.cache.set(key, geo);
    }
    if (geo) {
      const mesh = new THREE.Mesh(geo, this.ghostMaterial);
      this.ghostGroup.add(mesh);
    } else {
      const g = new THREE.BoxGeometry(def.size[0] * 0.9, 0.2, def.size[1] * 0.9);
      this.ghostGroup.add(new THREE.Mesh(g, this.ghostMaterial));
    }
    this.ghostGroup.visible = true;
  }

  updateGhost(worldX, worldZ) {
    if (!this.activeItem) { this.ghostGroup.visible = false; return; }
    const def = ITEMS[this.activeItem];
    const [w, d] = def.size;
    const cx = this.snap(worldX - (w % 2 === 0 ? 0.5 : 0));
    const cz = this.snap(worldZ - (d % 2 === 0 ? 0.5 : 0));
    this.ghostPos.set(cx, this.world.heightAt(cx, cz), cz);
    this.ghostGroup.position.copy(this.ghostPos);
    this.ghostGroup.rotation.y = this.rot;
    this.ghostGroup.visible = true;
    this.valid = this.validate(cx, cz, def);
    const mat = this.valid ? this.ghostMaterial : this.ghostMaterialBad;
    for (const c of this.ghostGroup.children) c.material = mat;
  }

  validate(cx, cz, def) {
    if (!this.canAfford(def)) return false;
    const [w, d] = def.size;
    const lim = this.world.size / 2 - 4;
    if (Math.abs(cx) > lim || Math.abs(cz) > lim) return false;
    for (let ix = 0; ix <= 2; ix++) {
      for (let iz = 0; iz <= 2; iz++) {
        const px = cx - w / 2 + (ix / 2) * w;
        const pz = cz - d / 2 + (iz / 2) * d;
        const water = this.world.fieldAt(this.world.riverMask, px, pz);
        if (water > 0.22 && !def.overWater) return false;
        if (this.world.slopeAt(px, pz) > (def.overWater ? 0.95 : 0.42)) return false;
      }
    }
    return this.footprintFree(cx, cz, def.size);
  }

  tryPlace() {
    if (!this.activeItem || !this.valid) return null;
    const def = ITEMS[this.activeItem];
    const [w, d] = def.size;
    const cx = this.ghostPos.x, cz = this.ghostPos.z;
    const b = new Building(def, this.activeItem, cx, cz, this.rot, this.world);
    this.buildings.push(b);
    this.scene.add(b.group);
    this.pay(def);
    this.refreshLinks(cx, cz);
    this.onChange();
    if (this.effects) {
      for (let i = 0; i < 12; i++) {
        this.effects.dust(cx + (Math.random() - 0.5) * w, b.baseY + 0.1, cz + (Math.random() - 0.5) * d, 1.4);
      }
    }
    // keep building while the player has resources
    this.refreshGhost();
    return b;
  }

  removeAt(worldX, worldZ) {
    const b = this.itemAt(worldX, worldZ);
    if (!b) return false;
    const i = this.buildings.indexOf(b);
    if (i < 0) return false;
    this.buildings.splice(i, 1);
    this.scene.remove(b.group);
    b.group.traverse((c) => { if (c.geometry) c.geometry.dispose?.(); });
    this.refund(b.def, 0.6);
    this.refreshLinks(b.cx, b.cz);
    this.onChange();
    if (this.effects) {
      for (let k = 0; k < 10; k++) {
        this.effects.dust(b.cx + (Math.random() - 0.5), b.baseY + 0.2, b.cz + (Math.random() - 0.5), 1.2);
      }
    }
    return true;
  }

  /** Recompute fence/wall links around a cell. */
  refreshLinks(cx, cz) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const consider = (b) => {
      if (!b || !b.def.connects) return;
      let mask = 0;
      for (let k = 0; k < 4; k++) {
        const [dx, dz] = dirs[k];
        const other = this.buildings.find((o) => o !== b && o.def.connects &&
          Math.abs(o.cx - (b.cx + dx)) < 0.3 && Math.abs(o.cz - (b.cz + dz)) < 0.3);
        if (other) mask |= 1 << k;
      }
      if (mask !== b.linkMask) {
        b.linkMask = mask;
        b.rebuildConnections();
      }
    };
    for (const b of this.buildings) {
      if (Math.abs(b.cx - cx) < 3.2 && Math.abs(b.cz - cz) < 3.2) consider(b);
    }
  }

  colliders() {
    const out = [];
    for (const b of this.buildings) {
      if (b.def.decal) continue;
      const [w, d] = b.size;
      out.push({ x: b.cx, z: b.cz, r: Math.max(w, d) * 0.42 });
    }
    return out;
  }

  update(dt, night) {
    for (const b of this.buildings) b.update(dt, night, this.effects);
  }

  serialize() {
    return this.buildings.map((b) => b.serialize());
  }

  restore(list, clear = true) {
    if (clear) {
      for (const b of this.buildings) this.scene.remove(b.group);
      this.buildings.length = 0;
    }
    for (const s of list) {
      const def = ITEMS[s.t];
      if (!def) continue;
      const b = new Building(def, s.t, s.x, s.z, s.r || 0, this.world);
      b.age = s.a || 0;
      b.built = s.b ?? 1;
      if (def.grows) b.group.scale.setScalar(0.55 + b.built * 0.45);
      this.buildings.push(b);
      this.scene.add(b.group);
    }
    for (const b of this.buildings) {
      if (b.def.connects) {
        b.linkMask = -1;
        b.rebuildConnections();
      }
    }
    for (const b of this.buildings) this.refreshLinks(b.cx, b.cz);
  }
}

export { ITEMS };
