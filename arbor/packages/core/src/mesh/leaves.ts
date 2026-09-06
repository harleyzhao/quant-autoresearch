import type { Skeleton, SpeciesParams, LeafInstances, PhenologyState } from '../types.js';
import { Rng, hash01 } from '../rng.js';
import { leafColor } from '../growth/phenology.js';

/**
 * Place leaf instances on young, thin shoots and colour them from the phenology state.
 * Per-leaf jitter makes budburst, colouring and drop progress through the canopy
 * (sun-exposed = higher leaves colour first) rather than switching at once.
 */
export function buildLeaves(sk: Skeleton, sp: SpeciesParams, ph: PhenologyState, currentYear: number, seed: number): LeafInstances {
  const rng = new Rng(seed ^ 0x5eaf);
  const lf = sp.leaf;
  const n = sk.count;
  const P = sk.position;
  let height = 0; for (let i = 0; i < n; i++) if (P[i * 3 + 1] > height) height = P[i * 3 + 1];

  const pos: number[] = [], quat: number[] = [], scale: number[] = [], nodeOf: number[] = [];
  const pig: number[] = [], col: number[] = [];
  const cbuf = new Float32Array(3);
  const q = new Float32Array(4);

  let leafId = 0;
  for (let i = 1; i < n; i++) {
    if (sk.radius[i] > lf.maxBranchRadius) continue;
    if (!sk.isTip[i] && currentYear - sk.birthYear[i] > lf.maxShootAge) continue;
    const p = sk.parent[i];
    const ax = P[i * 3] - P[p * 3], ay = P[i * 3 + 1] - P[p * 3 + 1], az = P[i * 3 + 2] - P[p * 3 + 2];
    const len = Math.hypot(ax, ay, az) || 1;
    const tx = ax / len, ty = ay / len, tz = az / len;
    const shootAge = Math.min(currentYear - sk.birthYear[i], lf.maxShootAge);
    // tips carry the short-shoot cluster of the season: more leaves than a plain internode
    const count = sk.isTip[i] ? Math.round(lf.perNode * 1.6) : lf.perNode;
    for (let k = 0; k < count; k++, leafId++) {
      // position along the internode
      const t = (k + 0.5) / count;
      const x = P[p * 3] + ax * t, y = P[p * 3 + 1] + ay * t, z = P[p * 3 + 2] + az * t;
      // relative canopy height drives exposure -> earlier colouring/drop
      const exposure = height > 0 ? y / height : 1;
      const j = hash01(leafId, 7);
      const j2 = hash01(leafId, 11);

      // phenology per leaf
      let expansion = ph.expansion;
      if (ph.stage === 'budburst' || ph.stage === 'expanding') expansion = clamp01((ph.expansion - j * 0.35) / 0.65);
      // per-leaf senescence progress: sun-exposed (high) leaves and a random subset turn first
      const senesceShift = (exposure - 0.5) * 0.4 + (j - 0.5) * 0.5;
      const leafS = ph.carotenoid > 0 ? clamp01(ph.carotenoid + senesceShift) : 0;
      const chl = clamp01(expansion * (1 - leafS));
      const car = leafS;
      const ant = clamp01(leafS * leafS * (0.6 + 0.8 * exposure) * (0.7 + 0.6 * j2));
      const brown = ph.browning > 0 ? clamp01(ph.browning + (j2 - 0.5) * 0.3) : 0;
      const dropped = ph.shed > 0 && j * 0.8 + (1 - exposure) * 0.2 < ph.shed;
      const s = dropped ? 0 : expansion;
      if (s <= 0.02 && !sp.phenology.evergreen) { continue; }

      // orientation: leaf points away from the axis (phyllotactic angle), blade normal biased up (phototropism)
      const phase = k * (sp.phyllotaxis * Math.PI / 180) + rng.next() * 0.6 + hash01(i, 3) * Math.PI * 2;
      leafQuaternion(tx, ty, tz, phase, sp.leaf.shape === 'needle' ? 0.9 : 0.55 + rng.next() * 0.35, rng.next() * 0.6 - 0.3, q);

      const sizeJitter = 0.75 + 0.5 * hash01(leafId, 5);
      const ageScale = sp.phenology.evergreen ? 1 : 1;
      pos.push(x, y, z);
      quat.push(q[0], q[1], q[2], q[3]);
      scale.push(s * sizeJitter * ageScale * (shootAge === 0 ? 1 : 0.9));
      nodeOf.push(i);
      pig.push(expansion, chl, car, ant);
      leafColor(lf.color, lf.autumnPigment, chl, car, ant, brown, cbuf, 0);
      // small per-leaf hue variation
      const hv = 0.9 + 0.2 * hash01(leafId, 13);
      col.push(cbuf[0] * hv, cbuf[1] * (2 - hv) * 0.5 + cbuf[1] * 0.5, cbuf[2]);
    }
  }
  return {
    count: scale.length,
    position: Float32Array.from(pos), quaternion: Float32Array.from(quat), scale: Float32Array.from(scale),
    color: Float32Array.from(col), pigment: Float32Array.from(pig), node: Uint32Array.from(nodeOf),
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Leaf local frame: +Y is the blade normal, +Z points from petiole to tip.
 * Build: tip direction = rotate the shoot axis by `outAngle` around the axis at phyllotactic `phase`,
 * then tilt the blade so its normal leans toward world up by `upBias`.
 */
function leafQuaternion(ax: number, ay: number, az: number, phase: number, upBias: number, roll: number, out: Float32Array): void {
  // frame around axis
  let ux: number, uy: number, uz: number;
  if (Math.abs(ay) < 0.9) { ux = -az; uy = 0; uz = ax; } else { ux = 1; uy = 0; uz = 0; }
  const d = ux * ax + uy * ay + uz * az; ux -= d * ax; uy -= d * ay; uz -= d * az;
  const um = Math.hypot(ux, uy, uz) || 1; ux /= um; uy /= um; uz /= um;
  const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
  const out_angle = 1.0; // ~57° from the shoot axis
  const ca = Math.cos(out_angle), sa = Math.sin(out_angle);
  const cp = Math.cos(phase), sp = Math.sin(phase);
  // z axis (tip direction)
  let zx = ax * ca + (ux * cp + vx * sp) * sa, zy = ay * ca + (uy * cp + vy * sp) * sa, zz = az * ca + (uz * cp + vz * sp) * sa;
  // y axis (blade normal): world up blended with the radial direction, orthogonalised against z
  let yx = (1 - upBias) * (ux * cp + vx * sp), yy = (1 - upBias) * (uy * cp + vy * sp) + upBias, yz = (1 - upBias) * (uz * cp + vz * sp);
  const dz = yx * zx + yy * zy + yz * zz; yx -= dz * zx; yy -= dz * zy; yz -= dz * zz;
  let ym = Math.hypot(yx, yy, yz); if (ym < 1e-6) { yx = ux; yy = uy; yz = uz; ym = 1; }
  yx /= ym; yy /= ym; yz /= ym;
  // roll around z
  let xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const rx = xx * cr + yx * sr, ry = xy * cr + yy * sr, rz = xz * cr + yz * sr;
  yx = yx * cr - xx * sr; yy = yy * cr - xy * sr; yz = yz * cr - xz * sr;
  xx = rx; xy = ry; xz = rz;
  // rotation matrix columns (x,y,z) -> quaternion
  const m00 = xx, m01 = yx, m02 = zx, m10 = xy, m11 = yy, m12 = zy, m20 = xz, m21 = yz, m22 = zz;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; out[3] = 0.25 * s; out[0] = (m21 - m12) / s; out[1] = (m02 - m20) / s; out[2] = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; out[3] = (m21 - m12) / s; out[0] = 0.25 * s; out[1] = (m01 + m10) / s; out[2] = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; out[3] = (m02 - m20) / s; out[0] = (m01 + m10) / s; out[1] = 0.25 * s; out[2] = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; out[3] = (m10 - m01) / s; out[0] = (m02 + m20) / s; out[1] = (m12 + m21) / s; out[2] = 0.25 * s; }
}
