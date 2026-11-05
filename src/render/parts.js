/**
 * Parts — the vocabulary of the building system.
 *
 * Every piece is generated from a handful of boxes, wedges and cylinders, and
 * baked with its own painted tones (light top, mid body, dark underside) so a
 * wall made of a hundred blocks still reads as brushwork rather than a
 * grey mass. There are no textures and no models: a piece is ~40 triangles.
 *
 * The catalogue is deliberately small and orthogonal — shape × paint ×
 * rotation × layer — so the combinations are huge while the UI stays one
 * thumb away from everything.
 */
import * as THREE from 'three';

export const CELL = 1.0;      // grid pitch in world units
export const LAYER = 0.62;    // block height

// ---------------------------------------------------------------------------
// paints
// ---------------------------------------------------------------------------
const rgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const PAINTS = [
  { id: 'oak', name: 'Oak', hex: '#a87a4a', family: 'wood' },
  { id: 'pine', name: 'Pine', hex: '#c8a06a', family: 'wood' },
  { id: 'darkwood', name: 'Old wood', hex: '#6d4a2d', family: 'wood' },
  { id: 'stone', name: 'Stone', hex: '#7a8396', family: 'stone' },
  { id: 'slate', name: 'Slate', hex: '#535d72', family: 'stone' },
  { id: 'brick', name: 'Brick', hex: '#a05a44', family: 'stone' },
  { id: 'clay', name: 'Clay', hex: '#b4763f', family: 'stone' },
  { id: 'thatch', name: 'Thatch', hex: '#c9a76a', family: 'fiber' },
  { id: 'moss', name: 'Moss', hex: '#5f8046', family: 'fiber' },
  { id: 'glass', name: 'Glass', hex: '#cfe0d8', family: 'stone', glow: true },
];
export const PAINT_BY_ID = Object.fromEntries(PAINTS.map((p) => [p.id, p]));

function tones(paintId) {
  const base = rgb(PAINT_BY_ID[paintId]?.hex || '#a87a4a');
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  return {
    base,
    top: [Math.min(1, base[0] * 1.28 + 0.06), Math.min(1, base[1] * 1.26 + 0.06), Math.min(1, base[2] * 1.2 + 0.05)],
    light: mul(base, 1.02),
    mid: mul(base, 0.93),
    dark: mul(base, 0.76),
    deep: mul(base, 0.55),
  };
}

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const GREENS = { top: [0.44, 0.60, 0.24], mid: [0.33, 0.48, 0.20], dark: [0.20, 0.32, 0.15] };

// ---------------------------------------------------------------------------
// tiny triangle builder
// ---------------------------------------------------------------------------
class Geo {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) {
      this.nor.push(nx, ny, nz);
      this.col.push(col[0], col[1], col[2]);
    }
  }

  quad(a, b, c, d, col) {
    this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], col);
    this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], col);
  }

  /** Axis-aligned box from corner (x0,y0,z0) to (x1,y1,z1). */
  box(x0, y0, z0, x1, y1, z1, tone) {
    const { top, light, mid, dark, deep } = tone;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top);      // top
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], deep);     // bottom
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], light);    // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], dark);     // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], mid);      // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], mid);      // -x
  }

  /** Box centred on x/z. */
  cube(cx, y0, cz, w, h, d, tone) {
    this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, tone);
  }

  /** Tapered cylinder (column, post, log). */
  cyl(cx, y0, cz, rTop, rBot, h, seg, tone) {
    const { top, light, mid, dark } = tone;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0);
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const shade = 0.78 + 0.22 * Math.max(0, Math.cos((a0 + a1) * 0.5 - 0.6));
      const col = [mid[0] * shade, mid[1] * shade, mid[2] * shade];
      this.quad(
        [cx + c0 * rBot, y0, cz + s0 * rBot],
        [cx + c1 * rBot, y0, cz + s1 * rBot],
        [cx + c1 * rTop, y0 + h, cz + s1 * rTop],
        [cx + c0 * rTop, y0 + h, cz + s0 * rTop],
        col,
      );
      this.tri(cx, y0 + h, cz, cx + c0 * rTop, y0 + h, cz + s0 * rTop, cx + c1 * rTop, y0 + h, cz + s1 * rTop, top);
    }
    void light; void dark;
  }

  /** Sloped wedge rising along +x, full height at x1. */
  wedge(x0, y0, z0, x1, y1, z1, tone) {
    const { top, light, dark, deep, mid } = tone;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y0, z1], light);      // tri-ish +z
    this.tri(x0, y0, z1, x1, y1, z1, x0, y1, z1, light);
    this.tri(x0, y0, z0, x0, y1, z0, x1, y1, z0, dark);                           // -z
    this.tri(x0, y0, z0, x1, y1, z0, x1, y0, z0, dark);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], mid);       // +x face
    this.tri(x0, y0, z0, x1, y0, z1, x0, y0, z1, deep);                           // floor
    this.tri(x0, y0, z0, x1, y0, z0, x1, y0, z1, deep);
    // slope
    this.quad([x0, y0, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(new Float32Array((this.pos.length / 3) * 2), 2));
    g.computeBoundingSphere();
    return g;
  }
}

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------
const S = 0.94;    // footprint of a solid piece
const H = LAYER;   // one layer

export const SHAPES = [
  {
    id: 'block', name: 'Block', cat: 'solid', cost: 1,
    build(g, t) { g.cube(0, 0, 0, S, H, S, t); },
  },
  {
    id: 'slab', name: 'Slab', cat: 'solid', cost: 1,
    build(g, t) { g.box(-S / 2, 0, -S / 2, S / 2, H * 0.34, S / 2, t); },
  },
  {
    id: 'floor', name: 'Floor', cat: 'solid', cost: 1,
    build(g, t) { g.box(-S / 2, 0, -S / 2, S / 2, 0.11, S / 2, t); },
  },
  {
    id: 'wall', name: 'Wall', cat: 'build', cost: 1,
    build(g, t) { g.box(-S / 2, 0, -0.13, S / 2, H, 0.13, t); },
  },
  {
    id: 'pillar', name: 'Pillar', cat: 'build', cost: 2,
    build(g, t) {
      g.box(-0.26, 0, -0.26, 0.26, 0.08, 0.26, t);
      g.cyl(0, 0.06, 0, 0.17, 0.20, H - 0.12, 8, t);
      g.box(-0.24, H - 0.08, -0.24, 0.24, H, 0.24, t);
    },
  },
  {
    id: 'arch', name: 'Arch', cat: 'build', cost: 3,
    build(g, t) {
      g.box(-S / 2, 0, -0.11, -0.26, H, 0.11, t);
      g.box(0.26, 0, -0.11, S / 2, H, 0.11, t);
      g.box(-S / 2, H - 0.16, -0.13, S / 2, H, 0.13, t);
    },
  },
  {
    id: 'window', name: 'Window', cat: 'build', cost: 2,
    build(g, t) {
      g.box(-S / 2, 0, -0.09, S / 2, 0.30, 0.09, t);
      g.box(-S / 2, H - 0.18, -0.09, S / 2, H, 0.09, t);
      g.box(-S / 2, 0.30, -0.09, -0.30, H - 0.18, 0.09, t);
      g.box(0.30, 0.30, -0.09, S / 2, H - 0.18, 0.09, t);
      g.box(-0.02, 0.30, -0.06, 0.02, H - 0.18, 0.06, t);
    },
  },
  {
    id: 'ramp', name: 'Ramp', cat: 'build', cost: 2,
    build(g, t) { g.wedge(-S / 2, 0, -S / 2, S / 2, H, S / 2, t); },
  },
  {
    id: 'stair', name: 'Stairs', cat: 'build', cost: 3,
    build(g, t) {
      for (let i = 0; i < 3; i++) {
        const x0 = -S / 2 + (i * S) / 3;
        g.box(x0, 0, -S / 2, x0 + S / 3, (H * (i + 1)) / 3, S / 2, t);
      }
    },
  },
  {
    id: 'roof', name: 'Roof', cat: 'build', cost: 2,
    build(g, t) {
      const { top, light, dark, mid, deep } = t;
      const y0 = 0.02;
      const apex = H * 1.02;
      const eave = S / 2 - 0.01;
      // two slopes, each split into shingle bands so a row of roofs reads as
      // overlapping tiles instead of one extruded slab
      const bands = 3;
      for (let i = 0; i < bands; i++) {
        const f0 = i / bands;
        const f1 = (i + 1) / bands;
        const z0 = eave * (1 - f0), z1 = eave * (1 - f1);
        const yA = y0 + (apex - y0) * f0;
        const yB = y0 + (apex - y0) * f1;
        const tone = i % 2 === 0 ? light : mid;
        const toneB = i % 2 === 0 ? dark : mul(dark, 0.9);
        g.quad([-eave, yA, z0], [eave, yA, z0], [eave, yB, z1], [-eave, yB, z1], tone);
        g.quad([eave, yA, -z0], [-eave, yA, -z0], [-eave, yB, -z1], [eave, yB, -z1], toneB);
      }
      g.quad([-eave, apex + 0.01, 0.03], [eave, apex + 0.01, 0.03], [eave, apex + 0.04, -0.0], [-eave, apex + 0.04, 0.0], top);
      g.tri(-eave, y0, -eave, -eave, y0, eave, -eave, apex, 0, mid);
      g.tri(eave, y0, eave, eave, y0, -eave, eave, apex, 0, mid);
      g.quad([-eave, y0, eave], [-eave, y0, -eave], [eave, y0, -eave], [eave, y0, eave], deep);
    },
  },
  {
    id: 'fence', name: 'Fence', cat: 'decor', cost: 1,
    build(g, t) {
      g.box(-0.42, 0, -0.06, -0.30, H * 0.9, 0.06, t);
      g.box(0.30, 0, -0.06, 0.42, H * 0.9, 0.06, t);
      g.box(-0.46, H * 0.72, -0.05, 0.46, H * 0.84, 0.05, t);
      g.box(-0.46, H * 0.42, -0.05, 0.46, H * 0.54, 0.05, t);
    },
  },
  {
    id: 'lantern', name: 'Lantern', cat: 'decor', cost: 2,
    build(g, t) {
      g.cyl(0, 0, 0, 0.055, 0.075, H + 0.12, 6, t);
      g.box(-0.13, H + 0.04, -0.13, 0.13, H + 0.26, 0.13, {
        ...t,
        top: [1.75, 1.55, 1.05],
        light: [1.65, 1.45, 0.95],
        mid: [1.35, 1.15, 0.72],
        dark: [0.95, 0.80, 0.48],
        deep: [0.70, 0.58, 0.34],
      });
    },
  },
  {
    id: 'planter', name: 'Planter', cat: 'decor', cost: 1,
    build(g, t) {
      g.box(-0.40, 0, -0.40, 0.40, 0.26, 0.40, t);
      const b = [
        [0.0, 0.62, 0.0, 0.34],
        [0.24, 0.52, 0.14, 0.24],
        [-0.20, 0.54, -0.16, 0.26],
      ];
      for (const [x, y, z, r] of b) {
        for (let i = 0; i < 5; i++) {
          const a0 = (i / 5) * Math.PI * 2;
          const a1 = ((i + 1) / 5) * Math.PI * 2;
          const px0 = x + Math.cos(a0) * r, pz0 = z + Math.sin(a0) * r;
          const px1 = x + Math.cos(a1) * r, pz1 = z + Math.sin(a1) * r;
          const shade = 0.72 + 0.3 * Math.max(0, Math.cos((a0 + a1) * 0.5 - 0.5));
          const col = [GREENS.mid[0] * shade, GREENS.mid[1] * shade, GREENS.mid[2] * shade];
          g.tri(px0, y - 0.10, pz0, px1, y - 0.10, pz1, x, y + 0.16, z, col);
          g.tri(px1, y - 0.10, pz1, px0, y - 0.10, pz0, x, y - 0.16, z, GREENS.dark);
        }
      }
    },
  },
  {
    id: 'banner', name: 'Banner', cat: 'decor', cost: 2,
    build(g, t) {
      g.cyl(0, 0, 0, 0.05, 0.07, H * 1.9, 6, t);
      g.box(0.05, H * 1.55, -0.03, 0.10, H * 1.65, 0.03, t);
      const cloth = {
        top: [0.66, 0.24, 0.22], light: [0.60, 0.22, 0.20], mid: [0.50, 0.18, 0.17], dark: [0.36, 0.13, 0.12], deep: [0.26, 0.09, 0.09],
      };
      g.box(0.08, H * 0.95, -0.02, 0.52, H * 1.58, 0.02, cloth);
    },
  },
];
export const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));

const geomCache = new Map();
export function shapeGeometry(shapeId, paintId) {
  const key = `${shapeId}|${paintId}`;
  let g = geomCache.get(key);
  if (!g) {
    const shape = SHAPE_BY_ID[shapeId];
    const geo = new Geo();
    shape.build(geo, tones(paintId));
    g = geo.build();
    g.userData.tris = geo.pos.length / 9;
    geomCache.set(key, g);
  }
  return g;
}

export function clearGeomCache() {
  for (const g of geomCache.values()) g.dispose();
  geomCache.clear();
}

/** Cost of one piece, in the material's own family. */
export function pieceCost(shapeId, paintId) {
  const shape = SHAPE_BY_ID[shapeId] || SHAPES[0];
  const paint = PAINT_BY_ID[paintId] || PAINTS[0];
  return { [paint.family]: shape.cost };
}
