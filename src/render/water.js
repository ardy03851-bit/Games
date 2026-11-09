/**
 * Water: one continuous surface fitted to the carved channel.
 *
 * The old ribbon was a fixed fraction of the river width, so most of the
 * channel stayed dry and the water read as a stripe laid into a ditch. Now
 * every cross-section marches out from the spine until the terrain rises
 * above the waterline, so the surface meets its banks exactly — pools open
 * wide, riffles pinch, and each tier step becomes a steep white-water chute
 * inside the same mesh (no separate, mis-aimed curtain planes).
 *
 * Per-vertex `aFoam` carries white water: 1 on the falls, decaying through the
 * plunge pool below, plus a touch where the current pinches. The shader adds
 * swell, flow streaks, bank lace, sky sheen and a night mode.
 */
import * as THREE from 'three';
import { createWaterMaterial, createRiverbedMaterial, createSplashMaterial } from './materials.js';

const COLS = 6;          // vertices across the channel
const BANK_TUCK = 0.10;  // how far the edge tucks under the bank

export class WaterSystem {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.material = createWaterMaterial();
    this.build();
    scene.add(this.group);
  }

  /** Cross-sections of the channel: bank-fitted half widths + foam budget. */
  sections() {
    const ribbon = this.world.waterPieces.ribbon;
    const hAt = (x, z) => this.world.heightAt(x, z);
    const rows = [];
    let dist = 0;

    for (let i = 0; i < ribbon.length; i++) {
      const s = ribbon[i];
      const next = ribbon[Math.min(ribbon.length - 1, i + 1)];
      const prev = ribbon[Math.max(0, i - 1)];
      let dx = next.x - prev.x;
      let dz = next.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz, nz = dx;
      dist += Math.hypot(s.x - prev.x, s.z - prev.z);

      const wy = s.y + 0.05;
      // march sideways until the ground rises out of the water
      const march = (sign) => {
        const maxW = s.width + 3.4;
        let last = 0.5;
        for (let w = 0.5; w < maxW; w += 0.2) {
          if (hAt(s.x + nx * sign * w, s.z + nz * sign * w) > wy + 0.05) break;
          last = w;
        }
        return Math.max(0.8, last + 0.18);
      };
      const wl = march(1);
      const wr = march(-1);

      // local fall of the waterline: ~0 on runs, huge across a tier step
      const drop = Math.abs(next.y - prev.y) / Math.max(0.35, len);
      rows.push({ s, nx, nz, wy, wl, wr, v: dist, drop, width: s.width });
    }

    // foam: white on the chute, lingering turbulence through the plunge pool,
    // and a little lace where the channel pinches hard.
    let carry = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const chute = Math.min(1, Math.max(0, (r.drop - 0.35) * 1.5));
      const pinch = Math.max(0, 1 - (r.wl + r.wr) / (r.width * 1.5)) * 0.25;
      carry = Math.max(chute, carry * 0.90, chute > 0.4 ? 0.85 : carry);
      if (chute > 0.4) carry = 1;
      r.foam = Math.min(1, carry + pinch);
      if (chute <= 0.4) carry *= 0.92;
    }
    return rows;
  }

  build() {
    const rows = this.sections();
    this.rows = rows;

    const positions = [];
    const uvs = [];
    const foams = [];
    const indices = [];
    let vert = 0;

    const dense = [];
    for (let i = 0; i < rows.length - 1; i++) {
      dense.push(rows[i]);
      const a = rows[i], b = rows[i + 1];
      dense.push({
        s: { x: (a.s.x + b.s.x) / 2, y: (a.s.y + b.s.y) / 2, z: (a.s.z + b.s.z) / 2 },
        nx: (a.nx + b.nx) / 2, nz: (a.nz + b.nz) / 2,
        wy: (a.wy + b.wy) / 2, wl: (a.wl + b.wl) / 2, wr: (a.wr + b.wr) / 2,
        v: (a.v + b.v) / 2, foam: (a.foam + b.foam) / 2, width: (a.width + b.width) / 2,
      });
    }
    dense.push(rows[rows.length - 1]);
    for (let i = 0; i < dense.length; i++) {
      const r = dense[i];
      for (let c = 0; c < COLS; c++) {
        const f = c / (COLS - 1);             // 0 left bank … 1 right bank
        const edge = Math.min(f, 1 - f) * 2;  // 0 at either bank, 1 midstream
        const w = r.wl * (1 - f) - r.wr * f;  // signed offset left(+)→right(−)
        const x = r.s.x + r.nx * w;
        const z = r.s.z + r.nz * w;
        // tuck the outer columns under the bank so no seam shows
        const tuck = (1 - Math.min(1, edge * 2.2)) * BANK_TUCK;
        positions.push(x, r.wy - tuck, z);
        uvs.push(f, r.v * 0.11);
        // white water is strongest midstream, quieter at the banks
        foams.push(r.foam * (0.5 + 0.5 * Math.sin(Math.PI * f)));
      }
    }
    for (let i = 0; i < dense.length - 1; i++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = vert + i * COLS + c;
        const b = a + 1;
        const d = a + COLS;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foams, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.name = 'riverSurface';
    this.group.add(mesh);
    this.ribbonMesh = mesh;

    // ---- wet bed: a shade wider and lower, so the shoulder reads as soaked
    const bedPositions = [];
    const bedUvs = [];
    const bedIndices = [];
    let bvert = 0;
    for (let i = 0; i < dense.length; i++) {
      const r = dense[i];
      for (let c = 0; c < COLS; c++) {
        const f = c / (COLS - 1);
        const ex = 1.55;                       // wider than the water
        const w = (r.wl * (1 - f) - r.wr * f) * ex;
        bedPositions.push(r.s.x + r.nx * w, r.wy - 0.12, r.s.z + r.nz * w);
        bedUvs.push(f, r.v * 0.11);
      }
    }
    for (let i = 0; i < dense.length - 1; i++) {
      for (let c = 0; c < COLS - 1; c++) {
        const a = bvert + i * COLS + c;
        const b = a + 1;
        const d = a + COLS;
        const e = d + 1;
        bedIndices.push(a, d, b, b, d, e);
      }
    }
    const bedGeo = new THREE.BufferGeometry();
    bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(bedPositions, 3));
    bedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bedUvs, 2));
    bedGeo.setIndex(bedIndices);
    bedGeo.computeVertexNormals();
    const bed = new THREE.Mesh(bedGeo, createRiverbedMaterial());
    bed.frustumCulled = false;
    bed.renderOrder = 1;
    bed.name = 'riverbed';
    this.group.add(bed);
    this.bedMesh = bed;

    // ---- splash discs in the plunge pools, aimed along the flow
    const falls = this.world.waterPieces.falls;
    this.falls = falls;
    const splashMat = createSplashMaterial();
    for (const f of falls) {
      // flow direction at the fall: from the ribbon sample nearest the top
      let dir = 0;
      let best = Infinity;
      for (const r of rows) {
        const d = Math.hypot(r.s.x - f.x, r.s.z - f.z);
        if (d < best) { best = d; dir = Math.atan2(r.nz, r.nx); }
      }
      const geoPlane = new THREE.CircleGeometry(f.width * 1.9, 20);
      geoPlane.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geoPlane, splashMat);
      m.position.set(f.x, f.bottomY + 0.12, f.z);
      m.rotation.y = -dir;
      m.scale.set(1, 1, 1.45);
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.name = 'splash';
      this.group.add(m);
    }
  }
}
