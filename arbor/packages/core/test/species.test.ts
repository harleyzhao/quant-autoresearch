import { describe, it, expect } from 'vitest';
import { SPECIES_IDS, getSpecies, getSheet, phenologyAt, resolveSpecies, CONTEXT, TEMPLATES_BY_ID, GENERA_BY_ID } from '../src/index.js';

describe('species templates', () => {
  it('every species resolves from template + genus + identity sheet', () => {
    for (const id of SPECIES_IDS) {
      const sp = getSpecies(id); const sheet = getSheet(id);
      const genus = GENERA_BY_ID[sheet.genus];
      expect(genus).toBeTruthy();
      expect(TEMPLATES_BY_ID[genus.template]).toBeTruthy();
      // identity drives the measurable parameters
      const hMature = Math.max(...Object.values(sheet.identity.heightAt));
      expect(sp.crown.height + sp.crown.baseHeight).toBeCloseTo(hMature, 5);
      expect(sp.crown.width).toBe(Math.max(...Object.values(sheet.identity.crownWidthAt)));
      expect(sp.leaf.length).toBe(sheet.identity.leaf.length);
    }
  });

  it('observed budburst day of year round-trips through the GDD threshold at the reference latitude', () => {
    for (const id of SPECIES_IDS) {
      const sp = getSpecies(id); const idn = getSheet(id).identity;
      if (idn.phenology.evergreen) continue;
      const lat = idn.referenceLatitude;
      // first day the kernel leaves dormancy
      let first = 0;
      for (let d = 1; d <= 365; d++) { if (phenologyAt(sp.phenology, d, lat).stage !== 'dormant') { first = d; break; } }
      expect(Math.abs(first - idn.phenology.budburstDOY)).toBeLessThanOrEqual(3);
      // colouring is under way by the observed colouring date and leaves are gone after leaf fall + 30
      expect(phenologyAt(sp.phenology, idn.phenology.colouringDOY!, lat).carotenoid).toBeGreaterThan(0.1);
      expect(phenologyAt(sp.phenology, Math.min(365, idn.phenology.leafFallDOY! + 30), lat).shed).toBeGreaterThan(0.9);
    }
  });

  it('a genus can be swapped onto a different template and still resolve', () => {
    const sheet = getSheet('quercus-robur');
    const genus = { ...GENERA_BY_ID.quercus, id: 'quercus-troll', template: 'troll' };
    const ctx = { templates: CONTEXT.templates, genera: new Map([...CONTEXT.genera, ['quercus-troll', genus]]) };
    const sp = resolveSpecies({ ...sheet, genus: 'quercus-troll' }, ctx);
    expect(sp.axisKink).toBe(GENERA_BY_ID.quercus.kernel?.axisKink ?? TEMPLATES_BY_ID.troll.kernel.axisKink);
    expect(sp.crown.width).toBe(16);
  });
});
