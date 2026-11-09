/**
 * Game — assembles the world, owns the loop, and turns taps into actions.
 */
import * as THREE from 'three';
import { Engine, Atmosphere } from '../core/engine.js';
import { Input } from '../core/input.js';
import { shared, PALETTE } from '../core/shared.js';
import { generateWorld, WORLD } from '../terrain/terrain.js';
import { buildTerrainMesh } from '../render/terrainMesh.js';
import { Vegetation } from '../render/vegetation.js';
import { WaterSystem } from '../render/water.js';
import { Fireflies, Mist, PuffPool, LanternGlow } from '../render/effects.js';
import { Player } from './player.js';
import { BuildSystem, SHAPES, PAINTS, SHAPE_BY_ID, PAINT_BY_ID, TOOLS, CELL, LAYER } from './build.js';
import { Audio } from './audio.js';
import { saveGame, loadGame, clearSave, saveSettings, loadSettings } from './save.js';


const NODE_YIELD = {
  tree: { wood: 3 },
  rock: { stone: 3 },
  bush: { fiber: 3 },
  log: { wood: 4 },
};

const REACH = 2.9;

export class Game {
  constructor(ui) {
    this.ui = ui;
    this.audio = new Audio();
    this.engine = new Engine(document.getElementById('game'));
    this.input = new Input(document.getElementById('game'));
    this.clock = new THREE.Clock();
    this.time = 0;
    this.paused = true;
    this.started = false;
    this.nodes = [];
    this.pendingNode = null;
    this.tapPoint = new THREE.Vector3();
    this.loaded = false;
    this.saveTimer = 0;
    this.settings = loadSettings();
    this.muted = !!this.settings.muted;
    this.autoQuality = this.settings.quality !== undefined;
    if (typeof this.settings.quality === 'number') this.engine.setQuality(this.settings.quality);
    this.audio.setMuted(this.muted);
    this.ui.setMuted(this.muted);
    this.bindInput();
    this.bindUI();
  }

  // ------------------------------------------------------------------ setup
  bindUI() {
    const ui = this.ui;
    ui.cb.onPlay = (resume) => this.start(resume);
    ui.cb.onReset = () => this.newValley();
    ui.cb.onToggleTray = (force) => this.toggleTray(force);
    ui.cb.onSelectItem = (id) => this.pickShape(id);
    ui.cb.onPickPaint = (id) => this.pickPaint(id);
    ui.cb.onTool = (id) => this.setTool(id);
    ui.cb.onLayer = (dir) => this.changeLayer(dir);
    ui.cb.onUndo = () => this.undo();
    ui.cb.onRedo = () => this.redo();
    ui.cb.onRotate = () => this.rotatePiece();
    ui.cb.onRemove = () => this.setTool('erase');
    ui.cb.onCancel = () => this.cancelPlacing();
    ui.cb.onSound = () => this.toggleSound();
    ui.cb.onStick = (x, y, active) => this.input.setJoystick(x, y, active);
    ui.cb.onQuality = () => this.cycleQuality();
    ui.cb.onHelpToggle = (on) => {
      if (!this.started) return;
      this.paused = on;
    };
  }

  bindInput() {
    this.input.on('tap', (x, y) => this.onTap(x, y));
    this.input.on('move', (x, y) => this.onPointerMove(x, y));
    this.input.on('key', (code, e) => this.onKey(code, e));
  }

  // ------------------------------------------------------------------- boot
  async load() {
    const ui = this.ui;
    const save = loadGame();
    this.saveData = save;
    ui.setHasSave(!!save);
    const seed = save?.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.seed = seed;

    ui.setLoading(0.06, 'Shaping the valley…');
    await nextFrame();
    this.world = generateWorld(seed);

    ui.setLoading(0.42, 'Painting the grass…');
    await nextFrame();
    this.terrain = buildTerrainMesh(this.world);
    this.engine.scene.add(this.terrain);

    ui.setLoading(0.62, 'Planting every leaf…');
    await nextFrame();
    this.vegetation = new Vegetation(this.engine.scene, this.world);

    ui.setLoading(0.86, 'Filling the river…');
    await nextFrame();
    this.water = new WaterSystem(this.engine.scene, this.world);
    this.fireflies = new Fireflies(this.engine.scene, this.world, this.engine.quality > 0 ? 300 : 160);
    this.mist = new Mist(this.engine.scene, this.world);
    this.lanternGlow = new LanternGlow(this.engine.scene);
    this.puffs = new PuffPool(this.engine.scene, this.engine.quality > 0 ? 460 : 240);
    this.effects = {
      dust: (x, y, z, scale = 1) => this.spawnDust(x, y, z, scale),
      smoke: (x, y, z) => this.spawnSmoke(x, y, z),
      leaves: (x, y, z, color) => this.spawnLeaves(x, y, z, color),
      chips: (x, y, z, color) => this.spawnChips(x, y, z, color),
    };

    ui.setLoading(0.94, 'Waking the wanderer…');
    await nextFrame();
    this.player = new Player(this.engine.scene, this.world);
    this.resources = { wood: 24, stone: 12, fiber: 12 };
    this.building = false;
    this.build = new BuildSystem(this.engine.scene, this.world, {
      getResources: () => this.resources,
      spend: (cost) => {
        for (const [k, v] of Object.entries(cost)) this.resources[k] = (this.resources[k] || 0) - v;
        this.syncResources();
      },
      refund: (cost) => {
        for (const [k, v] of Object.entries(cost)) this.resources[k] = (this.resources[k] || 0) + v;
        this.syncResources();
      },
      onFeedback: (msg) => { this.audio.error(); this.ui.hint(msg, 1700); },
      onPlace: (cx, cy, cz) => {
        this.audio.place();
        this.spawnDust(cx * CELL, this.build.worldY(cx, cy, cz) + 0.1, cz * CELL, 0.7);
      },
      onErase: (cx, cy, cz) => {
        this.audio.remove();
        this.spawnDust(cx * CELL, this.build.worldY(cx, cy, cz) + 0.2, cz * CELL, 1.1);
      },
    });

    this.atmosphere = new Atmosphere(this.engine, save?.time ?? 0.66);
    this.rings = this.makeRings();

    // gather nodes from the vegetation
    const all = [
      ...this.vegetation.nodes.trees,
      ...this.vegetation.nodes.rocks,
      ...this.vegetation.nodes.bushes,
      ...this.vegetation.nodes.logs,
    ];
    for (const n of all) {
      n.remaining = 3;
      n.cooling = 0;
      n.energy = 1;
    }
    this.nodes = all;

    ui.buildBuilder(SHAPES, PAINTS, TOOLS);
    ui.setLayer(0);
    ui.setHistory(0, 0);
    this.ui.setLoading(1, 'Done');

    // restore an existing save
    if (save) {
      if (save.resources) Object.assign(this.resources, save.resources);
      // one-time relief: saves from before the economy rework could strand a
      // player at zero materials with nothing left to gather
      if ((save.v ?? 0) < 4) {
        this.resources.wood = Math.max(this.resources.wood, 24);
        this.resources.stone = Math.max(this.resources.stone, 12);
        this.resources.fiber = Math.max(this.resources.fiber, 12);
      }
      if (save.pieces?.length) this.build.restore(save.pieces);
      if (save.player) {
        this.player.position.set(save.player.x, this.world.heightAt(save.player.x, save.player.z), save.player.z);
        this.player.group.position.copy(this.player.position);
      }
    }
    this.syncResources();
    this.engine.follow(this.player.position, 0, true);
    this.loaded = true;
  }

  makeRings() {
    const mk = (color, size) => {
      const geo = new THREE.RingGeometry(0.42, 0.52, 24);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(size);
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.engine.scene.add(m);
      return m;
    };
    return { hover: mk(0xffe9a8, 1.2), tap: mk(0xffe9a8, 0.4) };
  }

  // ------------------------------------------------------------------ start
  async start(resume) {
    if (this.paused && this.started) { this.paused = false; return; }
    this.ui.showScreen('title', false);
    this.ui.showScreen('hud', true);
    this.audio.resume();
    this.started = true;
    this.paused = false;
    this.ui.setStickVisible(this.engine.mobile || navigator.maxTouchPoints > 1);
    this.clock.getDelta();
    this.ui.hint(this.engine.mobile ? 'Thumb-stick to walk · tap the woods to gather' : 'WASD to walk · tap plants and rocks to gather', 4200);
    this.loop();
    if (!resume) this.ui.toast('Gather wood, stone and fiber — then build something.');
  }

  newValley() {
    clearSave();
    this.settings.seed = undefined;
    saveSettings(this.settings);
    location.reload();
  }

  cycleQuality() {
    const order = [2, 1, 0];
    const next = order[(order.indexOf(this.engine.quality) + 1) % order.length];
    this.engine.setQuality(next);
    this.settings.quality = next;
    saveSettings(this.settings);
    this.ui.setQualityLabel(['low', 'medium', 'high'][next]);
    this.ui.toast(`Quality: ${['low', 'medium', 'high'][next]}`);
  }

  toggleSound() {
    this.muted = !this.muted;
    this.audio.resume();
    this.audio.setMuted(this.muted);
    this.ui.setMuted(this.muted);
    this.settings.muted = this.muted;
    saveSettings(this.settings);
  }

  syncResources() {
    this.ui.updateResources(this.resources);
  }

  // ------------------------------------------------------------- interaction
  onKey(code, e) {
    if (!this.started) return;
    if (code === 'KeyB') this.toggleTray();
    else if (code === 'KeyT') this.setTool(this.build.tool === 'build' ? 'erase' : 'build');
    else if (code === 'Escape') this.cancelPlacing();
    else if (code === 'KeyR') this.rotatePiece();
    else if (code === 'KeyE' || code === 'Space') this.interactNearby();
    else if (code === 'KeyZ') this.undo();
    else if (code === 'KeyX') this.redo();
    else if (code === 'KeyQ') this.changeLayer(-1);
    else if (code === 'KeyF') this.changeLayer(1);
    else if (/^Digit[1-9]$/.test(code)) {
      const idx = Number(code.slice(5)) - 1;
      const shape = SHAPES[idx];
      if (shape) {
        this.ui.setTrayOpen(true);
        this.building = true;
        this.build.setTool('build');
        this.pickShape(shape.id);
      }
    }
    void e;
  }

  onPointerMove(clientX, clientY) {
    if (!this.loaded || !this.building) return;
    const p = this.pickGround(clientX, clientY);
    if (!p) return;
    {
      this.build.cursor.valid = true;
      this.build.moveCursor(p.x, p.z);
      // dragging lays a run of pieces, one per cell
      if (this.input.pointer.down && this.dragCell !== `${this.build.cursor.cx},${this.build.cursor.cz}`) {
        this.dragCell = `${this.build.cursor.cx},${this.build.cursor.cz}`;
        if (this.build.tool !== 'erase' || this.build.blockerAt(this.build.cursor.cx, this.build.cursor.cy, this.build.cursor.cz)) {
          this.build.commit();
        }
      }
    }
  }

  onTap(clientX, clientY) {
    if (!this.started || this.paused) return;
    this.audio.resume();
    const p = this.pickGround(clientX, clientY);
    if (!p) return;

    if (this.building) {
      this.build.cursor.valid = true;
      this.build.moveCursor(p.x, p.z);
      this.dragCell = `${this.build.cursor.cx},${this.build.cursor.cz}`;
      const ok = this.build.commit();
      if (ok) this.pulseRing(this.rings.tap, p.x, p.z, 1.7);
      return;
    }

    // gather node?
    const node = this.nodeAt(p.x, p.z, 2.6);
    if (node) {
      this.requestGather(node);
    } else {
      this.player.walkTo(p.x, p.z);
      this.pendingNode = null;
      this.pulseRing(this.rings.tap, p.x, p.z, 1.9);
    }
  }

  interactNearby() {
    let best = null, bestD = REACH + 0.6;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - this.player.x, n.z - this.player.z);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) this.requestGather(best);
  }

  nodeAt(x, z, radius) {
    let best = null, bestD = radius;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  requestGather(node) {
    const d = Math.hypot(node.x - this.player.x, node.z - this.player.z);
    if (d > REACH) {
      this.player.walkTo(node.x, node.z);
      this.pendingNode = node;
      this.ui.hint('Walking over…', 1200);
      return;
    }
    this.doGather(node);
  }

  doGather(node) {
    const now = performance.now();
    if (node.cooling > now) {
      this.ui.hint(node.kind === 'rock' ? 'This boulder is spent for a while' : 'Let it rest a moment', 1400);
      this.audio.error();
      return;
    }
    const give = NODE_YIELD[node.kind] || { wood: 1 };
    for (const [k, v] of Object.entries(give)) this.resources[k] = (this.resources[k] || 0) + v;
    this.syncResources();
    this.vegetation.nudge(node, 1);
    this.audio.gather();

    const colors = {
      tree: [PALETTE.grassMid, PALETTE.grassLight, PALETTE.woodLight],
      rock: [PALETTE.rockLight, PALETTE.rockMid, PALETTE.stoneWarm],
      bush: [PALETTE.grassDeep, PALETTE.grassMid, PALETTE.grassSun],
      log: [PALETTE.bark, PALETTE.woodLight, PALETTE.wood],
    }[node.kind] || [PALETTE.grassMid];
    for (let i = 0; i < 9; i++) {
      const c = colors[i % colors.length];
      this.effects.chips(node.x + (Math.random() - 0.5) * 0.8, node.y + 0.9 + Math.random() * 0.8, node.z + (Math.random() - 0.5) * 0.8, c);
    }
    const screen = this.engine.worldToScreen(new THREE.Vector3(node.x, node.y + 1.5, node.z));
    if (screen.visible) {
      this.ui.floater(screen.x, screen.y, `+${Object.values(give)[0]} ${Object.keys(give)[0]}`);
    }
    this.pulseRing(this.rings.tap, node.x, node.z, 1.4);

    node.remaining -= 1;
    if (node.remaining <= 0) {
      node.remaining = 4;
      node.cooling = now + 20000;
    }
    this.pendingNode = null;
  }

  // ------------------------------------------------------------------ build
  toggleTray(force) {
    if (!this.started) return;
    const open = force !== undefined ? force : !this.ui.el.tray.classList.contains('open');
    this.ui.setTrayOpen(open);
    this.building = open;
    this.ui.setPlacing(open);
    if (open) {
      this.build.cursor.valid = true;
      const p = this.input.pointer.inside
        ? this.pickGround(this.input.pointer.x, this.input.pointer.y)
        : null;
      const gx = p ? p.x : this.player.x;
      const gz = p ? p.z : this.player.z + 1.8;
      this.build.moveCursor(gx, gz);
      this.ui.hint('Pick a piece and a paint, then tap the ground. Drag to lay a run.', 3600);
    } else {
      this.build.cursor.valid = false;
    }
    this.audio.click();
  }

  pickShape(id) {
    if (!SHAPE_BY_ID[id]) return;
    const cost = this.build.costFor(id, this.build.paintId);
    if (!this.build.canPay(cost)) {
      const need = Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(', ');
      this.ui.hint(`Needs ${need} — tap trees, boulders and bushes to gather`, 3200);
    }
    this.build.setTool('build');
    this.build.setShape(id);
    this.building = true;
    this.ui.setTool('build');
    this.ui.setShape(id);
    this.ui.setTrayOpen(false);
    this.ui.setPlacing(true);
    this.build.cursor.valid = true;
    const p = this.input.pointer.inside ? this.pickGround(this.input.pointer.x, this.input.pointer.y) : null;
    if (p) this.build.moveCursor(p.x, p.z);
    else this.build.moveCursor(this.player.x, this.player.z + 1.8);
    this.audio.click();
  }

  pickPaint(id) {
    if (!PAINT_BY_ID[id]) return;
    this.build.setPaint(id);
    this.ui.setPaint(id);
    this.audio.click();
  }

  setTool(id) {
    this.build.setTool(id);
    this.ui.setTool(id);
    this.audio.click();
    if (id === 'erase') this.ui.hint('Tap a piece to take it back apart', 2200);
    if (id === 'paint') this.ui.hint('Tap a piece to repaint it', 2200);
  }

  rotatePiece() {
    this.build.rotate();
    this.audio.click();
  }

  changeLayer(dir) {
    this.build.raise(dir);
    this.ui.setLayer(this.build.layer);
    this.audio.click();
  }

  undo() {
    if (this.build.undo()) { this.audio.click(); this.ui.setHistory(this.build.history.length, this.build.future.length); }
    else this.audio.error();
  }

  redo() {
    if (this.build.redo()) { this.audio.click(); this.ui.setHistory(this.build.history.length, this.build.future.length); }
    else this.audio.error();
  }

  cancelPlacing() {
    this.building = false;
    this.build.cursor.valid = false;
    this.ui.setPlacing(false);
    this.ui.setTrayOpen(false);
  }

  // ------------------------------------------------------------------- pick
  /** March the pointer ray until it hits the heightfield. */
  pickGround(clientX, clientY) {
    const ray = this.engine.pointerRay(clientX, clientY);
    const o = ray.origin;
    const d = ray.direction;
    let t = 2;
    let prev = null;
    for (let i = 0; i < 220; i++) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (Math.abs(x) > this.world.size * 0.75 || Math.abs(z) > this.world.size * 0.75) return null;
      const h = this.world.heightAt(x, z);
      if (y <= h) {
        if (prev) {
          // bisect for a smooth point
          let lo = prev.t, hi = t;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            const mx = o.x + d.x * mid;
            const my = o.y + d.y * mid;
            const mz = o.z + d.z * mid;
            if (my <= this.world.heightAt(mx, mz)) hi = mid; else lo = mid;
          }
          t = hi;
        }
        const px = o.x + d.x * t;
        const pz = o.z + d.z * t;
        return { x: px, y: this.world.heightAt(px, pz), z: pz };
      }
      prev = { t };
      t += Math.max(0.35, t * 0.035);
    }
    return null;
  }

  // -------------------------------------------------------------- particles
  spawnDust(x, y, z, scale = 1) {
    for (let i = 0; i < 3; i++) {
      this.puffs.spawn(
        { x: x + (Math.random() - 0.5) * 0.3, y: y + 0.08, z: z + (Math.random() - 0.5) * 0.3 },
        {
          vx: (Math.random() - 0.5) * 0.7, vy: 0.25 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.7,
          color: [0.62, 0.56, 0.42], size: 0.34 * scale, life: 0.55, gravity: -0.5, alpha: 0.4,
        },
      );
    }
  }

  spawnSmoke(x, y, z) {
    this.puffs.spawn({ x, y, z }, {
      vx: 0.16 + (Math.random() - 0.5) * 0.2, vy: 0.55 + Math.random() * 0.25, vz: 0.1,
      color: [0.72, 0.72, 0.66], size: 0.42, life: 3.4, gravity: 0.05, alpha: 0.35,
    });
  }

  spawnLeaves(x, y, z, color) {
    this.puffs.spawn({ x, y, z }, {
      vx: (Math.random() - 0.5) * 1.4, vy: 0.9 + Math.random(), vz: (Math.random() - 0.5) * 1.4,
      color, size: 0.28, life: 1.6, gravity: -1.2, alpha: 0.9,
    });
  }

  spawnChips(x, y, z, color) {
    this.puffs.spawn({ x, y, z }, {
      vx: (Math.random() - 0.5) * 1.9, vy: 1.1 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.9,
      color, size: 0.22, life: 1.0, gravity: -5.5, alpha: 0.95,
    });
  }

  pulseRing(mesh, x, z, size) {
    const h = this.world.heightAt(x, z);
    mesh.position.set(x, h + 0.09, z);
    mesh.scale.setScalar(size * 0.5);
    mesh.material.opacity = 0.75;
    mesh.userData.pulse = performance.now();
    mesh.userData.grow = size;
    mesh.visible = true;
  }

  // ------------------------------------------------------------------- loop
  loop() {
    if (this._running) return;
    this._running = true;
    let last = performance.now();

    const tick = () => {
      if (!this._running) return;
      requestAnimationFrame(tick);
      const now = performance.now();
      let dt = (now - last) / 1000;
      last = now;
      if (!this.paused) {
        this.update(Math.min(dt, 0.06), dt * 1000);
      }
      this.engine.render();
      if (!this.paused) this.engine.monitor(dt * 1000);
    };
    requestAnimationFrame(tick);
  }

  update(dt, dtMs) {
    this.time += dt;
    shared.uTime.value = this.time;

    this.atmosphere.update(dt);
    const night = this.atmosphere.night;
    this.audio.setNight(night);
    this.audio.tick(dt);

    const move = this.input.moveVector();
    const speedMul = this.input.sprint ? 1.5 : 1;
    move.x *= speedMul;
    move.z *= speedMul;
    this.player.update(dt, move, this.build.colliders(), this.effects);
    this.engine.follow(this.player.position, dt);

    // pending walk-up-and-gather
    if (this.pendingNode) {
      const d = Math.hypot(this.pendingNode.x - this.player.x, this.pendingNode.z - this.player.z);
      if (d < REACH * 0.92) {
        const n = this.pendingNode;
        this.pendingNode = null;
        this.doGather(n);
      } else if (!this.player.target) {
        this.pendingNode = null;
      }
    }

    // hover ring on the closest gatherable
    let closest = null, cd = 3.8;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - this.player.x, n.z - this.player.z);
      if (d < cd) { cd = d; closest = n; }
    }
    if (closest && !this.building) {
      const ring = this.rings.hover;
      const h = this.world.heightAt(closest.x, closest.z);
      ring.position.set(closest.x, h + 0.07, closest.z);
      const pulse = 0.55 + Math.sin(this.time * 2.4) * 0.12;
      ring.material.opacity = pulse * (closest.cooling > performance.now() ? 0.18 : 0.42);
      ring.scale.setScalar(1.15 + Math.sin(this.time * 2.4) * 0.07);
      ring.visible = true;
    } else {
      this.rings.hover.visible = false;
    }

    // tap ripples
    for (const key of ['tap']) {
      const ring = this.rings[key];
      if (!ring.visible) continue;
      const age = (performance.now() - ring.userData.pulse) / 1000;
      if (age > 0.7) { ring.visible = false; continue; }
      const k = 1 - age / 0.7;
      ring.material.opacity = k * 0.55;
      ring.scale.setScalar(ring.userData.grow * (0.4 + (1 - k) * 0.8));
    }

    this.build.update(dt, night);
    // lanterns give light back: emissive heads + a warm pool on the ground
    for (const g of this.build.glowMats || []) {
      const k = (g.kind === 'window' ? 0.50 : 0.30) * night;
      g.mat.uniforms.uEmissive.value.setRGB(k, k * 0.72, k * 0.32);
    }
    this.lanternTimer = (this.lanternTimer || 0) + dt;
    if (this.lanternTimer > 0.4) {
      this.lanternTimer = 0;
      this.lanternGlow.update(this.build.lanternPositions(), night);
    }
    this.vegetation.update(dt);
    this.vegetation.shadows?.setNight(night);
    this.puffs.update(dt);
    this.fireflies.material.uniforms.uNightMix.value = night;

    const rd = this.world.fieldAt(this.world.riverMask, this.player.x, this.player.z);
    this.audio.setProximity(rd * 23);

    this.ui.setDay(this.atmosphere.label, night);
    this.saveTimer += dt;
    if (this.saveTimer > 14) {
      this.saveTimer = 0;
      this.persist();
    }
    void dtMs;
  }

  persist() {
    if (!this.loaded) return;
    saveGame({
      seed: this.seed,
      resources: this.resources,
      pieces: this.build.serialize(),
      player: { x: this.player.position.x, z: this.player.position.z },
      time: this.atmosphere.t,
      v: 4,
    });
  }
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
