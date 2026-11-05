/**
 * The wanderer: a single soft-cornered cube. No eyes, no face — just weight,
 * a squash-and-stretch walk cycle, and a soft shadow.
 */
import * as THREE from 'three';
import { createSolidMaterial } from '../render/materials.js';
import { PALETTE } from '../terrain/terrain.js';

const P = PALETTE;

function roundedBox(size = 0.76, radius = 0.13, segments = 4) {
  const geo = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  const half = size / 2;
  const inner = half - radius;
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const c = new THREE.Vector3(
      Math.max(-inner, Math.min(inner, v.x)),
      Math.max(-inner, Math.min(inner, v.y)),
      Math.max(-inner, Math.min(inner, v.z)),
    );
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 1e-6) dir.normalize().multiplyScalar(radius);
    v.set(c.x + dir.x, c.y + dir.y, c.z + dir.z);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const colors = new Float32Array(flat.getAttribute('position').count * 3);
  const nrm = flat.getAttribute('normal');
  const p = flat.getAttribute('position');
  for (let i = 0; i < flat.getAttribute('position').count; i++) {
    const ny = nrm.getY(i);
    // dark slate body, warm dust on the shoulders, deep shade at the base
    let c = P.rockDark;
    const top = Math.max(0, ny);
    c = [
      c[0] + (0.32 - c[0]) * top * 0.35,
      c[1] + (0.35 - c[1]) * top * 0.35,
      c[2] + (0.40 - c[2]) * top * 0.35,
    ];
    if (p.getY(i) < -0.15) c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.6];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  flat.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  return flat;
}

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.position = new THREE.Vector3(world.spawn.x, world.spawn.y, world.spawn.z);
    this.velocity = new THREE.Vector3();
    this.speed = 4.15;
    this.radius = 0.42;
    this.facing = 0;
    this.walkPhase = 0;
    this.walkAmount = 0;
    this.squash = 1;
    this.target = null;
    this.stepTimer = 0;

    this.group = new THREE.Group();
    this.group.name = 'player';

    this.material = createSolidMaterial({ brightness: 1.03 });
    this.body = new THREE.Mesh(roundedBox(0.76, 0.14, 4), this.material);
    this.body.position.y = 0.38;
    this.body.frustumCulled = false;
    this.group.add(this.body);

    // tiny scarf-like band gives the cube a "front" without a face
    const bandGeo = new THREE.TorusGeometry(0.4, 0.055, 5, 14);
    bandGeo.rotateX(Math.PI / 2);
    const flatBand = bandGeo.toNonIndexed();
    flatBand.computeVertexNormals();
    const bc = new Float32Array(flatBand.getAttribute('position').count * 3);
    for (let i = 0; i < bc.length; i += 3) {
      bc[i] = 0.64; bc[i + 1] = 0.42; bc[i + 2] = 0.24;
    }
    flatBand.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
    this.band = new THREE.Mesh(flatBand, this.material);
    this.band.position.y = 0.52;
    this.body.add(this.band);

    // soft shadow under the cube
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(0,0,0,0.8)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    const shadowGeo = new THREE.PlaneGeometry(1.5, 1.15);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.55,
      color: new THREE.Color(0.05, 0.07, 0.05), depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadow.position.y = 0.045;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);

    scene.add(this.group);
    this.group.position.copy(this.position);
  }

  get x() { return this.position.x; }
  get z() { return this.position.z; }

  walkTo(x, z) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.target = null; return; }
    this.target = { x, z };
  }

  stop() { this.target = null; }

  /** True when the cube could stand here (not water, not too steep, in bounds). */
  canStand(x, z) {
    const w = this.world;
    const lim = w.size / 2 - 4;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
    if (w.fieldAt(w.riverMask, x, z) > 0.34) return false;
    if (w.slopeAt(x, z) > 0.66) return false;
    return true;
  }

  update(dt, moveVec, colliders, effects) {
    const w = this.world;
    // ---- desired direction from joystick / keys / walk target
    let dx = moveVec.x;
    let dz = moveVec.z;
    let mag = Math.hypot(dx, dz);
    if (mag < 0.05 && this.target) {
      const tx = this.target.x - this.position.x;
      const tz = this.target.z - this.position.z;
      const d = Math.hypot(tx, tz);
      if (d < 0.32) {
        this.target = null;
      } else {
        dx = tx / d;
        dz = tz / d;
        mag = Math.min(1, d * 1.4);
      }
    }
    if (mag > 1) { dx /= mag; dz /= mag; mag = 1; }

    const accel = 26;
    const targetVx = dx * this.speed * mag;
    const targetVz = dz * this.speed * mag;
    this.velocity.x += (targetVx - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (targetVz - this.velocity.z) * Math.min(1, accel * dt);

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.z * dt;

    // ---- collision with buildings (circles)
    for (const c of colliders) {
      const ddx = nx - c.x;
      const ddz = nz - c.z;
      const d = Math.hypot(ddx, ddz);
      const minD = c.r + this.radius;
      if (d < minD && d > 1e-4) {
        nx = c.x + (ddx / d) * minD;
        nz = c.z + (ddz / d) * minD;
        this.velocity.x *= 0.4;
        this.velocity.z *= 0.4;
      }
    }

    if (this.canStand(nx, nz)) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      // try sliding along each axis so the cube hugs the shoreline
      if (this.canStand(nx, this.position.z)) {
        this.position.x = nx;
        this.velocity.z *= 0.2;
      } else if (this.canStand(this.position.x, nz)) {
        this.position.z = nz;
        this.velocity.x *= 0.2;
      } else {
        this.velocity.multiplyScalar(0.2);
        this.target = null;
      }
    }

    const gy = w.heightAt(this.position.x, this.position.z);
    this.position.y += (gy - this.position.y) * Math.min(1, dt * 16);

    // ---- animation
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.walkAmount += (Math.min(1, speed / this.speed) - this.walkAmount) * Math.min(1, dt * 10);
    this.walkPhase += dt * (5.5 + speed * 1.6);
    const bob = Math.sin(this.walkPhase * 2) * 0.055 * this.walkAmount;
    const sway = Math.sin(this.walkPhase) * 0.055 * this.walkAmount;
    this.body.position.y = 0.38 + Math.abs(bob) + Math.sin(performance.now() * 0.0016) * 0.012;
    this.body.rotation.z = -sway * 0.5;
    this.body.rotation.x = sway * 0.35;
    this.body.rotation.y = Math.sin(this.walkPhase * 0.5) * 0.05 * this.walkAmount;
    const stretch = 1 + Math.sin(this.walkPhase * 2) * 0.05 * this.walkAmount;
    this.body.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    this.shadow.material.opacity = 0.5 - this.body.position.y * 0.12;

    if (this.target) {
      this.facing = Math.atan2(this.target.x - this.position.x, this.target.z - this.position.z);
    } else if (speed > 0.4) {
      this.facing = Math.atan2(this.velocity.x, this.velocity.z);
    }

    // ---- footsteps
    if (this.walkAmount > 0.35) {
      this.stepTimer -= dt * (0.8 + speed * 0.6);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.42;
        if (effects) {
          effects.dust(this.position.x, this.position.y, this.position.z);
        }
      }
    }

    this.group.position.copy(this.position);
    this.shadow.position.y = 0.05 + (gy - this.position.y);
    this.shadow.position.x = 0.06;
    this.shadow.position.z = 0.08;
  }

  nudge(x, z) {
    // gentle recoil when gathering
    this.body.rotation.x += Math.sin(performance.now() * 0.02) * 0.004;
    void x; void z;
  }
}
