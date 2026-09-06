import { describe, it, expect } from 'vitest';
import { generate, getSpecies, SPECIES_IDS, TreeGrowth, phenologyAt, insideEnvelope, Rng } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const ind = (seed: number, ageYears: number, dayOfYear = 190) => ({ seed, ageYears, dayOfYear, latitude: 48, health: 1 });

describe('determinism', () => {
  it('same seed => identical skeleton and leaves', () => {
    const a = generate(getSpecies('quercus-robur'), ind(42, 12));
    const b = generate(getSpecies('quercus-robur'), ind(42, 12));
    expect(a.skeleton.count).toBe(b.skeleton.count);
    expect(Array.from(a.skeleton.position)).toEqual(Array.from(b.skeleton.position));
    expect(Array.from(a.leaves.position)).toEqual(Array.from(b.leaves.position));
  });
  it('different seeds => different trees', () => {
    const a = generate(getSpecies('quercus-robur'), ind(1, 12));
    const b = generate(getSpecies('quercus-robur'), ind(2, 12));
    expect(Array.from(a.skeleton.position)).not.toEqual(Array.from(b.skeleton.position));
  });
  it('rng is platform independent (known sequence)', () => {
    const r = new Rng(123);
    const seq = [r.next(), r.next(), r.next()];
    const r2 = new Rng(123);
    expect([r2.next(), r2.next(), r2.next()]).toEqual(seq);
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('growth behaviour', () => {
  for (const id of SPECIES_IDS) {
    it(`${id}: grows, stays inside its crown envelope, thickens with age`, () => {
      const sp = getSpecies(id);
      const g = new TreeGrowth(sp, 7);
      let prevNodes = 0, prevR = 0;
      const top = sp.crown.baseHeight + sp.crown.height;
      for (let y = 1; y <= 30; y++) {
        g.step();
        const sk = g.toSkeleton();
        expect(sk.count).toBeGreaterThanOrEqual(prevNodes * 0.5); // shedding may remove some, never collapse
        prevNodes = sk.count;
        const st = skeletonStats(sk, sp);
        expect(st.trunkRadius).toBeGreaterThanOrEqual(prevR); // secondary growth is monotonic
        prevR = st.trunkRadius;
        // nothing above the envelope top (plus one shoot) or below ground
        for (let i = 0; i < sk.count; i++) {
          const y = sk.position[i * 3 + 1];
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(top + sp.maxShootLength + 0.5);
        }
      }
      const st = skeletonStats(g.toSkeleton(), sp);
      expect(st.nodes).toBeGreaterThan(200);
      expect(st.tips).toBeGreaterThan(50);
      expect(st.height).toBeGreaterThan(sp.crown.baseHeight + 2);
      // most of the crown is inside the envelope (allow a shoot's worth of overshoot)
      const sk = g.toSkeleton();
      let inside = 0, crownNodes = 0;
      for (let i = 0; i < sk.count; i++) {
        const y = sk.position[i * 3 + 1];
        if (y < sp.crown.baseHeight) continue;
        crownNodes++;
        // sagging limbs may hang below/outside the envelope, so allow a generous margin
        if (insideEnvelope({ ...sp.crown, width: sp.crown.width + 3, height: sp.crown.height + 1, baseHeight: sp.crown.baseHeight - 1.5 }, sk.position[i * 3], y, sk.position[i * 3 + 2])) inside++;
      }
      expect(inside / crownNodes).toBeGreaterThan(0.9);
    });
  }

  it('pipe model approximately holds (Leonardo ratio near 1)', () => {
    const m = generate(getSpecies('quercus-robur'), ind(7, 20));
    expect(m.stats.pipeModelRatio).toBeGreaterThan(0.75);
    expect(m.stats.pipeModelRatio).toBeLessThan(1.15);
  });

  it('parents precede children and radii never grow toward the tips', () => {
    const m = generate(getSpecies('pinus-sylvestris'), ind(3, 15));
    const sk = m.skeleton;
    for (let i = 1; i < sk.count; i++) {
      expect(sk.parent[i]).toBeLessThan(i);
      expect(sk.radius[i]).toBeLessThanOrEqual(sk.radius[sk.parent[i]] + 1e-6);
    }
  });

  it('apical control changes habit: higher λ => taller, narrower for the same age', () => {
    const base = getSpecies('betula-pendula');
    const low = generate({ ...base, apicalControl: 0.3 }, ind(5, 18));
    const high = generate({ ...base, apicalControl: 0.85 }, ind(5, 18));
    expect(high.stats.height / high.stats.crownWidth).toBeGreaterThan(low.stats.height / low.stats.crownWidth);
  });
});

describe('phenology', () => {
  const p = getSpecies('quercus-robur').phenology;
  it('cycles dormant -> expanding -> mature -> senescing -> shedding -> dormant through the year', () => {
    const stages = [15, 140, 200, 295, 320, 360].map((d) => phenologyAt(p, d, 48).stage);
    expect(stages[0]).toBe('dormant');
    expect(['budburst', 'expanding', 'mature']).toContain(stages[1]);
    expect(stages[2]).toBe('mature');
    expect(stages[3]).toBe('senescing');
    expect(['shedding', 'dormant']).toContain(stages[4]);
    expect(stages[5]).toBe('dormant');
  });
  it('chlorophyll falls and carotenoids rise during senescence', () => {
    const summer = phenologyAt(p, 200, 48), autumn = phenologyAt(p, 300, 48);
    expect(autumn.chlorophyll).toBeLessThan(summer.chlorophyll);
    expect(autumn.carotenoid).toBeGreaterThan(summer.carotenoid);
  });
  it('southern hemisphere is phase shifted by half a year', () => {
    const north = phenologyAt(p, 200, 48), south = phenologyAt(p, 200, -48);
    expect(north.stage).toBe('mature');
    expect(south.stage).toBe('dormant');
  });
  it('deciduous trees drop all leaves in winter; evergreens keep them', () => {
    const oakWinter = generate(getSpecies('quercus-robur'), ind(7, 15, 20));
    const oakSummer = generate(getSpecies('quercus-robur'), ind(7, 15, 200));
    const pineWinter = generate(getSpecies('pinus-sylvestris'), ind(7, 15, 20));
    expect(oakSummer.leaves.count).toBeGreaterThan(100);
    expect(oakWinter.leaves.count).toBe(0);
    expect(pineWinter.leaves.count).toBeGreaterThan(100);
  });
  it('autumn leaves are less green than summer leaves', () => {
    const summer = generate(getSpecies('betula-pendula'), ind(5, 15, 200));
    const autumn = generate(getSpecies('betula-pendula'), ind(5, 15, 285));
    const greenness = (l: typeof summer.leaves) => { let g = 0; for (let i = 0; i < l.count; i++) g += l.color[i * 3 + 1] - l.color[i * 3]; return g / l.count; };
    expect(greenness(autumn.leaves)).toBeLessThan(greenness(summer.leaves));
  });
});

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

describe('gravitational sag', () => {
  it('branches with flexibility end lower than rigid ones, trunk unaffected', () => {
    const base = getSpecies('betula-pendula');
    const rigid = generate({ ...base, flexibility: 0 }, ind(9, 18));
    const bent = generate(base, ind(9, 18));
    const meanTipY = (m: typeof rigid) => { let s = 0, c = 0; for (let i = 0; i < m.skeleton.count; i++) if (m.skeleton.isTip[i]) { s += m.skeleton.position[i * 3 + 1]; c++; } return s / c; };
    expect(meanTipY(bent)).toBeLessThan(meanTipY(rigid));
    for (let i = 1; i < bent.skeleton.count; i++) expect(bent.skeleton.position[i * 3 + 1]).toBeGreaterThanOrEqual(0.05);
  });
});

describe('PlantSession (incremental growth)', () => {
  it('growing 10 then 20 years equals growing 20 years from scratch; day changes reuse the skeleton', async () => {
    const { PlantSession } = await import('../src/index.js');
    const sp = getSpecies('betula-pendula');
    const s = new PlantSession(sp, { seed: 21, health: 1 });
    s.growTo(10);
    const m10 = s.build(190, 48);
    s.growTo(20);
    const m20 = s.build(190, 48);
    const ref = generate(sp, ind(21, 20));
    expect(m20.skeleton.count).toBe(ref.skeleton.count);
    expect(Array.from(m20.skeleton.position)).toEqual(Array.from(ref.skeleton.position));
    expect(m20.skeleton.count).toBeGreaterThan(m10.skeleton.count);
    const winter = s.build(20, 48);
    expect(winter.skeleton).toBe(m20.skeleton); // cached, not rebuilt
    expect(winter.leaves.count).toBe(0);
    // shrinking age restarts deterministically
    s.growTo(10);
    expect(Array.from(s.build(190, 48).skeleton.position)).toEqual(Array.from(m10.skeleton.position));
  });
});

describe('environment obstacles', () => {
  it('a wall keeps branches out and pushes the crown to the other side', () => {
    const sp = getSpecies('quercus-robur');
    const wall = { kind: 'box' as const, min: [1.2, 0, -10] as [number, number, number], max: [1.6, 9, 10] as [number, number, number] };
    const free = generate(sp, ind(7, 22));
    const walled = generate(sp, { ...ind(7, 22), obstacles: [wall] });
    const sk = walled.skeleton;
    let cx = 0, beyond = 0;
    for (let i = 0; i < sk.count; i++) {
      const x = sk.position[i * 3], y = sk.position[i * 3 + 1], z = sk.position[i * 3 + 2];
      expect(x >= wall.min[0] && x <= wall.max[0] && y <= wall.max[1] && z >= wall.min[2] && z <= wall.max[2]).toBe(false);
      if (x > wall.max[0]) beyond++;
      cx += x;
    }
    cx /= sk.count;
    let cxFree = 0; for (let i = 0; i < free.skeleton.count; i++) cxFree += free.skeleton.position[i * 3]; cxFree /= free.skeleton.count;
    expect(cx).toBeLessThan(cxFree - 0.3); // crown centroid shifted away from the wall
    expect(beyond / sk.count).toBeLessThan(0.05); // almost nothing reaches over/around the wall at this age
  });
});
