/**
 * Three-level species definition (docs/plant-gen/04 §2, ADR-005):
 *   ArchTemplate  — Hallé/Oldeman/Tomlinson architectural model: the branching rules
 *   GenusDef      — leaf family, bark family, branching angle, phenology style, tuned kernel deltas
 *   SpeciesSheet  — measurable identity: heights, DBH, crown width at reference ages, leaf size,
 *                   phenology dates. Everything a field guide or an allometry database gives.
 * `resolveSpecies()` merges them into the kernel's SpeciesParams. Identity numbers are converted:
 * crown envelope and shoot length from the height/width targets, radial growth from DBH,
 * phenology day-of-year observations into growing-degree-day thresholds via the climate curve.
 */
import type { SpeciesParams, LeafParams, BarkParams, CrownShape, LeafShape, GrowthCurves } from '../types.js';
import { gddToDay } from '../growth/phenology.js';

export type KernelOverrides = Partial<Omit<SpeciesParams, 'id' | 'name' | 'latinName' | 'habit' | 'crown' | 'leaf' | 'phenology' | 'bark'>>;

export interface ArchTemplate {
  id: string;
  name: string;
  description: string;
  kernel: KernelOverrides;
}

export interface GenusDef {
  id: string;
  name: string;
  template: string;
  kernel?: KernelOverrides;
  leaf: Omit<LeafParams, 'length' | 'width'>;
  bark: BarkParams;
  crownShape: CrownShape;
  /** Height of the clear trunk as a fraction of total height at the reference age. */
  crownBaseFraction: number;
}

export interface SpeciesIdentity {
  /** Total height (m) at reference ages (keys are years, e.g. "20", "50"). */
  heightAt: Record<string, number>;
  maxHeight?: number;
  /** Diameter at breast height (cm) at reference ages. */
  dbhAt: Record<string, number>;
  /** Crown width (m) at reference ages. */
  crownWidthAt: Record<string, number>;
  leaf: { length: number; width: number };
  phenology: { budburstDOY: number; colouringDOY?: number; leafFallDOY?: number; evergreen?: boolean };
  /** Latitude (deg) the phenology dates were observed at. */
  referenceLatitude: number;
  longevity?: number;
  sources?: string[];
}

export interface SpeciesSheet {
  id: string;
  name: string;
  latinName?: string;
  genus: string;
  identity: SpeciesIdentity;
  /** Last-resort kernel tweaks specific to this species (keep small; prefer fixing the genus). */
  overrides?: KernelOverrides & { leaf?: Partial<LeafParams>; bark?: Partial<BarkParams>; crownShape?: CrownShape };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Pick the identity value at the largest reference age (the mature target). */
function mature(rec: Record<string, number>): { age: number; value: number } {
  let age = -1, value = 0;
  for (const [k, v] of Object.entries(rec)) { const a = Number(k); if (a > age) { age = a; value = v; } }
  return { age, value };
}
function youngest(rec: Record<string, number>): { age: number; value: number } {
  let age = Infinity, value = 0;
  for (const [k, v] of Object.entries(rec)) { const a = Number(k); if (a < age) { age = a; value = v; } }
  return { age, value };
}

export interface ResolveContext { templates: Map<string, ArchTemplate>; genera: Map<string, GenusDef> }

export function resolveSpecies(sheet: SpeciesSheet, ctx: ResolveContext): SpeciesParams {
  const genus = ctx.genera.get(sheet.genus);
  if (!genus) throw new Error(`species '${sheet.id}': unknown genus '${sheet.genus}'`);
  const tpl = ctx.templates.get(genus.template);
  if (!tpl) throw new Error(`genus '${genus.id}': unknown template '${genus.template}'`);
  const idn = sheet.identity;
  const { leaf: leafOv, bark: barkOv, crownShape: crownOv, ...kernelOv } = sheet.overrides ?? {};

  // --- identity-derived kernel numbers ---
  const hMature = mature(idn.heightAt), hYoung = youngest(idn.heightAt);
  const wMature = mature(idn.crownWidthAt);
  const dbhMature = mature(idn.dbhAt);
  const baseFraction = genus.crownBaseFraction;
  const baseHeight = clamp(baseFraction * hMature.value, 0.3, 12);
  // annual height increment of the young tree, with headroom for the leader's best years
  const maxShootLength = clamp((hYoung.value / Math.max(1, hYoung.age)) * 1.3, 0.3, 1.5);
  const internodeLength = clamp(maxShootLength / 2.5, 0.15, 0.35);
  // radial growth: the pipe-model term supplies roughly half of the mature trunk radius, cambial ageing the rest
  const rMature = dbhMature.value / 200;
  const radialGrowthPerYear = clamp((0.45 * rMature) / Math.max(1, dbhMature.age), 0.0005, 0.005);

  // --- phenology: observed dates -> kernel thresholds at the reference latitude ---
  const lat = idn.referenceLatitude ?? 50;
  const evergreen = !!idn.phenology.evergreen;
  const budburstGDD = clamp(Math.round(gddToDay(idn.phenology.budburstDOY, lat)), 5, 900);
  const colouring = idn.phenology.colouringDOY ?? 300;
  const fall = idn.phenology.leafFallDOY ?? Math.min(365, colouring + 25);
  const phenology: SpeciesParams['phenology'] = evergreen
    ? { budburstGDD, leafExpandDays: 40, senescenceDay: 300, senescenceDays: 40, abscissionDay: 400, abscissionDays: 30, evergreen: true }
    : { budburstGDD, leafExpandDays: 24, senescenceDay: Math.max(200, colouring - 12), senescenceDays: 28, abscissionDay: Math.max(colouring - 2, fall - 10), abscissionDays: 30, evergreen: false };

  // growth curves: every reference age that has a height; width and dbh interpolated where missing
  const ages = [...new Set(Object.keys(idn.heightAt).map(Number))].sort((a, b) => a - b);
  const pick = (rec: Record<string, number>, age: number, fallbackScale: number) => rec[String(age)] ?? fallbackScale;
  const curves: GrowthCurves = {
    ages,
    height: ages.map((a) => idn.heightAt[String(a)]),
    width: ages.map((a) => pick(idn.crownWidthAt, a, (idn.heightAt[String(a)] / hMature.value) * wMature.value)),
    dbh: ages.map((a) => pick(idn.dbhAt, a, (idn.heightAt[String(a)] / hMature.value) * dbhMature.value) / 100),
  };

  const kernel = { ...tpl.kernel, ...(genus.kernel ?? {}), ...kernelOv } as KernelOverrides;
  const leaf: LeafParams = { ...genus.leaf, length: idn.leaf.length, width: idn.leaf.width, ...(leafOv ?? {}) } as LeafParams;
  const bark: BarkParams = { ...genus.bark, ...(barkOv ?? {}) };
  const habit: SpeciesParams['habit'] = leaf.shape === 'needle' ? 'conifer' : 'broadleaf';

  const sp: SpeciesParams = {
    id: sheet.id, name: sheet.name, latinName: sheet.latinName, habit,
    apicalControl: 0.5, resourceScale: 2.8, internodeLength, maxShootLength, perceptionAngle: 60, perceptionDistance: 5, occupancyRadius: 0.9,
    branchingAngle: 45, phyllotaxis: 137.5, branchingMode: 'alternate', whorlCount: 0, lateralBudProbability: 0.5, budLifespan: 3,
    directionInertia: 1.0, phototropism: 0.85, gravitropism: 0.15, lateralShootScale: 0.8, axisKink: 0.1, flexibility: 8e-9, sagMax: 0.4,
    noise: 0.3, maxOrder: 10, shedThreshold: 0.12, shedYears: 3, daVinciExponent: 2.0, tipRadius: 0.002, radialGrowthPerYear, deadBranchYears: 2,
    ...kernel,
    crown: { shape: crownOv ?? genus.crownShape, height: Math.max(2, hMature.value - baseHeight), width: Math.max(1, wMature.value), baseHeight },
    leaf, phenology, bark, curves,
  };
  // template/genus may carry these too; identity always wins for the measurable ones
  sp.internodeLength = kernelOv.internodeLength ?? internodeLength;
  sp.maxShootLength = kernelOv.maxShootLength ?? maxShootLength;
  sp.radialGrowthPerYear = kernelOv.radialGrowthPerYear ?? radialGrowthPerYear;
  return sp;
}

export function buildContext(templates: ArchTemplate[], genera: GenusDef[]): ResolveContext {
  return { templates: new Map(templates.map((t) => [t.id, t])), genera: new Map(genera.map((g) => [g.id, g])) };
}

export type { LeafShape };
