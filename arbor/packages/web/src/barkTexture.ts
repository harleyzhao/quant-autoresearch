/**
 * Procedurally generated, tiling bark textures per bark family (docs/plant-gen/04 §3.2).
 * A height field is computed in JS from wrap-around value noise / fbm and jittered-grid
 * Voronoi, then turned into albedo, normal and roughness canvases. Cached per (family, size).
 */
import * as THREE from 'three';
import type { BarkFamily } from '@arbor/core';

export interface BarkTextures {
  family: BarkFamily;
  size: number;
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  debugCanvases: { albedo: HTMLCanvasElement; normal: HTMLCanvasElement; roughness: HTMLCanvasElement };
}

type RGB = [number, number, number];

const cache = new Map<string, BarkTextures>();

// ---------------------------------------------------------------------------
// Tileable noise
// ---------------------------------------------------------------------------
function hash(i: number, j: number, seed: number): number {
  let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Value noise on a lattice with integer periods px, py (x, y in lattice units). */
function valueNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = smooth(x - xi), fy = smooth(y - yi);
  const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
  const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

/** fbm over `oct` octaves; u, v in [0,1). Base periods (px, py) give per-axis frequency/stretch. Result ~[0,1]. */
function fbm(u: number, v: number, px: number, py: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, fx = px, fy = py;
  for (let o = 0; o < oct; o++) {
    sum += amp * valueNoise(u * fx, v * fy, fx, fy, seed + o * 17);
    norm += amp; amp *= gain; fx *= 2; fy *= 2;
  }
  return sum / norm;
}

/** Jittered-grid Voronoi with wrap. Returns F1, F2 (in cell units) and the nearest cell id. */
function voronoi(u: number, v: number, nx: number, ny: number, jitter: number, seed: number, out: { f1: number; f2: number; id: number }): void {
  const x = u * nx, y = v * ny;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = Infinity, f2 = Infinity, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const wx = ((cx % nx) + nx) % nx, wy = ((cy % ny) + ny) % ny;
    const fxp = cx + 0.5 + (hash(wx, wy, seed) - 0.5) * jitter, fyp = cy + 0.5 + (hash(wx, wy, seed + 1) - 0.5) * jitter;
    const d = Math.hypot(fxp - x, fyp - y);
    if (d < f1) { f2 = f1; f1 = d; id = wx + wy * nx; } else if (d < f2) f2 = d;
  }
  out.f1 = f1; out.f2 = f2; out.id = id;
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------
interface Field { height: Float32Array; albedo: Float32Array; rough: Float32Array; normalStrength: number }

const vo = { f1: 0, f2: 0, id: 0 };

function generateField(family: BarkFamily, S: number): Field {
  const N = S * S;
  const height = new Float32Array(N), albedo = new Float32Array(N * 3), rough = new Float32Array(N);
  const px = S / 1024; // pixel-size features scale with resolution
  const setA = (i: number, c: RGB, k = 1) => { albedo[i * 3] = c[0] * k; albedo[i * 3 + 1] = c[1] * k; albedo[i * 3 + 2] = c[2] * k; };
  let normalStrength = 1;

  // horizontal dashes (lenticels): list of [cx, cy, halfW, halfH], wrap-aware
  const dashes: number[][] = [];
  const dashField = (count: number, minW: number, maxW: number, minH: number, maxH: number, seed: number) => {
    for (let k = 0; k < count; k++) {
      dashes.push([hash(k, 1, seed) * S, hash(k, 2, seed) * S, mix(minW, maxW, hash(k, 3, seed)) * px * 0.5, mix(minH, maxH, hash(k, 4, seed)) * px * 0.5]);
    }
  };
  const dashAt = (x: number, y: number): number => {
    let m = 0;
    for (const [cx, cy, hw, hh] of dashes) {
      let dx = Math.abs(x - cx); if (dx > S / 2) dx = S - dx;
      let dy = Math.abs(y - cy); if (dy > S / 2) dy = S - dy;
      if (dx < hw + 2 && dy < hh + 2) {
        const ex = clamp01((hw + 1 - dx) / 2), ey = clamp01((hh + 1 - dy) / 1.5);
        m = Math.max(m, ex * ey * (0.6 + 0.4 * clamp01(1 - dx / hw)));
      }
    }
    return m;
  };

  switch (family) {
    case 'lenticel': {
      dashField(40, 20, 80, 2, 6, 11);
      normalStrength = 6;
      const base: RGB = [0.85, 0.84, 0.80], dark: RGB = [0.12, 0.11, 0.10], patch: RGB = [0.30, 0.27, 0.24];
      for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
        const u = x / S, v = y / S;
        const n = fbm(u, v, 4, 4, 5, 3);
        const fine = fbm(u, v, 24, 6, 3, 9);
        const patchN = fbm(u, v, 3, 2, 4, 21);
        const patchM = clamp01((patchN - 0.60) / 0.06); // ~10% coverage
        const dash = dashAt(x, y);
        let h = 0.5 + (n - 0.5) * 0.12 + (fine - 0.5) * 0.06;
        h += patchM * ((fine - 0.5) * 0.4 - 0.05);
        h -= dash * 0.12;
        height[i] = h;
        const tone = 0.94 + 0.12 * (n - 0.5) + 0.06 * (fine - 0.5);
        const r = mix(base[0] * tone, patch[0] * (0.8 + 0.4 * fine), patchM), g = mix(base[1] * tone, patch[1] * (0.8 + 0.4 * fine), patchM), b = mix(base[2] * tone, patch[2] * (0.8 + 0.4 * fine), patchM);
        setA(i, [mix(r, dark[0], dash), mix(g, dark[1], dash), mix(b, dark[2], dash)]);
        rough[i] = mix(0.72, 0.95, patchM) + dash * 0.1;
      }
      break;
    }
    case 'furrowed':
    case 'ridged': {
      const ridged = family === 'ridged';
      const fx = ridged ? 10 : 6, power = ridged ? 1.3 : 1.8, depth = ridged ? 0.55 : 0.85;
      normalStrength = ridged ? 7 : 9;
      const dark: RGB = ridged ? [0.20, 0.18, 0.16] : [0.20, 0.16, 0.13];
      const light: RGB = ridged ? [0.36, 0.33, 0.30] : [0.45, 0.38, 0.31];
      for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
        const u = x / S, v = y / S;
        // vertical ridges: high frequency across, low along; a coarse modulation breaks them into a network
        const warp = (fbm(u, v, 2, 2, 3, 5) - 0.5) * 0.06;
        const n = fbm(u + warp, v, fx, 1, 5, 7, 0.55);
        let ridge = Math.pow(1 - Math.abs(2 * n - 1), power);
        const coarse = fbm(u, v, 2, 1, 3, 13);
        const fine = fbm(u, v, 32, 8, 3, 17);
        ridge = ridge * (0.55 + 0.45 * coarse) + (fine - 0.5) * 0.08;
        const h = clamp01(1 - depth + depth * ridge + (ridged ? 0.1 : 0));
        height[i] = h;
        const t = clamp01((h - (1 - depth)) / depth);
        const shade = 0.85 + 0.3 * t;
        setA(i, [mix(dark[0], light[0], t) * shade * (0.92 + 0.16 * fine), mix(dark[1], light[1], t) * shade * (0.92 + 0.16 * fine), mix(dark[2], light[2], t) * shade * (0.92 + 0.16 * fine)]);
        rough[i] = 0.95 - 0.25 * h;
      }
      break;
    }
    case 'plated': {
      normalStrength = 9;
      const plate: RGB = [0.55, 0.32, 0.17], crackC: RGB = [0.18, 0.12, 0.08];
      const nx = 5, ny = 4; // plates taller than wide
      for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
        const u = x / S, v = y / S;
        const wu = (fbm(u, v, 3, 3, 2, 31) - 0.5) * 0.08, wv = (fbm(u, v, 3, 3, 2, 37) - 0.5) * 0.08;
        voronoi(u + wu, v + wv, nx, ny, 0.8, 41, vo);
        const edge = vo.f2 - vo.f1; // 0 on cracks
        const crack = smooth(clamp01(edge / 0.22));
        const fine = fbm(u, v, 12, 12, 4, 43);
        const dome = 1 - clamp01(vo.f1 / 0.9) * 0.25;
        const h = clamp01(0.12 + 0.78 * crack * dome + (fine - 0.5) * 0.12);
        height[i] = h;
        const varn = 1 + (hash(vo.id, 7, 47) - 0.5) * 0.24;
        const c = clamp01((h - 0.25) / 0.45);
        setA(i, [mix(crackC[0], plate[0] * varn, c) * (0.9 + 0.2 * fine), mix(crackC[1], plate[1] * varn, c) * (0.9 + 0.2 * fine), mix(crackC[2], plate[2] * varn, c) * (0.9 + 0.2 * fine)]);
        rough[i] = 0.95 - 0.25 * h;
      }
      break;
    }
    case 'fibrous': {
      normalStrength = 5;
      const dark: RGB = [0.28, 0.15, 0.10], light: RGB = [0.50, 0.30, 0.20];
      for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
        const u = x / S, v = y / S;
        const strand = fbm(u, v, 48, 2, 4, 51, 0.6);
        const coarse = fbm(u, v, 6, 1, 3, 53);
        const h = clamp01(0.4 + (strand - 0.5) * 0.7 + (coarse - 0.5) * 0.3);
        height[i] = h;
        setA(i, [mix(dark[0], light[0], h), mix(dark[1], light[1], h), mix(dark[2], light[2], h)]);
        rough[i] = 0.82;
      }
      break;
    }
    case 'exfoliating': {
      normalStrength = 3;
      const tones: RGB[] = [[0.62, 0.60, 0.50], [0.80, 0.76, 0.64], [0.50, 0.55, 0.42]];
      for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
        const u = x / S, v = y / S;
        const wu = (fbm(u, v, 4, 4, 3, 61) - 0.5) * 0.12, wv = (fbm(u, v, 4, 4, 3, 67) - 0.5) * 0.12;
        voronoi(u + wu, v + wv, 3, 4, 0.9, 71, vo);
        const tone = tones[Math.floor(hash(vo.id, 3, 73) * 3) % 3];
        const edgeSoft = smooth(clamp01((vo.f2 - vo.f1) / 0.12));
        const fine = fbm(u, v, 10, 10, 4, 79);
        const lift = hash(vo.id, 5, 83) * 0.08;
        const h = 0.45 + lift * edgeSoft + (fine - 0.5) * 0.06;
        height[i] = h;
        const k = 0.9 + 0.2 * fine;
        setA(i, [mix(tone[0] * 0.8, tone[0], edgeSoft) * k, mix(tone[1] * 0.8, tone[1], edgeSoft) * k, mix(tone[2] * 0.8, tone[2], edgeSoft) * k]);
        rough[i] = 0.78;
      }
      break;
    }
    case 'smooth':
    default: {
      dashField(10, 10, 40, 2, 4, 91);
      normalStrength = 3;
      const base: RGB = [0.42, 0.40, 0.37], dark: RGB = [0.18, 0.16, 0.14];
      for (let y = 0, i = 0; y < S; y++) for (let x = 0; x < S; x++, i++) {
        const u = x / S, v = y / S;
        const n = fbm(u, v, 4, 4, 5, 93);
        const dash = dashAt(x, y);
        height[i] = 0.5 + (n - 0.5) * 0.3 - dash * 0.1;
        const k = 0.9 + 0.2 * n;
        setA(i, [mix(base[0] * k, dark[0], dash), mix(base[1] * k, dark[1], dash), mix(base[2] * k, dark[2], dash)]);
        rough[i] = 0.8;
      }
    }
  }
  return { height, albedo, rough, normalStrength };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
function canvasOf(S: number, fill: (d: Uint8ClampedArray) => void): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeTexture(canvas: HTMLCanvasElement, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Bake (or fetch from cache) the tiling textures of a bark family at `size` px. */
export function barkTextures(family: BarkFamily, size = 1024, anisotropy = 4): BarkTextures {
  const key = `${family}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = size;
  const { height, albedo, rough, normalStrength } = generateField(family, S);
  // ambient-occlusion-like darkening in the low parts, baked into the albedo
  const strength = normalStrength * (S / 1024);
  const albedoCanvas = canvasOf(S, (d) => {
    for (let i = 0; i < S * S; i++) {
      const ao = 0.7 + 0.3 * height[i];
      d[i * 4] = clamp01(albedo[i * 3] * ao) * 255; d[i * 4 + 1] = clamp01(albedo[i * 3 + 1] * ao) * 255; d[i * 4 + 2] = clamp01(albedo[i * 3 + 2] * ao) * 255; d[i * 4 + 3] = 255;
    }
  });
  const normalCanvas = canvasOf(S, (d) => {
    for (let y = 0; y < S; y++) {
      const yu = (y + S - 1) % S, yd = (y + 1) % S; // canvas row above / below (row 0 = top = v 1)
      for (let x = 0; x < S; x++) {
        const xl = (x + S - 1) % S, xr = (x + 1) % S;
        const dx = (height[y * S + xr] - height[y * S + xl]) * 0.5 * strength;
        const dy = (height[yu * S + x] - height[yd * S + x]) * 0.5 * strength; // +v is up on the canvas
        const len = Math.hypot(dx, dy, 1);
        const i = (y * S + x) * 4;
        d[i] = (-dx / len * 0.5 + 0.5) * 255; d[i + 1] = (-dy / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }
  });
  const roughCanvas = canvasOf(S, (d) => {
    for (let i = 0; i < S * S; i++) { const r = clamp01(rough[i]) * 255; d[i * 4] = r; d[i * 4 + 1] = r; d[i * 4 + 2] = r; d[i * 4 + 3] = 255; }
  });
  const out: BarkTextures = {
    family, size,
    map: makeTexture(albedoCanvas, true, anisotropy),
    normalMap: makeTexture(normalCanvas, false, anisotropy),
    roughnessMap: makeTexture(roughCanvas, false, anisotropy),
    debugCanvases: { albedo: albedoCanvas, normal: normalCanvas, roughness: roughCanvas },
  };
  out.map.name = `bark-${family}-albedo`; out.normalMap.name = `bark-${family}-normal`; out.roughnessMap.name = `bark-${family}-roughness`;
  cache.set(key, out);
  return out;
}
