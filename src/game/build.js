/**
 * Freeform building.
 *
 * There is no fixed catalogue of finished buildings. The player places
 * *pieces* — a block, a wall, an arch, a ramp, a roof — into a 1×1 grid, layer
 * by layer, and paints each one. A house is just a bunch of pieces that happen
 * to look like a house; so is a bridge, a tower, a wall around the camp or a
 * lantern road through the forest.
 *
 * Everything is instanced: one InstancedMesh per (shape, paint) pair, rebuilt
 * only when something changes. A thousand pieces is still twelve draw calls.
 */
import * as THREE from 'three';
import { createInstancedSolidMaterial } from '../render/materials.js';
import { CELL, LAYER, SHAPES, SHAPE_BY_ID, PAINTS, PAINT_BY_ID, shapeGeometry, pieceCost } from '../render/parts.js';

export { SHAPES, PAINTS, SHAPE_BY_ID, PAINT_BY_ID, CELL, LAYER };

export const TOOLS = [
  { id: 'build', name: 'Build' },
  { id: 'erase', name: 'Erase' },
  { id: 'paint', name: 'Repaint' },
];

const MAX_LAYERS = 12;

const keyOf = (cx, cy, cz) => `${cx},${cy},${cz}`;
const unkey = (k) => k.split(',').map(Number);

export class BuildSystem {
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.opts = opts;

    this.blocks = new Map();
    this.batches = new Map();
    this.dirty = true;

    this.group = new THREE.Group();
    this.group.name = 'buildings';
    scene.add(this.group);

    this.tool = 'build';
    this.shapeId = 'block';
    this.paintId = 'oak';
    this.rot = 0;
    this.layer = 0;

    this.cursor = { cx: 0, cy: 0, cz: 0, y: 0, valid: false };
    this.history = [];
    this.future = [];
    this.lastMessage = '';

    this.ghost = this.makeGhost();
    this.group.add(this.ghost);

    // the piece under the cursor as it will look when placed
    this.ghostMesh = null;
    this.setShape('block');

    this.glowMats = [];
    this.tmp = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.tmpS = new THREE.Vector3(1, 1, 1);
  }

  // -- state ---------------------------------------------------------------
  get blockCount() { return this.blocks.size; }

  setTool(tool) {
    if (!TOOLS.some((t) => t.id === tool)) return;
    this.tool = tool;
    this.refreshGhost();
  }

  setShape(id) {
    if (!SHAPE_BY_ID[id]) return;
    this.shapeId = id;
    this.refreshGhost();
  }

  setPaint(id) {
    if (!PAINT_BY_ID[id]) return;
    this.paintId = id;
    this.refreshGhost();
  }

  rotate() {
    this.rot = (this.rot + 1) % 4;
    this.refreshGhost();
  }

  setLayer(n) {
    this.layer = Math.max(0, Math.min(MAX_LAYERS, n));
    this.moveCursor(this.cursor.wx ?? 0, this.cursor.wz ?? 0);
  }

  raise(dir = 1) {
    this.setLayer(this.layer + dir);
  }

  costFor(shapeId = this.shapeId, paintId = this.paintId) {
    return pieceCost(shapeId, paintId);
  }

  // -- grid maths ----------------------------------------------------------
  baseY(cx, cz) {
    const y = this.world.heightAt(cx * CELL, cz * CELL);
    // quantise so neighbouring pieces share a footing even on a slope
    return Math.round(y / 0.31) * 0.31;
  }

  worldY(cx, cy, cz) {
    return this.baseY(cx, cz) + cy * LAYER;
  }

  /** Where the player is pointing, snapped to the grid. */
  moveCursor(wx, wz) {
    const cx = Math.round(wx / CELL);
    const cz = Math.round(wz / CELL);
    this.cursor.cx = cx;
    this.cursor.cz = cz;
    this.cursor.valid = true;
    this.cursor.wx = wx;
    this.cursor.wz = wz;
    this.cursor.cy = this.layer;
    this.cursor.y = this.worldY(cx, this.layer, cz);
    this.refreshGhost();
  }

  /** Is this cell free (or is the tool allowed to work on it)? */
  blockerAt(cx, cy, cz) {
    return this.blocks.get(keyOf(cx, cy, cz)) || null;
  }

  // -- ghost ---------------------------------------------------------------
  makeGhost() {
    const g = new THREE.Group();
    g.name = 'ghost';
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.56, 26),
      new THREE.MeshBasicMaterial({
        color: 0xffe9b8, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'ring';
    g.add(ring);
    return g;
  }

  refreshGhost() {
    const shape = SHAPE_BY_ID[this.shapeId];
    const showPiece = this.tool !== 'erase';
    if (this.ghostMesh) {
      this.ghost.remove(this.ghostMesh);
      this.ghostMesh.geometry?.dispose?.();
      this.ghostMesh.material?.dispose?.();
      this.ghostMesh = null;
    }
    if (!showPiece) return;
    const geo = shapeGeometry(this.shapeId, this.paintId).clone();
    const tint = PAINT_BY_ID[this.paintId]?.hex || '#ffffff';
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tint).lerp(new THREE.Color(0xfff1c8), 0.45),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5;
    this.ghostMesh = mesh;
    this.ghost.add(mesh);
    void shape;
  }

  // -- placement -----------------------------------------------------------
  canPay(cost) {
    const res = this.opts.getResources?.() || {};
    for (const [k, v] of Object.entries(cost)) if ((res[k] || 0) < v) return false;
    return true;
  }

  pay(cost) { this.opts.spend?.(cost); }
  refund(cost) { this.opts.refund?.(cost); }

  place(cx = this.cursor.cx, cy = this.cursor.cy, cz = this.cursor.cz) {
    const k = keyOf(cx, cy, cz);
    const existing = this.blocks.get(k);
    if (existing) {
      // building over your own piece is a silent repaint, not a cost
      if (existing.s === this.shapeId && existing.m === this.paintId && existing.r === this.rot) return false;
    }
    const cost = this.costFor();
    if (!existing && !this.canPay(cost)) {
      const res = this.opts.getResources?.() || {};
      const missing = Object.entries(cost)
        .filter(([k, v]) => (res[k] || 0) < v).map(([k]) => k).join(' and ');
      this.opts.onFeedback?.(`not enough ${missing || 'materials'}`);
      return false;
    }
    if (!existing) this.pay(cost);
    const next = { s: this.shapeId, m: this.paintId, r: this.rot };
    this.blocks.set(k, next);
    this.history.push({ type: existing ? 'replace' : 'place', k, prev: existing || null, next });
    this.future.length = 0;
    this.dirty = true;
    this.opts.onPlace?.(cx, cy, cz, next);
    return true;
  }

  erase(cx = this.cursor.cx, cy = this.cursor.cy, cz = this.cursor.cz) {
    const k = keyOf(cx, cy, cz);
    const prev = this.blocks.get(k);
    if (!prev) return false;
    this.blocks.delete(k);
    this.history.push({ type: 'erase', k, prev, next: null });
    this.future.length = 0;
    this.refund(pieceCost(prev.s, prev.m));
    this.dirty = true;
    this.opts.onErase?.(cx, cy, cz);
    return true;
  }

  paint(cx = this.cursor.cx, cy = this.cursor.cy, cz = this.cursor.cz) {
    const k = keyOf(cx, cy, cz);
    const prev = this.blocks.get(k);
    if (!prev || prev.m === this.paintId) return false;
    const next = { ...prev, m: this.paintId };
    this.blocks.set(k, next);
    this.history.push({ type: 'replace', k, prev, next });
    this.future.length = 0;
    this.dirty = true;
    return true;
  }

  /** Do the current tool at the cursor. */
  commit() {
    if (!this.cursor.valid) return false;
    const { cx, cy, cz } = this.cursor;
    if (this.tool === 'erase') return this.erase(cx, cy, cz);
    if (this.tool === 'paint') {
      const ok = this.paint(cx, cy, cz);
      if (!ok) this.opts.onFeedback?.('nothing to repaint here');
      return ok;
    }
    return this.place(cx, cy, cz);
  }

  undo() {
    const op = this.history.pop();
    if (!op) return false;
    if (op.prev) this.blocks.set(op.k, op.prev); else this.blocks.delete(op.k);
    if (op.type === 'place') this.refund(pieceCost(op.next.s, op.next.m));
    if (op.type === 'erase') this.pay(pieceCost(op.prev.s, op.prev.m));
    this.future.push(op);
    this.dirty = true;
    return true;
  }

  redo() {
    const op = this.future.pop();
    if (!op) return false;
    if (op.type === 'place' || op.type === 'replace') {
      if (!op.prev) this.pay(pieceCost(op.next.s, op.next.m));
      this.blocks.set(op.k, op.next);
    } else {
      const prev = this.blocks.get(op.k);
      if (prev) this.refund(pieceCost(prev.s, prev.m));
      this.blocks.delete(op.k);
    }
    this.history.push(op);
    this.dirty = true;
    return true;
  }

  // -- rendering -----------------------------------------------------------
  batch(shapeId, paintId) {
    const key = `${shapeId}|${paintId}`;
    let b = this.batches.get(key);
    if (!b) {
      const geo = shapeGeometry(shapeId, paintId);
      const mat = createInstancedSolidMaterial({ brightness: 1.02 });
      if (shapeId === 'lantern' || shapeId === 'window') this.glowMats.push({ mat, kind: shapeId });
      const mesh = new THREE.InstancedMesh(geo, mat, 64);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = `pieces-${key}`;
      mesh.count = 0;
      this.group.add(mesh);
      b = { mesh, max: 64 };
      this.batches.set(key, b);
    }
    return b;
  }

  rebuild() {
    this.dirty = false;
    const used = new Map();
    for (const [k, v] of this.blocks) {
      const bk = `${v.s}|${v.m}`;
      let list = used.get(bk);
      if (!list) { list = []; used.set(bk, list); }
      list.push([k, v]);
    }
    for (const [bk, list] of used) {
      const [s, m] = bk.split('|');
      const b = this.batch(s, m);
      if (list.length > b.max) {
        b.max = Math.max(list.length, b.max * 2);
        const geo = b.mesh.geometry;
        const mat = b.mesh.material;
        this.group.remove(b.mesh);
        b.mesh.dispose();
        const mesh = new THREE.InstancedMesh(geo, mat, b.max);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        b.mesh = mesh;
      }
      b.mesh.count = list.length;
      let i = 0;
      for (const [k, v] of list) {
        const [cx, cy, cz] = unkey(k);
        const y = this.worldY(cx, cy, cz) + 0.015;
        this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (v.r * Math.PI) / 2);
        this.tmpV.set(cx * CELL, y, cz * CELL);
        this.tmp.compose(this.tmpV, this.tmpQ, this.tmpS);
        b.mesh.setMatrixAt(i++, this.tmp);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const [key, b] of this.batches) {
      if (!used.has(key)) b.mesh.count = 0;
    }
  }

  /** World positions of every placed lantern, for the night light pools. */
  lanternPositions() {
    const out = [];
    for (const [k, v] of this.blocks) {
      if (v.s !== 'lantern') continue;
      const [cx, cy, cz] = unkey(k);
      out.push({ x: cx * CELL, y: this.worldY(cx, cy, cz) + 0.08, z: cz * CELL, r: 2.3 });
    }
    return out;
  }

  // -- queries -------------------------------------------------------------
  colliders() {
    const out = [];
    const seen = new Set();
    for (const [k, v] of this.blocks) {
      const shape = SHAPE_BY_ID[v.s];
      if (!shape || shape.cat === 'flat' || v.s === 'floor' || v.s === 'slab' || v.s === 'ramp' || v.s === 'stair') continue;
      const [cx, cy, cz] = unkey(k);
      if (seen.has(`${cx},${cz}`)) continue;
      seen.add(`${cx},${cz}`);
      out.push({ x: cx * CELL, z: cz * CELL, r: 0.62 });
    }
    return out;
  }

  /** Pieces under a world point, top-down, for picking. */
  pieceAt(wx, wz) {
    const cx = Math.round(wx / CELL);
    const cz = Math.round(wz / CELL);
    for (let cy = MAX_LAYERS; cy >= 0; cy--) {
      const b = this.blocks.get(keyOf(cx, cy, cz));
      if (b) return { cx, cy, cz, block: b };
    }
    return null;
  }

  // -- loop ----------------------------------------------------------------
  update(dt, night = 0) {
    if (this.dirty) this.rebuild();
    const g = this.ghost;
    g.visible = this.cursor.valid;
    if (!g.visible) return;
    const { cx, cy, cz } = this.cursor;
    const y = this.worldY(cx, cy, cz);
    g.position.set(cx * CELL, y + 0.012, cz * CELL);
    g.rotation.y = (this.rot * Math.PI) / 2;
    const ring = g.getObjectByName('ring');
    if (ring) {
      const blocked = !!this.blockerAt(cx, cy, cz);
      const bad = this.tool === 'build' && blocked && !this.sameAs(cx, cy, cz);
      ring.material.color.setHex(this.tool === 'erase' ? 0xff9a7a : bad ? 0xf08c74 : 0xffe9b8);
      const pulse = 0.45 + Math.sin(performance.now() * 0.004) * 0.10;
      ring.material.opacity = pulse;
    }
    void dt; void night;
  }

  sameAs(cx, cy, cz) {
    const b = this.blockerAt(cx, cy, cz);
    return !!b && b.s === this.shapeId && b.m === this.paintId && b.r === this.rot;
  }

  // -- persistence ---------------------------------------------------------
  serialize() {
    const out = [];
    for (const [k, v] of this.blocks) {
      const [cx, cy, cz] = unkey(k);
      out.push([cx, cy, cz, v.s, v.m, v.r]);
    }
    return out;
  }

  restore(list, clear = true) {
    if (clear) this.blocks.clear();
    if (!Array.isArray(list)) return;
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const [cx, cy, cz, s, m, r] = row;
      if (!SHAPE_BY_ID[s] || !PAINT_BY_ID[m]) continue;
      this.blocks.set(keyOf(cx | 0, cy | 0, cz | 0), { s, m, r: (r | 0) % 4 });
    }
    this.dirty = true;
    this.rebuild();
  }

  clear() {
    this.blocks.clear();
    this.history.length = 0;
    this.future.length = 0;
    this.dirty = true;
    this.rebuild();
  }

  /** Count of each paint used — handy for the HUD. */
  paintStats() {
    const stats = {};
    for (const v of this.blocks.values()) stats[v.m] = (stats[v.m] || 0) + 1;
    return stats;
  }
}

export const BUILD_SHAPES = SHAPES;
export const BUILD_PAINTS = PAINTS;
