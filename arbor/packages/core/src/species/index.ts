import type { SpeciesParams } from '../types.js';
import quercus from '../../../../species/quercus-robur.json' with { type: 'json' };
import betula from '../../../../species/betula-pendula.json' with { type: 'json' };
import pinus from '../../../../species/pinus-sylvestris.json' with { type: 'json' };
import acer from '../../../../species/acer-platanoides.json' with { type: 'json' };
import fagus_sylvatica from '../../../../species/fagus-sylvatica.json' with { type: 'json' };
import fraxinus_excelsior from '../../../../species/fraxinus-excelsior.json' with { type: 'json' };
import picea_abies from '../../../../species/picea-abies.json' with { type: 'json' };
import populus_tremula from '../../../../species/populus-tremula.json' with { type: 'json' };
import salix_babylonica from '../../../../species/salix-babylonica.json' with { type: 'json' };
import platanus_acerifolia from '../../../../species/platanus-acerifolia.json' with { type: 'json' };
import tilia_cordata from '../../../../species/tilia-cordata.json' with { type: 'json' };
import prunus_avium from '../../../../species/prunus-avium.json' with { type: 'json' };

export const SPECIES: Record<string, SpeciesParams> = {
  [quercus.id]: quercus as SpeciesParams,
  [betula.id]: betula as SpeciesParams,
  [pinus.id]: pinus as SpeciesParams,
  [acer.id]: acer as SpeciesParams,
  [fagus_sylvatica.id]: fagus_sylvatica as SpeciesParams,
  [fraxinus_excelsior.id]: fraxinus_excelsior as SpeciesParams,
  [picea_abies.id]: picea_abies as SpeciesParams,
  [populus_tremula.id]: populus_tremula as SpeciesParams,
  [salix_babylonica.id]: salix_babylonica as SpeciesParams,
  [platanus_acerifolia.id]: platanus_acerifolia as SpeciesParams,
  [tilia_cordata.id]: tilia_cordata as SpeciesParams,
  [prunus_avium.id]: prunus_avium as SpeciesParams,
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
