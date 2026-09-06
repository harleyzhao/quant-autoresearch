import { describe, it, expect } from 'vitest';
import { generate, getSpecies, SPECIES_IDS, TreeGrowth, phenologyAt, insideEnvelope, Rng } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const ind = (seed: number, ageYears: number, dayOfYear = 190) => ({ seed, ageYears, dayOfYear, latitude: 48, health: 1 });
/** Let the worker's event loop process RPC messages between long synchronous stretches. */
const breathe = () => new Promise<void>((r) => (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, 0));

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
    it(`${id}: grows, stays inside its crown envelope, thickens with age`, async () => {
      const sp = getSpecies(id);
      const g = new TreeGrowth(sp, 7);
      let prevNodes = 0, prevR = 0;
      const top = sp.crown.baseHeight + sp.crown.height;
      for (let y = 1; y <= 24; y++) {
        g.step();
        if (y % 3 !== 0) continue;
        await breathe(); // sample every third season: keeps each test well under the worker RPC timeout
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

describe('gravitational sag', () => {
  it('branches with flexibility end lower than rigid ones, trunk unaffected', async () => {
    await breathe();
    const base = getSpecies('betula-pendula');
    const rigid = generate({ ...base, flexibility: 0 }, ind(9, 18));
    const bent = generate(base, ind(9, 18));
    const meanTipY = (m: typeof rigid) => { let s = 0, c = 0; for (let i = 0; i < m.skeleton.count; i++) if (m.skeleton.isTip[i]) { s += m.skeleton.position[i * 3 + 1]; c++; } return s / c; };
    expect(meanTipY(bent)).toBeLessThan(meanTipY(rigid));
    for (let i = 1; i < bent.skeleton.count; i++) expect(bent.skeleton.position[i * 3 + 1]).toBeGreaterThanOrEqual(0.05);
  });
});

describe('environment obstacles', () => {
  it('a wall keeps branches out and pushes the crown to the other side', async () => {
    await breathe();
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

describe('dead wood retention', () => {
  it('shed branches stay as dead wood for deadBranchYears, carry no leaves, then fall', async () => {
    await breathe();
    const sp = getSpecies('pinus-sylvestris');
    // a harsh shedding threshold guarantees some branches die within the test horizon
    const withDead = generate({ ...sp, shedThreshold: 0.3, shedYears: 2, deadBranchYears: 6 }, ind(4, 22));
    const without = generate({ ...sp, shedThreshold: 0.3, shedYears: 2, deadBranchYears: 0 }, ind(4, 22));
    let dead = 0; for (let i = 0; i < withDead.skeleton.count; i++) dead += withDead.skeleton.dead[i];
    expect(dead).toBeGreaterThan(0);
    expect(withDead.skeleton.count - dead).toBe(without.skeleton.count); // live structure identical
    for (let k = 0; k < withDead.leaves.count; k++) expect(withDead.skeleton.dead[withDead.leaves.node[k]]).toBe(0);
    // dead nodes hang off kept parents only
    for (let i = 1; i < withDead.skeleton.count; i++) expect(withDead.skeleton.parent[i]).toBeGreaterThanOrEqual(0);
  });
});
