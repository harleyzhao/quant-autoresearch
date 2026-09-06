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
  remaining: number;
  // dense uniform grid over the marker bounding box: head[cell] -> first marker, next[marker] -> next in cell
  private cell: number;
  private inv: number;
  private ox = 0; private oy = 0; private oz = 0;
  private nx = 1; private ny = 1; private nz = 1;
  private head: Int32Array;
  private next: Int32Array;

  constructor(points: Float32Array, cellSize: number) {
    this.count = points.length / 3;
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.alive = new Uint8Array(this.count).fill(1);
    this.remaining = this.count;
    this.cell = cellSize;
    this.inv = 1 / cellSize;
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
      this.x[i] = x; this.y[i] = y; this.z[i] = z;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    if (this.count === 0) { minx = miny = minz = 0; maxx = maxy = maxz = 1; }
    this.ox = minx - cellSize; this.oy = miny - cellSize; this.oz = minz - cellSize;
    this.nx = Math.ceil((maxx - this.ox) * this.inv) + 2;
    this.ny = Math.ceil((maxy - this.oy) * this.inv) + 2;
    this.nz = Math.ceil((maxz - this.oz) * this.inv) + 2;
    this.head = new Int32Array(this.nx * this.ny * this.nz).fill(-1);
    this.next = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const c = this.cellOf(this.x[i], this.y[i], this.z[i]);
      this.next[i] = this.head[c]; this.head[c] = i;
    }
  }

  private cellOf(x: number, y: number, z: number): number {
    const ix = Math.floor((x - this.ox) * this.inv), iy = Math.floor((y - this.oy) * this.inv), iz = Math.floor((z - this.oz) * this.inv);
    return (ix * this.ny + iy) * this.nz + iz;
  }

  /**
   * Perceive markers in a cone (apex p, axis d, half-angle cosAngle, length dist).
   * Returns marker count and writes the summed unit directions into out.
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
    const cx = Math.floor((px - this.ox) * this.inv), cy = Math.floor((py - this.oy) * this.inv), cz = Math.floor((pz - this.oz) * this.inv);
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.nx - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(this.ny - 1, cy + r);
    const z0 = Math.max(0, cz - r), z1 = Math.min(this.nz - 1, cz + r);
    if (x0 > x1 || y0 > y1 || z0 > z1) return 0;
    const d2max = dist * dist;
    const slack = -0.87 * this.cell;
    for (let ix = x0; ix <= x1; ix++) {
      const ccx = this.ox + (ix + 0.5) * this.cell - px;
      for (let iy = y0; iy <= y1; iy++) {
        const ccy = this.oy + (iy + 0.5) * this.cell - py;
        for (let iz = z0; iz <= z1; iz++) {
          // cheap cull: cell centre behind the apex plane
          const ccz = this.oz + (iz + 0.5) * this.cell - pz;
          if (ccx * dx + ccy * dy + ccz * dz < slack) continue;
          for (let i = this.head[(ix * this.ny + iy) * this.nz + iz]; i >= 0; i = this.next[i]) {
            if (!this.alive[i]) continue;
            const vx = this.x[i] - px, vy = this.y[i] - py, vz = this.z[i] - pz;
            const d2 = vx * vx + vy * vy + vz * vz;
            if (d2 > d2max || d2 < 1e-8) continue;
            const inv = 1 / Math.sqrt(d2);
            if ((vx * dx + vy * dy + vz * dz) * inv < cosAngle) continue;
            out[0] += vx * inv; out[1] += vy * inv; out[2] += vz * inv;
            n++;
          }
        }
      }
    }
    return n;
  }

  /**
   * Recompute occupancy from scratch: a marker is occupied if any of the given points lies within
   * `radius`. Marker-centric with a temporary dense point grid.
   */
  recomputeOccupancy(points: Float32Array, count: number, radius: number): void {
    const inv = 1 / radius;
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    if (count === 0) { this.alive.fill(1); this.remaining = this.count; return; }
    const ox = minx - radius, oy = miny - radius, oz = minz - radius;
    const nx = Math.ceil((maxx - ox) * inv) + 2, ny = Math.ceil((maxy - oy) * inv) + 2, nz = Math.ceil((maxz - oz) * inv) + 2;
    const head = new Int32Array(nx * ny * nz).fill(-1);
    const next = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const c = (Math.floor((points[i * 3] - ox) * inv) * ny + Math.floor((points[i * 3 + 1] - oy) * inv)) * nz + Math.floor((points[i * 3 + 2] - oz) * inv);
      next[i] = head[c]; head[c] = i;
    }
    const r2 = radius * radius;
    let alive = 0;
    for (let m = 0; m < this.count; m++) {
      const x = this.x[m], y = this.y[m], z = this.z[m];
      const cx = Math.floor((x - ox) * inv), cy = Math.floor((y - oy) * inv), cz = Math.floor((z - oz) * inv);
      let occupied = false;
      if (cx >= -1 && cy >= -1 && cz >= -1 && cx <= nx && cy <= ny && cz <= nz) {
        outer: for (let ix = Math.max(0, cx - 1); ix <= Math.min(nx - 1, cx + 1); ix++)
          for (let iy = Math.max(0, cy - 1); iy <= Math.min(ny - 1, cy + 1); iy++)
            for (let iz = Math.max(0, cz - 1); iz <= Math.min(nz - 1, cz + 1); iz++)
              for (let i = head[(ix * ny + iy) * nz + iz]; i >= 0; i = next[i]) {
                const p = i * 3;
                const dx = points[p] - x, dy = points[p + 1] - y, dz = points[p + 2] - z;
                if (dx * dx + dy * dy + dz * dz <= r2) { occupied = true; break outer; }
              }
      }
      this.alive[m] = occupied ? 0 : 1;
      if (!occupied) alive++;
    }
    this.remaining = alive;
  }

  /** Mark every marker free again. */
  resetOccupancy(): void { this.alive.fill(1); this.remaining = this.count; }

  /** Mark all markers within radius of p as occupied. Returns number newly occupied. */
  consume(px: number, py: number, pz: number, radius: number): number {
    const r = Math.ceil(radius * this.inv);
    const cx = Math.floor((px - this.ox) * this.inv), cy = Math.floor((py - this.oy) * this.inv), cz = Math.floor((pz - this.oz) * this.inv);
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.nx - 1, cx + r);
    const y0 = Math.max(0, cy - r), y1 = Math.min(this.ny - 1, cy + r);
    const z0 = Math.max(0, cz - r), z1 = Math.min(this.nz - 1, cz + r);
    const r2 = radius * radius;
    let removed = 0;
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++)
          for (let i = this.head[(ix * this.ny + iy) * this.nz + iz]; i >= 0; i = this.next[i]) {
            if (!this.alive[i]) continue;
            const vx = this.x[i] - px, vy = this.y[i] - py, vz = this.z[i] - pz;
            if (vx * vx + vy * vy + vz * vz <= r2) { this.alive[i] = 0; removed++; }
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
