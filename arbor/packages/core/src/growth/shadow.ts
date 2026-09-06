/**
 * Shadow propagation (Pałubicki et al. 2009 §4.1). Every node casts a pyramid of shadow
 * downward; light available to a bud is Q = max(0, C - s + a) where s is the shadow
 * value in its voxel and a is its own contribution. Rebuilt each year from scratch.
 */
export class ShadowGrid {
  private data: Float32Array;
  private ox = 0; private oy = 0; private oz = 0;
  private nx = 0; private ny = 0; private nz = 0;
  readonly voxel: number;
  readonly a: number;
  readonly b: number;
  readonly depth: number;
  /** Half-width growth of the pyramid per voxel of depth (1 = 45°, 0.5 ≈ 27°). */
  readonly spread: number;

  constructor(voxel: number, a = 0.1, b = 1.5, depth = 8, spread = 1) {
    this.voxel = voxel; this.a = a; this.b = b; this.depth = depth; this.spread = spread;
    this.data = new Float32Array(0);
  }

  /** Recompute the grid for the given node positions. */
  rebuild(px: Float32Array, count: number): void {
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = px[i * 3], y = px[i * 3 + 1], z = px[i * 3 + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const pad = (this.depth + 2) * this.voxel;
    this.ox = minx - pad; this.oy = miny - pad; this.oz = minz - pad;
    this.nx = Math.ceil((maxx - minx + 2 * pad) / this.voxel) + 1;
    this.ny = Math.ceil((maxy - miny + 2 * pad) / this.voxel) + 1;
    this.nz = Math.ceil((maxz - minz + 2 * pad) / this.voxel) + 1;
    const n = this.nx * this.ny * this.nz;
    if (this.data.length < n) this.data = new Float32Array(n); else this.data.fill(0, 0, n);
    const inv = 1 / this.voxel;
    for (let i = 0; i < count; i++) {
      const ix = Math.floor((px[i * 3] - this.ox) * inv);
      const iy = Math.floor((px[i * 3 + 1] - this.oy) * inv);
      const iz = Math.floor((px[i * 3 + 2] - this.oz) * inv);
      for (let q = 0; q <= this.depth; q++) {
        const y = iy - q;
        if (y < 0) break;
        const s = this.a * Math.pow(this.b, -q);
        const hw = Math.floor(q * this.spread);
        for (let dx = -hw; dx <= hw; dx++) {
          const x = ix + dx; if (x < 0 || x >= this.nx) continue;
          for (let dz = -hw; dz <= hw; dz++) {
            const z = iz + dz; if (z < 0 || z >= this.nz) continue;
            this.data[(x * this.ny + y) * this.nz + z] += s;
          }
        }
      }
    }
  }

  shadowAt(x: number, y: number, z: number): number {
    const inv = 1 / this.voxel;
    const ix = Math.floor((x - this.ox) * inv), iy = Math.floor((y - this.oy) * inv), iz = Math.floor((z - this.oz) * inv);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return 0;
    return this.data[(ix * this.ny + iy) * this.nz + iz];
  }

  /** Light quality for a bud sitting on a node that itself contributes `a`. */
  lightAt(x: number, y: number, z: number, C = 1): number {
    return Math.max(0, C - this.shadowAt(x, y, z) + this.a);
  }
}
