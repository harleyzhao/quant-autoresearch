import type { Skeleton, BranchMesh } from '../types.js';

/**
 * Skeleton -> branch surface. Each node gets a ring in a rotation-minimising frame
 * (parallel transport along the main chain). Lateral children start with their own ring
 * embedded in the parent, so junctions are watertight per branch but not welded across
 * branches (the strand-based junction model is the P1 upgrade, see ADR-003).
 */
export interface BranchMeshOptions {
  /** Ring segments at the trunk; fewer toward the tips. */
  maxSegments?: number;
  minSegments?: number;
  /** Nodes with radius below this are skipped (their parent becomes a tip). */
  minRadius?: number;
  /** Texture repeats per meter of circumference. */
  uvScale?: number;
}

export function buildBranchMesh(sk: Skeleton, opts: BranchMeshOptions = {}): BranchMesh {
  const maxSeg = opts.maxSegments ?? 16;
  const minSeg = opts.minSegments ?? 5;
  const minRadius = opts.minRadius ?? 0;
  const uvScale = opts.uvScale ?? 2;
  const n = sk.count;
  const P = sk.position;

  // tangent per node: average of incoming and main-outgoing directions
  const tan = new Float32Array(n * 3);
  const mainChild = new Int32Array(n).fill(-1);
  const childCount = new Int32Array(n);
  for (let i = 1; i < n; i++) { const p = sk.parent[i]; childCount[p]++; if (sk.isMain[i]) mainChild[p] = i; }
  for (let i = 0; i < n; i++) {
    let tx = 0, ty = 0, tz = 0;
    const p = sk.parent[i];
    if (p >= 0) { tx += P[i * 3] - P[p * 3]; ty += P[i * 3 + 1] - P[p * 3 + 1]; tz += P[i * 3 + 2] - P[p * 3 + 2]; }
    const c = mainChild[i];
    if (c >= 0) { tx += P[c * 3] - P[i * 3]; ty += P[c * 3 + 1] - P[i * 3 + 1]; tz += P[c * 3 + 2] - P[i * 3 + 2]; }
    let m = Math.hypot(tx, ty, tz); if (m < 1e-9) { tx = 0; ty = 1; tz = 0; m = 1; }
    tan[i * 3] = tx / m; tan[i * 3 + 1] = ty / m; tan[i * 3 + 2] = tz / m;
  }
  // parallel-transported normal
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
    let nx: number, ny: number, nz: number;
    const p = sk.parent[i];
    if (p < 0) { if (Math.abs(ty) < 0.9) { nx = -tz; ny = 0; nz = tx; } else { nx = 1; ny = 0; nz = 0; } }
    else { nx = nor[p * 3]; ny = nor[p * 3 + 1]; nz = nor[p * 3 + 2]; }
    const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
    let m = Math.hypot(nx, ny, nz);
    if (m < 1e-6) { if (Math.abs(ty) < 0.9) { nx = -tz; ny = 0; nz = tx; } else { nx = 1; ny = 0; nz = 0; } m = Math.hypot(nx, ny, nz); }
    nor[i * 3] = nx / m; nor[i * 3 + 1] = ny / m; nor[i * 3 + 2] = nz / m;
  }
  // cumulative length for V
  const vlen = new Float32Array(n);
  for (let i = 1; i < n; i++) { const p = sk.parent[i]; vlen[i] = vlen[p] + Math.hypot(P[i * 3] - P[p * 3], P[i * 3 + 1] - P[p * 3 + 1], P[i * 3 + 2] - P[p * 3 + 2]); }

  const rMax = sk.radius[0] || 1e-3;
  const segOf = (r: number) => Math.max(minSeg, Math.min(maxSeg, Math.round(minSeg + (maxSeg - minSeg) * Math.sqrt(r / rMax))));

  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  /** ring start index and segment count per node */
  const ringStart = new Int32Array(n).fill(-1);
  const ringSeg = new Int32Array(n);

  const emitRing = (i: number, r: number, seg: number, cx: number, cy: number, cz: number): number => {
    const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1], nz = nor[i * 3 + 2];
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const start = pos.length / 3;
    const v = vlen[i] * uvScale;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ox = nx * ca + bx * sa, oy = ny * ca + by * sa, oz = nz * ca + bz * sa;
      pos.push(cx + ox * r, cy + oy * r, cz + oz * r);
      nrm.push(ox, oy, oz);
      uv.push(s / seg, v);
    }
    return start;
  };
  const connect = (a: number, segA: number, b: number, segB: number) => {
    // rings may have different segment counts; walk both parametrically
    const seg = Math.max(segA, segB);
    for (let s = 0; s < seg; s++) {
      const a0 = a + Math.round((s / seg) * segA), a1 = a + Math.round(((s + 1) / seg) * segA);
      const b0 = b + Math.round((s / seg) * segB), b1 = b + Math.round(((s + 1) / seg) * segB);
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  };

  // root ring
  ringSeg[0] = segOf(sk.radius[0]);
  ringStart[0] = emitRing(0, sk.radius[0], ringSeg[0], P[0], P[1], P[2]);

  for (let i = 1; i < n; i++) {
    const r = sk.radius[i];
    if (r < minRadius) continue;
    const p = sk.parent[i];
    const seg = segOf(r);
    ringSeg[i] = seg;
    ringStart[i] = emitRing(i, r, seg, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    let startRing: number, startSeg: number;
    if (sk.isMain[i] && ringStart[p] >= 0) { startRing = ringStart[p]; startSeg = ringSeg[p]; }
    else {
      // lateral: begin with a ring of this radius sunk into the parent along our own tangent
      const dx = P[i * 3] - P[p * 3], dy = P[i * 3 + 1] - P[p * 3 + 1], dz = P[i * 3 + 2] - P[p * 3 + 2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const sink = Math.min(sk.radius[p] * 0.6, len * 0.5);
      startSeg = seg;
      startRing = emitRing(i, Math.min(r * 1.15, sk.radius[p]), seg, P[p * 3] + (dx / len) * sink, P[p * 3 + 1] + (dy / len) * sink, P[p * 3 + 2] + (dz / len) * sink);
    }
    connect(startRing, startSeg, ringStart[i], seg);
    if (sk.isTip[i]) {
      // cap
      const c = pos.length / 3;
      const tx = tan[i * 3], ty = tan[i * 3 + 1], tz = tan[i * 3 + 2];
      pos.push(P[i * 3] + tx * r, P[i * 3 + 1] + ty * r, P[i * 3 + 2] + tz * r);
      nrm.push(tx, ty, tz); uv.push(0.5, vlen[i] * uvScale + r);
      for (let s = 0; s < seg; s++) idx.push(ringStart[i] + s, ringStart[i] + s + 1, c);
    }
  }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nrm), uv: Float32Array.from(uv), index: Uint32Array.from(idx) };
}
