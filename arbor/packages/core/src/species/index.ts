import type { SpeciesParams } from '../types.js';
import quercus from '../../../../species/quercus-robur.json' with { type: 'json' };
import betula from '../../../../species/betula-pendula.json' with { type: 'json' };
import pinus from '../../../../species/pinus-sylvestris.json' with { type: 'json' };
import acer from '../../../../species/acer-platanoides.json' with { type: 'json' };

export const SPECIES: Record<string, SpeciesParams> = {
  [quercus.id]: quercus as SpeciesParams,
  [betula.id]: betula as SpeciesParams,
  [pinus.id]: pinus as SpeciesParams,
  [acer.id]: acer as SpeciesParams,
};

export const SPECIES_IDS = Object.keys(SPECIES);

export function getSpecies(id: string): SpeciesParams {
  const s = SPECIES[id];
  if (!s) throw new Error(`Unknown species '${id}'. Known: ${SPECIES_IDS.join(', ')}`);
  return s;
}

/** Shallow-merge overrides (crown merged one level deeper). */
export function applyOverrides(base: SpeciesParams, ov?: Partial<SpeciesParams> & { crown?: Partial<SpeciesParams['crown']> }): SpeciesParams {
  if (!ov) return base;
  const { crown, ...rest } = ov;
  return { ...base, ...rest, crown: { ...base.crown, ...(crown ?? {}) } } as SpeciesParams;
}
