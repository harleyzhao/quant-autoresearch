import { describe, it, expect } from 'vitest';
import { generate, getSpecies, SPECIES_IDS, TreeGrowth, phenologyAt, insideEnvelope, Rng } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const ind = (seed: number, ageYears: number, dayOfYear = 190) => ({ seed, ageYears, dayOfYear, latitude: 48, health: 1 });

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
