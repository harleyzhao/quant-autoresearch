/**
 * Procedural leaf silhouettes and venation (docs/plant-gen/04 §3.1).
 * Everything is in a unit frame: the petiole junction is at (0, 0), the lamina extends along +y
 * to y = 1, x is the width axis (symmetric about 0). Renderers rasterise the polygons and veins
 * into albedo/alpha/normal textures; the kernel never needs pixels.
 */

export type LeafFamily = 'simple' | 'lobed' | 'palmate' | 'pinnate' | 'needle';
export type LeafBase = 'cuneate' | 'rounded' | 'cordate' | 'truncate';
export type LeafApex = 'acute' | 'acuminate' | 'obtuse' | 'emarginate';

export interface LeafShapeParams {
  family: LeafFamily;
  /** Width / length of the lamina bounding box. */
  aspect: number;
  /** Position of the widest point along the length (0.35 ovate, 0.5 elliptic, 0.65 obovate). */
  widestAt: number;
  base: LeafBase;
  apex: LeafApex;
  /** Marginal teeth: amplitude relative to the local half-width, teeth per side. 0 = entire margin. */
  serration: { amplitude: number; count: number };
  /** lobed / palmate: lobes per side (lobed) or total (palmate), sinus depth 0..0.9, roundness 0 pointed .. 1 round. */
  lobes: { count: number; depth: number; round: number };
  /** pinnate: leaflets (total, odd = with terminal leaflet) and their aspect. */
  leaflets: { count: number; aspect: number };
  /** Petiole length as a fraction of lamina length (drawn as a vein below y = 0). */
  petiole: number;
  /** needle family only: the silhouette is a whole shoot (unit length) carrying `count` needles of relative `length`, fanning at `angle` degrees. */
  needle: { count: number; length: number; angle: number };
}

export interface Vein { x0: number; y0: number; x1: number; y1: number; width: number; order: number }

export interface LeafSilhouette {
  /** Closed polygons, xy pairs, counter-clockwise, in the unit frame. Several for compound leaves. */
  polygons: Float32Array[];
  veins: Vein[];
  /** Bounding box in the unit frame (includes petiole). */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

export const LEAF_FAMILY_DEFAULTS: Record<LeafFamily, LeafShapeParams> = {
  simple: { family: 'simple', aspect: 0.6, widestAt: 0.4, base: 'rounded', apex: 'acute', serration: { amplitude: 0.05, count: 18 }, lobes: { count: 0, depth: 0, round: 1 }, leaflets: { count: 1, aspect: 0.4 }, petiole: 0.2, needle: { count: 44, length: 0.32, angle: 55 } },
  lobed: { family: 'lobed', aspect: 0.6, widestAt: 0.6, base: 'cuneate', apex: 'obtuse', serration: { amplitude: 0, count: 0 }, lobes: { count: 4, depth: 0.45, round: 0.9 }, leaflets: { count: 1, aspect: 0.4 }, petiole: 0.1, needle: { count: 44, length: 0.32, angle: 55 } },
  palmate: { family: 'palmate', aspect: 1.1, widestAt: 0.5, base: 'cordate', apex: 'acute', serration: { amplitude: 0.04, count: 6 }, lobes: { count: 5, depth: 0.5, round: 0.15 }, leaflets: { count: 1, aspect: 0.4 }, petiole: 0.5, needle: { count: 44, length: 0.32, angle: 55 } },
  pinnate: { family: 'pinnate', aspect: 0.55, widestAt: 0.5, base: 'cuneate', apex: 'acute', serration: { amplitude: 0.03, count: 14 }, lobes: { count: 0, depth: 0, round: 1 }, leaflets: { count: 7, aspect: 0.38 }, petiole: 0.15, needle: { count: 44, length: 0.32, angle: 55 } },
  needle: { family: 'needle', aspect: 0.014, widestAt: 0.5, base: 'truncate', apex: 'acute', serration: { amplitude: 0, count: 0 }, lobes: { count: 0, depth: 0, round: 1 }, leaflets: { count: 1, aspect: 0.1 }, petiole: 0, needle: { count: 44, length: 0.32, angle: 55 } },
};

export function resolveLeafShape(family: LeafFamily, overrides?: Partial<LeafShapeParams>): LeafShapeParams {
  const d = LEAF_FAMILY_DEFAULTS[family];
  return { ...d, ...overrides, family, serration: { ...d.serration, ...(overrides?.serration ?? {}) }, lobes: { ...d.lobes, ...(overrides?.lobes ?? {}) }, leaflets: { ...d.leaflets, ...(overrides?.leaflets ?? {}) }, needle: { ...d.needle, ...(overrides?.needle ?? {}) } };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Half-width profile of a simple lamina along t ∈ [0,1], before teeth/lobes; peak value 0.5·aspect. */
function laminaHalfWidth(p: LeafShapeParams, t: number): number {
  const w = clamp(p.widestAt, 0.15, 0.85);
  // asymmetric bell: rises from base to widest point, falls to apex
  let s: number;
  if (t < w) {
    const u = t / w;
    const baseExp = p.base === 'cuneate' ? 0.75 : p.base === 'rounded' ? 0.4 : p.base === 'cordate' ? 0.25 : 0.15; // truncate = nearly full width at the base
    s = Math.pow(Math.sin((u * Math.PI) / 2), baseExp);
  } else {
    const u = (t - w) / (1 - w);
    let apexExp = 0.9;
    if (p.apex === 'obtuse' || p.apex === 'emarginate') apexExp = 0.45;
    if (p.apex === 'acuminate') apexExp = 1.6;
    s = Math.pow(Math.cos((u * Math.PI) / 2), apexExp);
    if (p.apex === 'acuminate' && u > 0.7) s = Math.max(s, 0.08 * (1 - u) / 0.3 * (u < 0.98 ? 1 : 0)); // drip tip
  }
  return 0.5 * p.aspect * s;
}

/** Marginal teeth as a multiplicative modulation of the half-width. */
function teeth(p: LeafShapeParams, t: number): number {
  const { amplitude, count } = p.serration;
  if (amplitude <= 0 || count <= 0 || t < 0.08 || t > 0.96) return 1;
  const phase = (t * count) % 1;
  // asymmetric saw: slow rise toward the apex side, sharp drop
  const saw = phase < 0.7 ? phase / 0.7 : (1 - phase) / 0.3;
  return 1 - amplitude * (1 - saw);
}

/** Pinnately lobed modulation (oak): sinuses cut toward the midrib between `count` lobes per side. */
function lobing(p: LeafShapeParams, t: number): number {
  const { count, depth, round } = p.lobes;
  if (count <= 0 || depth <= 0 || t < 0.06 || t > 0.97) return 1;
  const span = 0.91;
  const phase = ((t - 0.06) / span) * count; // lobe index + fraction
  const f = phase % 1;
  let wave = 0.5 - 0.5 * Math.cos(f * Math.PI * 2); // 1 at lobe tip, 0 at sinus
  const k = 0.5 + 3 * (1 - round);
  wave = Math.pow(wave, k) ; // pointed lobes when round -> 0
  return 1 - depth * (1 - wave);
}

function simpleOutline(p: LeafShapeParams, n: number, applyLobes: boolean): Float32Array {
  const right: number[] = [], left: number[] = [];
  const yNotch = p.base === 'cordate' ? 0.06 : 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let hw = laminaHalfWidth(p, t) * teeth(p, t);
    if (applyLobes) hw *= lobing(p, t);
    let y = t;
    if (p.base === 'cordate' && t < 0.2) {
      // basal lobes bulge below the petiole junction
      const u = 1 - t / 0.2;
      y = t - 0.08 * smooth(u) * Math.min(1, hw / (0.5 * p.aspect) * 2);
    }
    if (p.apex === 'emarginate' && t > 0.9) y = t - 0.04 * smooth((t - 0.9) / 0.1) * (1 - Math.abs(hw) / (0.5 * p.aspect + 1e-6));
    right.push(hw, y); left.push(-hw, y);
  }
  // CCW: up the right side, down the left; start and end at the base
  const out: number[] = [0, yNotch];
  for (let i = 0; i < right.length; i += 2) out.push(right[i], right[i + 1]);
  for (let i = left.length - 2; i >= 0; i -= 2) out.push(left[i], left[i + 1]);
  return Float32Array.from(out);
}

function palmateOutline(p: LeafShapeParams, n: number): Float32Array {
  const { count, depth, round } = p.lobes;
  const cx = 0, cy = 0.12; // point where the main veins meet, just above the petiole
  const thetaMax = Math.PI * 0.62; // lobes fan across ~225°
  const lobesN = Math.max(3, count | 0);
  const pts: number[] = [];
  const k = 0.5 + 3 * (1 - round);
  for (let i = 0; i <= n; i++) {
    const a = -thetaMax + (2 * thetaMax * i) / n; // angle from +y, CCW positive toward -x
    const u = (a + thetaMax) / (2 * thetaMax); // 0..1 across the fan
    const phase = u * (lobesN - 1); // lobe tips at integer phases
    const f = phase % 1;
    let wave = 0.5 + 0.5 * Math.cos(f * Math.PI * 2); // 1 at lobe tips
    wave = Math.pow(wave, k);
    const lobeIdx = Math.round(phase);
    const central = 1 - Math.abs(lobeIdx - (lobesN - 1) / 2) / ((lobesN - 1) / 2 + 1e-6); // 1 for the middle lobe
    const rBase = (1 - cy) * (0.72 + 0.28 * central); // outer lobes shorter
    let r = rBase * (1 - depth * (1 - wave));
    r *= teeth(p, 0.5 + 0.4 * f);
    const x = -Math.sin(a) * r * p.aspect, y = cy + Math.cos(a) * r;
    pts.push(x, y);
  }
  // close through the petiole junction with a small basal notch
  const out: number[] = [];
  // reverse to make it CCW (we swept from -x side to +x side going... ensure orientation below)
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  out.push(0, 0.02);
  return ensureCCW(Float32Array.from(out));
}

function ensureCCW(poly: Float32Array): Float32Array {
  let a = 0;
  for (let i = 0; i < poly.length; i += 2) {
    const j = (i + 2) % poly.length;
    a += poly[i] * poly[j + 1] - poly[j] * poly[i + 1];
  }
  if (a >= 0) return poly;
  const out = new Float32Array(poly.length);
  for (let i = 0, j = poly.length - 2; i < poly.length; i += 2, j -= 2) { out[i] = poly[j]; out[i + 1] = poly[j + 1]; }
  return out;
}

function transform(poly: Float32Array, sx: number, sy: number, angle: number, tx: number, ty: number): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = new Float32Array(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    const x = poly[i] * sx, y = poly[i + 1] * sy;
    out[i] = c * x - s * y + tx; out[i + 1] = s * x + c * y + ty;
  }
  return out;
}

/** Secondary veins of a simple/lobed lamina: from the midrib toward the margin, angled toward the apex. */
function pinnateVeins(p: LeafShapeParams, veins: Vein[], sx = 1, sy = 1, angle = 0, tx = 0, ty = 0, lobed = false): void {
  const c = Math.cos(angle), s = Math.sin(angle);
  const add = (x0: number, y0: number, x1: number, y1: number, width: number, order: number) => {
    veins.push({ x0: c * x0 * sx - s * y0 * sy + tx, y0: s * x0 * sx + c * y0 * sy + ty, x1: c * x1 * sx - s * y1 * sy + tx, y1: s * x1 * sx + c * y1 * sy + ty, width: width * Math.min(sx, sy), order });
  };
  add(0, -p.petiole, 0, 0.97, 0.028, 0);
  const pairs = lobed && p.lobes.count > 0 ? p.lobes.count : Math.max(4, Math.round(6 + 6 * (1 - p.aspect)));
  for (let i = 0; i < pairs; i++) {
    const t = lobed ? 0.06 + ((i + 0.5) / pairs) * 0.91 : 0.12 + (i / pairs) * 0.78;
    const reach = laminaHalfWidth(p, t) * (lobed ? 1 : 0.92);
    const rise = lobed ? 0.02 : 0.10 + 0.1 * (1 - p.aspect);
    for (const side of [1, -1]) {
      const x1 = side * reach, y1 = Math.min(0.98, t + rise);
      add(0, t, x1, y1, 0.012, 1);
      // a couple of tertiary veinlets
      for (let k = 1; k <= 2; k++) {
        const f = k / 3;
        const bx = x1 * f, by = t + (y1 - t) * f;
        add(bx, by, bx + side * reach * 0.22, by + 0.05, 0.005, 2);
      }
    }
  }
}

/** Build the silhouette for a family with `n` samples per side. */
export function leafSilhouette(params: LeafShapeParams, n = 96): LeafSilhouette {
  const p = params;
  const polygons: Float32Array[] = [];
  const veins: Vein[] = [];
  switch (p.family) {
    case 'simple':
      polygons.push(simpleOutline(p, n, false));
      pinnateVeins(p, veins);
      break;
    case 'lobed':
      polygons.push(simpleOutline(p, n, true));
      pinnateVeins(p, veins, 1, 1, 0, 0, 0, true);
      break;
    case 'palmate': {
      polygons.push(palmateOutline(p, n));
      const lobesN = Math.max(3, p.lobes.count | 0);
      const thetaMax = Math.PI * 0.62;
      veins.push({ x0: 0, y0: -p.petiole, x1: 0, y1: 0.12, width: 0.03, order: 0 });
      for (let i = 0; i < lobesN; i++) {
        const a = -thetaMax + (2 * thetaMax * i) / (lobesN - 1);
        const central = 1 - Math.abs(i - (lobesN - 1) / 2) / ((lobesN - 1) / 2 + 1e-6);
        const r = (1 - 0.12) * (0.72 + 0.28 * central) * 0.97;
        const x1 = -Math.sin(a) * r * p.aspect, y1 = 0.12 + Math.cos(a) * r;
        veins.push({ x0: 0, y0: 0.12, x1, y1, width: 0.022, order: 1 });
        for (let k = 1; k <= 3; k++) {
          const f = k / 4, bx = x1 * f, by = 0.12 + (y1 - 0.12) * f;
          const nx = -(y1 - 0.12), ny = x1; const nl = Math.hypot(nx, ny) || 1;
          for (const side of [1, -1]) veins.push({ x0: bx, y0: by, x1: bx + (side * nx / nl) * 0.14 * (1 - f) + x1 * 0.08, y1: by + (side * ny / nl) * 0.14 * (1 - f) + (y1 - 0.12) * 0.08, width: 0.008, order: 2 });
        }
      }
      break;
    }
    case 'pinnate': {
      const count = Math.max(3, p.leaflets.count | 0);
      const pairs = Math.floor(count / 2), terminal = count % 2 === 1;
      const leaflet: LeafShapeParams = { ...p, family: 'simple', aspect: p.leaflets.aspect, lobes: { count: 0, depth: 0, round: 1 }, petiole: 0.05 };
      const base = simpleOutline(leaflet, Math.max(24, n >> 2), false);
      const rachisTop = terminal ? 0.8 : 0.95;
      const len = 0.62 / (pairs + 0.5) * 1.6; // leaflet length relative to rachis
      veins.push({ x0: 0, y0: -p.petiole, x1: 0, y1: rachisTop, width: 0.024, order: 0 });
      for (let i = 0; i < pairs; i++) {
        const t = 0.12 + (i / Math.max(1, pairs - 1)) * (rachisTop - 0.2);
        const scale = len * (0.8 + 0.2 * Math.sin((i / Math.max(1, pairs - 1)) * Math.PI));
        for (const side of [1, -1]) {
          const ang = side * -(Math.PI / 2 - 0.55); // ~58° from the rachis, tips toward the apex
          polygons.push(transform(base, scale, scale, ang, 0, t));
          pinnateVeins(leaflet, veins, scale, scale, ang, 0, t);
        }
      }
      if (terminal) {
        polygons.push(transform(base, len, len, 0, 0, rachisTop - 0.02));
        pinnateVeins(leaflet, veins, len, len, 0, 0, rachisTop - 0.02);
      }
      break;
    }
    case 'needle': {
      // a whole needle-bearing shoot: twig along +y, needles alternating left/right in a fan
      const { count, length, angle } = p.needle;
      const w = Math.max(0.004, p.aspect);
      veins.push({ x0: 0, y0: 0, x1: 0, y1: 0.97, width: 0.035, order: 0 });
      for (let i = 0; i < count; i++) {
        const t = 0.03 + (0.85 * i) / Math.max(1, count - 1);
        const side = i % 2 === 0 ? 1 : -1;
        const jitter = ((i * 7919) % 97) / 97 - 0.5;
        const a = ((angle + jitter * 18) * Math.PI) / 180;
        const len = length * (0.85 + 0.3 * (((i * 104729) % 89) / 89));
        const dx = side * Math.sin(a), dy = Math.cos(a);
        const nx = -dy * w * 0.5, ny = dx * w * 0.5;
        polygons.push(Float32Array.from([nx, t + ny, -nx, t - ny, dx * len - nx * 0.4, t + dy * len - ny * 0.4, dx * len + nx * 0.4, t + dy * len + ny * 0.4].map((v) => v)));
      }
      // make sure each needle quad is CCW
      for (let k = 0; k < polygons.length; k++) polygons[k] = ensureCCW(polygons[k]);
      break;
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polygons) for (let i = 0; i < poly.length; i += 2) {
    if (poly[i] < minX) minX = poly[i]; if (poly[i] > maxX) maxX = poly[i];
    if (poly[i + 1] < minY) minY = poly[i + 1]; if (poly[i + 1] > maxY) maxY = poly[i + 1];
  }
  minY = Math.min(minY, -p.petiole);
  return { polygons, veins, bbox: { minX, minY, maxX, maxY } };
}

/** Signed area of a closed polygon (positive = CCW). */
export function polygonArea(poly: Float32Array): number {
  let a = 0;
  for (let i = 0; i < poly.length; i += 2) { const j = (i + 2) % poly.length; a += poly[i] * poly[j + 1] - poly[j] * poly[i + 1]; }
  return a / 2;
}

/** Map the species-level leaf shape keyword to a silhouette family (with sensible aspect for lanceolate). */
export function leafFamilyOf(shape: string): { family: LeafFamily; overrides: Partial<LeafShapeParams> } {
  switch (shape) {
    case 'lanceolate': return { family: 'simple', overrides: { aspect: 0.28, widestAt: 0.35, apex: 'acuminate', serration: { amplitude: 0.03, count: 24 } } };
    case 'lobed': return { family: 'lobed', overrides: {} };
    case 'palmate': return { family: 'palmate', overrides: {} };
    case 'pinnate': return { family: 'pinnate', overrides: {} };
    case 'needle': return { family: 'needle', overrides: {} };
    default: return { family: 'simple', overrides: {} };
  }
}
