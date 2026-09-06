/// <reference lib="webworker" />
/**
 * Generation worker. `generate()` is synchronous and can take seconds for old trees,
 * so it runs here and the resulting typed arrays are transferred (zero-copy) to the page.
 */
import { generate, getSpecies, type IndividualParams, type PlantModel } from '@arbor/core';

export interface GenerateRequest { id: number; speciesId: string; individual: IndividualParams }
export type GenerateResponse = { id: number; model: PlantModel } | { id: number; error: string };

/** Collect every distinct ArrayBuffer backing the model's typed arrays. */
function transferables(model: PlantModel): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const groups: object[] = [model.branches, model.leaves, model.skeleton];
  for (const g of groups) {
    for (const v of Object.values(g)) {
      if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) seen.add(v.buffer);
    }
  }
  return [...seen];
}

self.onmessage = (ev: MessageEvent<GenerateRequest>) => {
  const { id, speciesId, individual } = ev.data;
  try {
    const model = generate(getSpecies(speciesId), individual);
    const msg: GenerateResponse = { id, model };
    (self as unknown as Worker).postMessage(msg, transferables(model));
  } catch (e) {
    const msg: GenerateResponse = { id, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
    (self as unknown as Worker).postMessage(msg);
  }
};
