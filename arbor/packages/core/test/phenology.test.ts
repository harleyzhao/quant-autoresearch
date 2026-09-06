import { describe, it, expect } from 'vitest';
import { generate, getSpecies, SPECIES_IDS, TreeGrowth, phenologyAt, insideEnvelope, Rng } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const ind = (seed: number, ageYears: number, dayOfYear = 190) => ({ seed, ageYears, dayOfYear, latitude: 48, health: 1 });

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
