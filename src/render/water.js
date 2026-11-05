/**
 * Water: a ribbon that follows the tiered river, plus explicit curtains at
 * every waterfall. The shader paints golden shallows, drifting sparkle and
 * foam on the banks; the falls get streaky vertical curtains and a foam lip.
 */
import * as THREE from 'three';
import { createWaterMaterial } from './materials.js';

export class WaterSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.material = createWaterMaterial();
    this.fallMaterial = createWaterMaterial({ fall: true, flow: 1.6 });
    this.build();
    scene.add(this.group);
  }

  build() {
    const ribbon = this.world.waterPieces.ribbon;
    const strips = [];
    let current = [];
    let prevTier = ribbon[0]?.tier;
    let dist = 0;

    for (let i = 0; i < ribbon.length; i++) {
      const s = ribbon[i];
      if (s.tier !== prevTier) {
        strips.push(current);
        current = [];
        dist = 0;
        prevTier = s.tier;
      }
      const next = ribbon[Math.min(ribbon.length - 1, i + 1)];
      const prev = ribbon[Math.max(0, i - 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz, nz = dx;
      const half = s.width * 0.5;
      const step = Math.hypot(s.x - prev.x, s.z - prev.z);
      dist += step;
      current.push({
        lx: s.x + nx * half, lz: s.z + nz * half,
        rx: s.x - nx * half, rz: s.z - nz * half,
        y: s.y + 0.04, v: dist * 0.12,
      });
    }
    if (current.length) strips.push(current);

    const positions = [];
    const uvs = [];
    for (const strip of strips) {
      for (let i = 0; i < strip.length - 1; i++) {
        const a = strip[i], b = strip[i + 1];
        // two triangles, both sides for safety
        const quad = [
          [a.lx, a.y, a.lz, 0, a.v],
          [a.rx, a.y, a.rz, 1, a.v],
          [b.lx, b.y, b.lz, 0, b.v],
          [b.lx, b.y, b.lz, 0, b.v],
          [a.rx, a.y, a.rz, 1, a.v],
          [b.rx, b.y, b.rz, 1, b.v],
        ];
        for (const q of quad) {
          positions.push(q[0], q[1], q[2]);
          uvs.push(q[3], q[4]);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.ribbonMesh = mesh;

    // ---- waterfall curtains
    const falls = this.world.waterPieces.falls;
    this.falls = falls;
    for (const f of falls) {
      const h = Math.max(0.8, f.drop + 0.6);
      const geoPlane = new THREE.PlaneGeometry(f.width * 2.0, h, 1, 4);
      const m = new THREE.Mesh(geoPlane, this.fallMaterial);
      m.position.set(f.x, (f.topY + f.bottomY) * 0.5, f.z);
      m.rotation.y = Math.atan2(f.x - f.z * 0.02, 1) * 0 + 0.12;
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.group.add(m);

      // foam lip at the base of the fall
      const foamGeo = new THREE.PlaneGeometry(f.width * 2.4, f.width * 1.5);
      foamGeo.rotateX(-Math.PI / 2);
      const foam = new THREE.Mesh(foamGeo, this.material);
      foam.position.set(f.x, f.bottomY + 0.08, f.z + 1.4);
      foam.frustumCulled = false;
      foam.renderOrder = 3;
      this.group.add(foam);
    }
  }
}
