import { describe, it, expect } from 'vitest';
import { generate, getSpecies, SPECIES_IDS, TreeGrowth, phenologyAt, insideEnvelope, Rng } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const ind = (seed: number, ageYears: number, dayOfYear = 190) => ({ seed, ageYears, dayOfYear, latitude: 48, health: 1 });

describe('leaf silhouettes', () => {
  it('every family yields valid CCW polygons inside the unit frame with veins', async () => {
    const { leafSilhouette, resolveLeafShape, leafFamilyOf, polygonArea } = await import('../src/index.js');
    for (const shape of ['ovate', 'lanceolate', 'lobed', 'palmate', 'pinnate', 'needle']) {
      const f = leafFamilyOf(shape);
      const sil = leafSilhouette(resolveLeafShape(f.family, f.overrides));
      expect(sil.polygons.length).toBeGreaterThan(0);
      expect(sil.veins.length).toBeGreaterThan(0);
      for (const poly of sil.polygons) {
        expect(polygonArea(poly)).toBeGreaterThan(0); // CCW
        for (let i = 0; i < poly.length; i += 2) {
          expect(Math.abs(poly[i])).toBeLessThan(0.8);
          expect(poly[i + 1]).toBeGreaterThan(-0.15);
          expect(poly[i + 1]).toBeLessThan(1.1);
        }
      }
    }
  });
  it('lobing removes area, serration adds edge, pinnate has one polygon per leaflet', async () => {
    const { leafSilhouette, resolveLeafShape, polygonArea } = await import('../src/index.js');
    const plain = leafSilhouette(resolveLeafShape('lobed', { lobes: { count: 4, depth: 0, round: 1 } }));
    const lobed = leafSilhouette(resolveLeafShape('lobed', { lobes: { count: 4, depth: 0.5, round: 1 } }));
    expect(polygonArea(lobed.polygons[0])).toBeLessThan(polygonArea(plain.polygons[0]) * 0.85);
    const perimeter = (poly: Float32Array) => { let l = 0; for (let i = 0; i < poly.length; i += 2) { const j = (i + 2) % poly.length; l += Math.hypot(poly[j] - poly[i], poly[j + 1] - poly[i + 1]); } return l; };
    const entire = leafSilhouette(resolveLeafShape('simple', { serration: { amplitude: 0, count: 0 } }));
    const serrate = leafSilhouette(resolveLeafShape('simple', { serration: { amplitude: 0.1, count: 20 } }));
    expect(perimeter(serrate.polygons[0])).toBeGreaterThan(perimeter(entire.polygons[0]) * 1.1);
    const pinnate = leafSilhouette(resolveLeafShape('pinnate', { leaflets: { count: 9, aspect: 0.4 } }));
    expect(pinnate.polygons.length).toBe(9);
  });
});
