import type { CrownEnvelope } from '../types.js';
import type { Rng } from '../rng.js';

/**
 * Space markers (attraction points) fill the crown envelope. Buds perceive markers in a cone,
 * grow toward them, and consume markers they come close to (space colonization,
 * Runions 2007 / Pałubicki 2009). The envelope is the user's primary shape control.
 */
export class MarkerField {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly alive: Uint8Array;
  readonly count: number;
  private cell: number;
  private grid = new Map<number, number[]>();
  private inv: number;
  remaining: number;

  constructor(points: Float32Array, cellSize: number) {
    this.count = points.length / 3;
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.alive = new Uint8Array(this.count).fill(1);
    this.remaining = this.count;
    this.cell = cellSize;
    this.inv = 1 / cellSize;
    for (let i = 0; i < this.count; i++) {
      this.x[i] = points[i * 3];
      this.y[i] = points[i * 3 + 1];
      this.z[i] = points[i * 3 + 2];
      const k = this.key(this.x[i], this.y[i], this.z[i]);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
  }

  private key(x: number, y: number, z: number): number {
    const ix = Math.floor(x * this.inv) + 4096;
    const iy = Math.floor(y * this.inv) + 4096;
    const iz = Math.floor(z * this.inv) + 4096;
    return (ix * 8192 + iy) * 8192 + iz;
  }

  /**
   * Perceive markers in a cone (apex p, axis d, half-angle cosAngle, length dist).
   * Returns marker count and writes the mean direction into out (unnormalized sum).
   */
  perceive(
    px: number, py: number, pz: number,
    dx: number, dy: number, dz: number,
    dist: number, cosAngle: number,
    out: Float32Array,
  ): number {
    out[0] = out[1] = out[2] = 0;
    let n = 0;
    const r = Math.ceil(dist * this.inv);
    const cx = Math.floor(px * this.inv), cy = Math.floor(py * this.inv), cz = Math.floor(pz * this.inv);
    const d2max = dist * dist;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iy = cy - r; iy <= cy + r; iy++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          // cheap cull: cell centre behind the apex plane (with half-diagonal slack)
          const ccx = (ix + 0.5) * this.cell - px, ccy = (iy + 0.5) * this.cell - py, ccz = (iz + 0.5) * this.cell - pz;
          if (ccx * dx + ccy * dy + ccz * dz < -0.87 * this.cell) continue;
          const list = this.grid.get(((ix + 4096) * 8192 + (iy + 4096)) * 8192 + (iz + 4096));
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const i = list[j];
            if (!this.alive[i]) continue;
            const vx = this.x[i] - px, vy = this.y[i] - py, vz = this.z[i] - pz;
            const d2 = vx * vx + vy * vy + vz * vz;
            if (d2 > d2max || d2 < 1e-8) continue;
            const inv = 1 / Math.sqrt(d2);
            const c = (vx * dx + vy * dy + vz * dz) * inv;
            if (c < cosAngle) continue;
            out[0] += vx * inv; out[1] += vy * inv; out[2] += vz * inv;
            n++;
          }
        }
    return n;
  }

  /** Mark every marker free again; call once per season before re-applying occupancy. */
  resetOccupancy(): void { this.alive.fill(1); this.remaining = this.count; }

  /** Mark all markers within radius of p as occupied. Returns number newly occupied. */
  consume(px: number, py: number, pz: number, radius: number): number {
    const r = Math.ceil(radius * this.inv);
    const cx = Math.floor(px * this.inv), cy = Math.floor(py * this.inv), cz = Math.floor(pz * this.inv);
    const r2 = radius * radius;
    let removed = 0;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iy = cy - r; iy <= cy + r; iy++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          const list = this.grid.get(((ix + 4096) * 8192 + (iy + 4096)) * 8192 + (iz + 4096));
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const i = list[j];
            if (!this.alive[i]) continue;
            const vx = this.x[i] - px, vy = this.y[i] - py, vz = this.z[i] - pz;
            if (vx * vx + vy * vy + vz * vz <= r2) { this.alive[i] = 0; removed++; }
          }
        }
    this.remaining -= removed;
    return removed;
  }
}

/** Signed "inside" test for the crown envelope; returns true if point is inside. */
export function insideEnvelope(env: CrownEnvelope, x: number, y: number, z: number): boolean {
  const h = env.height, w = env.width, base = env.baseHeight;
  const t = (y - base) / h; // 0 at crown base, 1 at top
  if (t < 0 || t > 1) return false;
  const rxz = Math.sqrt(x * x + z * z);
  const R = w * 0.5;
  switch (env.shape) {
    case 'sphere':
    case 'ellipsoid': {
      const u = t * 2 - 1;
      return rxz <= R * Math.sqrt(Math.max(0, 1 - u * u));
    }
    case 'cone':
      return rxz <= R * (1 - t) * (0.85 + 0.15 * Math.sin(t * 6)); // slight whorl waviness
    case 'column':
      return rxz <= R * (t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1);
    case 'spreading': {
      // wide, flattened dome; widest at ~40% height, rounded top
      const u = (t - 0.4) / 0.6;
      const top = t >= 0.4 ? Math.sqrt(Math.max(0, 1 - u * u)) : Math.sqrt(t / 0.4);
      return rxz <= R * top;
    }
    case 'vase':
      return rxz <= R * (0.25 + 0.75 * Math.pow(t, 0.7));
  }
}

/** Fill the envelope with jittered-grid markers at a target spacing. */
export function generateMarkers(env: CrownEnvelope, spacing: number, rng: Rng): Float32Array {
  const R = env.width * 0.5 + spacing;
  const y0 = env.baseHeight - spacing, y1 = env.baseHeight + env.height + spacing;
  const pts: number[] = [];
  for (let x = -R; x <= R; x += spacing)
    for (let y = y0; y <= y1; y += spacing)
      for (let z = -R; z <= R; z += spacing) {
        const px = x + (rng.next() - 0.5) * spacing;
        const py = y + (rng.next() - 0.5) * spacing;
        const pz = z + (rng.next() - 0.5) * spacing;
        if (insideEnvelope(env, px, py, pz)) pts.push(px, py, pz);
      }
  return Float32Array.from(pts);
}
