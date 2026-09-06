/**
 * Procedurally baked leaf textures. One leaf per texture, rasterised from the unit-frame
 * silhouette + venation that @arbor/core provides (organs/leafShape.ts). Cached per species id.
 *
 * Unit frame: petiole junction at (0,0), lamina along +y to y = 1, x symmetric about 0.
 * Texture frame: the silhouette bbox fills the texture with a 2% margin, aspect preserved;
 * `unitToUv` maps unit coordinates to uv so the card geometry can use matching uvs.
 */
import * as THREE from 'three';
import { leafFamilyOf, leafSilhouette, resolveLeafShape, type LeafSilhouette, type SpeciesParams } from '@arbor/core';

export interface LeafTextures {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Grey mask: lamina 0.6, veins 0.2, background 0. Not wired into a material yet. */
  translucency: THREE.Texture;
  bbox: LeafSilhouette['bbox'];
  silhouette: LeafSilhouette;
  unitToUv: (x: number, y: number) => [number, number];
  debugCanvases: { albedo: HTMLCanvasElement; normal: HTMLCanvasElement; translucency: HTMLCanvasElement };
}

const ALBEDO_SIZE = 1024;
const NORMAL_SIZE = 512;
const MARGIN = 0.02;

const LAMINA: [number, number, number] = [0.80, 0.84, 0.78];
const VEIN: [number, number, number] = [0.95, 0.95, 0.85];
const PETIOLE: [number, number, number] = [0.70, 0.66, 0.55];
const MARGIN_BAND: [number, number, number] = [0.70, 0.74, 0.68];

const cache = new Map<string, LeafTextures>();

const css = (c: [number, number, number], a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/** Deterministic per-pixel hash noise in [0,1). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Frame { scale: number; ox: number; oy: number; W: number; H: number }

/** Mapping from the unit frame into a W×H texture (uv origin bottom-left, pixel origin top-left). */
function makeFrame(bbox: LeafSilhouette['bbox'], W: number, H: number): Frame {
  const bw = Math.max(1e-6, bbox.maxX - bbox.minX), bh = Math.max(1e-6, bbox.maxY - bbox.minY);
  const scale = Math.min(((1 - 2 * MARGIN) * W) / bw, ((1 - 2 * MARGIN) * H) / bh);
  const ox = W / 2 - (scale * (bbox.minX + bbox.maxX)) / 2;
  const oy = H / 2 - (scale * (bbox.minY + bbox.maxY)) / 2;
  return { scale, ox, oy, W, H };
}

/** Set the canvas transform so drawing happens in unit coordinates (y up). */
function applyFrame(ctx: CanvasRenderingContext2D, f: Frame): void {
  ctx.setTransform(f.scale, 0, 0, -f.scale, f.ox, f.H - f.oy);
}

function tracePolygons(ctx: CanvasRenderingContext2D, sil: LeafSilhouette): void {
  ctx.beginPath();
  for (const poly of sil.polygons) {
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.closePath();
  }
}

function strokeVeins(ctx: CanvasRenderingContext2D, sil: LeafSilhouette, widthMul: number, order: number, style: string): void {
  ctx.strokeStyle = style;
  ctx.lineCap = 'round';
  for (const v of sil.veins) {
    if (v.order !== order) continue;
    ctx.lineWidth = v.width * widthMul;
    ctx.beginPath(); ctx.moveTo(v.x0, v.y0); ctx.lineTo(v.x1, v.y1); ctx.stroke();
  }
}

/** Rows of an ImageData reversed so that row 0 is the bottom of the image (uv v = 0, flipY = false). */
function flipRows(src: Uint8ClampedArray, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  const row = W * 4;
  for (let y = 0; y < H; y++) out.set(src.subarray((H - 1 - y) * row, (H - y) * row), y * row);
  return out;
}

function dataTexture(data: Uint8Array, W: number, H: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function bakeAlbedo(sil: LeafSilhouette, W: number, H: number): { canvas: HTMLCanvasElement; data: Uint8Array } {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const f = makeFrame(sil.bbox, W, H);
  ctx.clearRect(0, 0, W, H);
  applyFrame(ctx, f);

  // petiole (below the lamina, drawn as the order-0 vein segment with y < 0)
  const midrib = sil.veins.find((v) => v.order === 0);
  if (midrib) {
    ctx.strokeStyle = css(PETIOLE); ctx.lineCap = 'round'; ctx.lineWidth = midrib.width * 1.15;
    ctx.beginPath(); ctx.moveTo(midrib.x0, midrib.y0); ctx.lineTo(midrib.x1, Math.min(midrib.y1, 0.03)); ctx.stroke();
  }

  // lamina: flat base, soft radial gradient (edges ~8% darker)
  tracePolygons(ctx, sil);
  const cx = (sil.bbox.minX + sil.bbox.maxX) / 2, cy = (Math.max(0, sil.bbox.minY) + sil.bbox.maxY) / 2;
  const rad = Math.max(sil.bbox.maxX - sil.bbox.minX, sil.bbox.maxY - Math.max(0, sil.bbox.minY)) * 0.6;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  grad.addColorStop(0, css(LAMINA));
  grad.addColorStop(1, css([LAMINA[0] * 0.92, LAMINA[1] * 0.92, LAMINA[2] * 0.92]));
  ctx.fillStyle = grad;
  ctx.fill('nonzero');

  // everything below only paints where the lamina already is
  ctx.globalCompositeOperation = 'source-atop';
  // margin band: stroke straddles the outline; only the inner half survives source-atop
  tracePolygons(ctx, sil);
  ctx.strokeStyle = css(MARGIN_BAND); ctx.lineWidth = 0.03; ctx.lineJoin = 'round'; ctx.stroke();
  // veins, widest first so finer orders sit on top
  strokeVeins(ctx, sil, 1.0, 0, css(VEIN));
  strokeVeins(ctx, sil, 1.0, 1, css(VEIN, 0.9));
  strokeVeins(ctx, sil, 1.0, 2, css(VEIN, 0.7));
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // per-pixel noise (±3%) and colour dilation into transparent texels (avoids dark fringes at alpha-tested edges)
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const lr = Math.round(LAMINA[0] * 255 * 0.96), lg = Math.round(LAMINA[1] * 255 * 0.96), lb = Math.round(LAMINA[2] * 255 * 0.96);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4) {
      if (d[i + 3] === 0) { d[i] = lr; d[i + 1] = lg; d[i + 2] = lb; continue; }
      const n = 1 + (hash2(x, y) - 0.5) * 0.06;
      d[i] = Math.min(255, d[i] * n); d[i + 1] = Math.min(255, d[i + 1] * n); d[i + 2] = Math.min(255, d[i + 2] * n);
    }
  }
  const data = flipRows(d, W, H);
  ctx.putImageData(img, 0, 0); // debug view (canvas drops colour under alpha 0, the DataTexture keeps it)
  return { canvas, data };
}

function bakeNormalAndTranslucency(sil: LeafSilhouette, S: number): { normal: HTMLCanvasElement; translucency: HTMLCanvasElement; normalData: Uint8Array; translucencyData: Uint8Array } {
  const f = makeFrame(sil.bbox, S, S);
  // vein layer: rasterise veins in white per order, weighted by the raise per order
  const veinCanvas = document.createElement('canvas');
  veinCanvas.width = S; veinCanvas.height = S;
  const vctx = veinCanvas.getContext('2d', { willReadFrequently: true })!;
  vctx.fillStyle = '#000'; vctx.fillRect(0, 0, S, S);
  applyFrame(vctx, f);
  vctx.globalCompositeOperation = 'lighter';
  // raise per order: 0 -> +0.25 (64/255), 1 -> +0.15 (38/255), 2 -> +0.07 (18/255, drawn a little wider/brighter so the blur keeps it)
  strokeVeins(vctx, sil, 1.8, 2, 'rgb(28,28,28)');
  strokeVeins(vctx, sil, 1.3, 1, 'rgb(38,38,38)');
  strokeVeins(vctx, sil, 1.0, 0, 'rgb(64,64,64)');
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  const veinImg = vctx.getImageData(0, 0, S, S).data;

  // lamina mask (for the translucency map)
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = S; maskCanvas.height = S;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  applyFrame(mctx, f);
  tracePolygons(mctx, sil); mctx.fillStyle = '#fff'; mctx.fill('nonzero');
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  const maskImg = mctx.getImageData(0, 0, S, S).data;

  // height field in uv orientation (row 0 = bottom)
  const halfW = Math.max(1e-3, Math.max(Math.abs(sil.bbox.minX), Math.abs(sil.bbox.maxX)));
  let h = new Float32Array(S * S);
  const vein = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const py = S - 1 - y; // image row
    for (let x = 0; x < S; x++) {
      const ux = (x + 0.5 - f.ox) / f.scale;
      const r = Math.min(1, Math.abs(ux) / halfW);
      const idx = y * S + x;
      h[idx] = 0.5 + 0.15 * (1 - r * r);
      vein[idx] = Math.min(0.3, veinImg[(py * S + x) * 4] / 255);
    }
  }
  // blur the vein layer (3 passes of a 3x3 box) so the veins read as soft ridges
  let a = vein, b = new Float32Array(S * S);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < S; y++) {
      const y0 = Math.max(0, y - 1), y1 = Math.min(S - 1, y + 1);
      for (let x = 0; x < S; x++) {
        const x0 = Math.max(0, x - 1), x1 = Math.min(S - 1, x + 1);
        b[y * S + x] = (a[y0 * S + x0] + a[y0 * S + x] + a[y0 * S + x1] + a[y * S + x0] + a[y * S + x] + a[y * S + x1] + a[y1 * S + x0] + a[y1 * S + x] + a[y1 * S + x1]) / 9;
      }
    }
    [a, b] = [b, a];
  }
  for (let i = 0; i < h.length; i++) h[i] += a[i];

  // normals by finite differences; strength tuned so veins read without looking embossed
  const strength = 6.0 * (S / 512);
  const normalData = new Uint8Array(S * S * 4);
  const translucencyData = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(S - 1, y + 1);
    for (let x = 0; x < S; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(S - 1, x + 1);
      const dx = (h[y * S + x1] - h[y * S + x0]) * 0.5 * strength;
      const dy = (h[y1 * S + x] - h[y0 * S + x]) * 0.5 * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      normalData[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      normalData[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      normalData[i + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      normalData[i + 3] = 255;
      const py = S - 1 - y;
      const inside = maskImg[(py * S + x) * 4] > 127;
      const t = inside ? 0.6 - 0.4 * Math.min(1, vein[y * S + x] / 0.15) : 0;
      const tv = Math.round(t * 255);
      translucencyData[i] = translucencyData[i + 1] = translucencyData[i + 2] = tv; translucencyData[i + 3] = 255;
    }
  }
  const toCanvas = (data: Uint8Array): HTMLCanvasElement => {
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(S, S);
    const row = S * 4;
    for (let y = 0; y < S; y++) img.data.set(data.subarray((S - 1 - y) * row, (S - y) * row), y * row);
    cx.putImageData(img, 0, 0);
    return c;
  };
  return { normal: toCanvas(normalData), translucency: toCanvas(translucencyData), normalData, translucencyData };
}

/** Silhouette for a species (family from `leaf.shape`, tuned by `leaf.shapeParams`). */
export function speciesSilhouette(sp: SpeciesParams): LeafSilhouette {
  const fam = leafFamilyOf(sp.leaf.shape);
  return leafSilhouette(resolveLeafShape(fam.family, { ...fam.overrides, ...(sp.leaf.shapeParams ?? {}) }), 96);
}

export function leafTextures(sp: SpeciesParams): LeafTextures {
  const hit = cache.get(sp.id);
  if (hit) return hit;
  const sil = speciesSilhouette(sp);
  const albedo = bakeAlbedo(sil, ALBEDO_SIZE, ALBEDO_SIZE);
  const nt = bakeNormalAndTranslucency(sil, NORMAL_SIZE);
  const frame = makeFrame(sil.bbox, ALBEDO_SIZE, ALBEDO_SIZE);
  const map = dataTexture(albedo.data, ALBEDO_SIZE, ALBEDO_SIZE, true);
  const normalMap = dataTexture(nt.normalData, NORMAL_SIZE, NORMAL_SIZE, false);
  const translucency = dataTexture(nt.translucencyData, NORMAL_SIZE, NORMAL_SIZE, false);
  map.name = `leaf-${sp.id}-albedo`; normalMap.name = `leaf-${sp.id}-normal`; translucency.name = `leaf-${sp.id}-translucency`;
  const out: LeafTextures = {
    map, normalMap, translucency, bbox: sil.bbox, silhouette: sil,
    unitToUv: (x, y) => [(frame.ox + x * frame.scale) / frame.W, (frame.oy + y * frame.scale) / frame.H],
    debugCanvases: { albedo: albedo.canvas, normal: nt.normal, translucency: nt.translucency },
  };
  cache.set(sp.id, out);
  return out;
}
