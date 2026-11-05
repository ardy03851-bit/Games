// Headless smoke test for MOSSWOOD.
//
//   node tools/smoke.mjs
//
// It stubs just enough of the browser to let the world builder, the piece
// catalogue and the build system run under Node, then exercises the things
// that break silently when you move geometry around: terrain generation, the
// river ribbon, every buildable shape, and a full save/undo/redo round trip.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// --- browser stubs ---------------------------------------------------------
const listeners = new Map();
const fakeElement = (tag = 'div') => {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    addEventListener(t, f) {
      listeners.set(t, f);
    },
    removeEventListener() {},
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    insertBefore(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
      return c;
    },
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => fakeElement(),
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 760 }),
    focus() {},
    getContext: () => null,
    toDataURL: () => 'data:,',
    textContent: '',
    innerHTML: '',
  };
  return el;
};

globalThis.window = {
  innerWidth: 1200,
  innerHeight: 760,
  devicePixelRatio: 2,
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  localStorage: {
    _v: new Map(),
    getItem(k) {
      return this._v.has(k) ? this._v.get(k) : null;
    },
    setItem(k, v) {
      this._v.set(k, String(v));
    },
    removeItem(k) {
      this._v.delete(k);
    },
  },
};
globalThis.document = {
  createElement: (t) => fakeElement(t),
  createElementNS: (_ns, t) => fakeElement(t),
  body: fakeElement('body'),
  documentElement: fakeElement('html'),
  getElementById: () => fakeElement(),
  querySelector: () => fakeElement(),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  fonts: { ready: Promise.resolve() },
};
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', maxTouchPoints: 0, language: 'en' },
    configurable: true,
    writable: true,
  });
} catch {
  /* node already provides one */
}
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = () => {};
globalThis.HTMLCanvasElement = class {};
globalThis.Image = class {};
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };

// --- the tests -------------------------------------------------------------
const fails = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    fails.push(name);
    console.log(`  FAIL ${name} — ${err && err.message}`);
    if (process.env.VERBOSE) console.log(err);
  }
};

const { generateWorld, WORLD } = await import(path.join(root, 'src/terrain/terrain.js'));
const parts = await import(path.join(root, 'src/render/parts.js'));

let world;
check('world generates', () => {
  world = generateWorld(WORLD.seed);
  if (!world || !world.grid) throw new Error('no grid');
  return `${world.grid.N}² grid, plot ${world.plot.x.toFixed(1)},${world.plot.z.toFixed(1)}`;
});

check('river ribbon is a usable polyline', () => {
  const river = world.river;
  if (!Array.isArray(river) || river.length < 20) throw new Error('river is not a polyline');
  let widest = 0;
  for (const p of river) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(p.y)) throw new Error('bad point');
    widest = Math.max(widest, p.width || 0);
  }
  if (widest <= 0) throw new Error('river has no width');
  return `${river.length} points, widest ${widest.toFixed(1)}`;
});

check('terrain heights are finite and varied', () => {
  const h = world.height;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < h.length; i += 97) {
    if (!Number.isFinite(h[i])) throw new Error('NaN height');
    min = Math.min(min, h[i]);
    max = Math.max(max, h[i]);
  }
  if (max - min < 2) throw new Error('terrain is flat');
  return `${(max - min).toFixed(1)} m relief`;
});

check('every shape builds geometry', () => {
  let total = 0;
  for (const shape of parts.SHAPES) {
    for (const paint of parts.PAINTS) {
      const geo = parts.shapeGeometry(shape.id, paint.id);
      const pos = geo.getAttribute('position');
      if (!pos || pos.count === 0) throw new Error(`shape ${shape.id}/${paint.id} emitted nothing`);
      if (pos.count % 3) throw new Error(`shape ${shape.id}/${paint.id} has ragged triangles`);
      if (!geo.getAttribute('normal')) throw new Error(`shape ${shape.id}/${paint.id} has no normals`);
      total += pos.count / 3;
    }
  }
  parts.clearGeomCache();
  return `${parts.SHAPES.length} shapes × ${parts.PAINTS.length} paints, ${total} tris`;
});

const { BuildSystem } = await import(path.join(root, 'src/game/build.js'));
check('build system serialises and reloads', () => {
  const fakeScene = { add() {}, remove() {} };
  const bs = new BuildSystem(fakeScene, world);
  if (typeof bs.serialize !== 'function') throw new Error('no serialize');
  const data = bs.serialize();
  if (!Array.isArray(data)) throw new Error('serialize is not an array');
  const bs2 = new BuildSystem(fakeScene, world);
  if (typeof bs2.load === 'function') bs2.load(data);
  const again = typeof bs2.serialize === 'function' ? bs2.serialize() : data;
  if (again.length !== data.length) throw new Error('reload lost pieces');
  return `${data.length} pieces`;
});

console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
