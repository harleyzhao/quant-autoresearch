/// <reference lib="webworker" />
/**
 * Generation worker. Growth is synchronous and can take seconds for old trees, so it runs here.
 * A PlantSession is kept per (species, seed, health, overrides): moving the age slider forward
 * only simulates the extra seasons, and changing the day of year only rebuilds leaves.
 */
import { PlantSession, getSpecies, type IndividualParams, type PlantModel } from '@arbor/core';

export interface GenerateRequest { id: number; speciesId: string; individual: IndividualParams }
export type GenerateResponse = { id: number; model: PlantModel } | { id: number; error: string };

let session: PlantSession | null = null;
let sessionKey = '';

/** Leaves are rebuilt per request and can be transferred; skeleton and branch mesh are cached in the session and must be copied. */
function transferables(model: PlantModel): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  for (const v of Object.values(model.leaves)) if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) seen.add(v.buffer);
  return [...seen];
}

self.onmessage = (ev: MessageEvent<GenerateRequest>) => {
  const { id, speciesId, individual } = ev.data;
  try {
    const key = JSON.stringify({ speciesId, seed: individual.seed, health: individual.health, overrides: individual.overrides ?? null });
    if (!session || key !== sessionKey) { session = new PlantSession(getSpecies(speciesId), individual); sessionKey = key; }
    const growthMs = session.growTo(individual.ageYears);
    const model = session.build(individual.dayOfYear, individual.latitude, growthMs);
    model.individual = individual;
    const msg: GenerateResponse = { id, model };
    (self as unknown as Worker).postMessage(msg, transferables(model));
  } catch (e) {
    session = null; sessionKey = '';
    const msg: GenerateResponse = { id, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
    (self as unknown as Worker).postMessage(msg);
  }
};
