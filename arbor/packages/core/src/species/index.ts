import type { SpeciesParams } from '../types.js';
import { TEMPLATES, GENERA, SHEETS } from './registry.generated.js';
import { buildContext, resolveSpecies, type SpeciesSheet, type GenusDef, type ArchTemplate } from './resolve.js';

export const CONTEXT = buildContext(TEMPLATES, GENERA);
export const SHEETS_BY_ID: Record<string, SpeciesSheet> = Object.fromEntries(SHEETS.map((s) => [s.id, s]));
export const GENERA_BY_ID: Record<string, GenusDef> = Object.fromEntries(GENERA.map((g) => [g.id, g]));
export const TEMPLATES_BY_ID: Record<string, ArchTemplate> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/** Kernel parameters for every species, resolved from template + genus + identity sheet. */
export const SPECIES: Record<string, SpeciesParams> = Object.fromEntries(SHEETS.map((s) => [s.id, resolveSpecies(s, CONTEXT)]));
export const SPECIES_IDS = Object.keys(SPECIES);

export function getSpecies(id: string): SpeciesParams {
  const s = SPECIES[id];
  if (!s) throw new Error(`Unknown species '${id}'. Known: ${SPECIES_IDS.join(', ')}`);
  return s;
}

export function getSheet(id: string): SpeciesSheet {
  const s = SHEETS_BY_ID[id];
  if (!s) throw new Error(`Unknown species '${id}'`);
  return s;
}

/** Shallow-merge overrides (crown merged one level deeper). */
export function applyOverrides(base: SpeciesParams, ov?: Partial<SpeciesParams> & { crown?: Partial<SpeciesParams['crown']> }): SpeciesParams {
  if (!ov) return base;
  const { crown, ...rest } = ov;
  return { ...base, ...rest, crown: { ...base.crown, ...(crown ?? {}) } } as SpeciesParams;
}
