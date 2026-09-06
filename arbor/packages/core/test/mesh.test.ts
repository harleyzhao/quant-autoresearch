import { describe, it, expect } from 'vitest';
import { generate, getSpecies, SPECIES_IDS, TreeGrowth, phenologyAt, insideEnvelope, Rng } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const ind = (seed: number, ageYears: number, dayOfYear = 190) => ({ seed, ageYears, dayOfYear, latitude: 48, health: 1 });

describe('mesh output', () => {
  it('branch mesh is a valid indexed triangle mesh', () => {
    const m = generate(getSpecies('quercus-robur'), ind(11, 15));
    const { position, normal, uv, index } = m.branches;
    const nv = position.length / 3;
    expect(normal.length).toBe(position.length);
    expect(uv.length / 2).toBe(nv);
    expect(index.length % 3).toBe(0);
    let max = 0;
    for (let i = 0; i < index.length; i++) { if (index[i] > max) max = index[i]; }
    expect(max).toBeLessThan(nv);
    for (let i = 0; i < position.length; i++) expect(Number.isFinite(position[i])).toBe(true);
  });
  it('leaf instances have unit quaternions and sit near their nodes', () => {
    const m = generate(getSpecies('betula-pendula'), ind(11, 15));
    const l = m.leaves;
    for (let i = 0; i < Math.min(l.count, 500); i++) {
      const q = l.quaternion.subarray(i * 4, i * 4 + 4);
      expect(Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1)).toBeLessThan(1e-4);
      const n = l.node[i];
      const d = Math.hypot(l.position[i * 3] - m.skeleton.position[n * 3], l.position[i * 3 + 1] - m.skeleton.position[n * 3 + 1], l.position[i * 3 + 2] - m.skeleton.position[n * 3 + 2]);
      expect(d).toBeLessThan(m.species.internodeLength * 1.5);
    }
  });
});

describe('skeleton simplification', () => {
  it('removes collinear metamers, keeps tips/branch points, stays a valid tree', async () => {
    const { simplifySkeleton } = await import('../src/index.js');
    const m = generate(getSpecies('quercus-robur'), ind(7, 20), { simplify: false });
    const { skeleton: s, oldIndex } = simplifySkeleton(m.skeleton, 6, 1.5);
    expect(s.count).toBeLessThan(m.skeleton.count);
    let tipsFull = 0, tipsSimple = 0;
    for (let i = 0; i < m.skeleton.count; i++) tipsFull += m.skeleton.isTip[i];
    for (let i = 0; i < s.count; i++) { tipsSimple += s.isTip[i]; if (i > 0) expect(s.parent[i]).toBeLessThan(i); expect(oldIndex[i]).toBeGreaterThanOrEqual(i); }
    expect(tipsSimple).toBe(tipsFull);
    const full = generate(getSpecies('quercus-robur'), ind(7, 20), { simplify: false });
    const simple = generate(getSpecies('quercus-robur'), ind(7, 20));
    expect(simple.branches.index.length).toBeLessThanOrEqual(full.branches.index.length);
  });
});

describe('branch mesh winding', () => {
  it('triangle winding agrees with the outward vertex normals', () => {
    const m = generate(getSpecies('betula-pendula'), ind(3, 12));
    const { position: P, normal: N, index: I } = m.branches;
    let agree = 0, total = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const nx = N[a] + N[b] + N[c], ny = N[a + 1] + N[b + 1] + N[c + 1], nz = N[a + 2] + N[b + 2] + N[c + 2];
      const d = fx * nx + fy * ny + fz * nz;
      if (Math.abs(d) < 1e-12) continue;
      total++; if (d > 0) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.97);
  });
});
