import type { IndividualParams, PlantModel, SpeciesParams, Skeleton } from './types.js';
import { TreeGrowth, type GrowthOptions } from './growth/grow.js';
import { phenologyAt } from './growth/phenology.js';
import { buildBranchMesh, type BranchMeshOptions } from './mesh/branches.js';
import { buildLeaves } from './mesh/leaves.js';
import { simplifySkeleton } from './mesh/simplify.js';
import { applyOverrides } from './species/index.js';

const perf = (globalThis as unknown as { performance?: { now(): number } }).performance;
const now = (): number => (perf ? perf.now() : Date.now());

export function defaultIndividual(seed = 1): IndividualParams {
  return { seed, ageYears: 25, dayOfYear: 190, latitude: 48, health: 1 };
}

export interface GenerateOptions {
  growth?: GrowthOptions;
  mesh?: BranchMeshOptions;
  /** Collapse collinear metamers before meshing (default on, 6°). Pass false to mesh every metamer. */
  simplify?: { angleDeg?: number; maxLength?: number } | false;
}

function resolveSpecies(speciesIn: SpeciesParams, individual: Pick<IndividualParams, 'health' | 'overrides'>): SpeciesParams {
  const species = applyOverrides(speciesIn, individual.overrides);
  const health = Math.max(0.05, Math.min(1, individual.health ?? 1));
  return health === 1 ? species : { ...species, resourceScale: species.resourceScale * health };
}

/**
 * A growing plant that can be advanced year by year and rebuilt for any day of the year.
 * Growing forward reuses the simulation state (incremental), so an age slider costs one season per
 * step instead of a full re-simulation; a day-of-year change rebuilds only leaves and phenology.
 * Results are bit-identical to `generate()` for the same (species, seed, age).
 */
export class PlantSession {
  readonly species: SpeciesParams;
  readonly seed: number;
  private growth: TreeGrowth;
  private opts: GenerateOptions;
  private skeletonCache: { age: number; skeleton: Skeleton; branches: ReturnType<typeof buildBranchMesh> } | null = null;

  constructor(speciesIn: SpeciesParams, individual: Pick<IndividualParams, 'seed' | 'health' | 'overrides' | 'obstacles'>, opts: GenerateOptions = {}) {
    this.species = resolveSpecies(speciesIn, individual);
    this.seed = individual.seed;
    this.opts = individual.obstacles?.length ? { ...opts, growth: { ...opts.growth, obstacles: individual.obstacles } } : opts;
    this.growth = new TreeGrowth(this.species, this.seed, this.opts.growth);
  }

  get age(): number { return this.growth.year; }

  /** Advance (or restart and advance) to `ageYears` seasons. Returns wall time spent growing (ms). */
  growTo(ageYears: number): number {
    const target = Math.max(1, Math.round(ageYears));
    const t0 = now();
    if (target < this.growth.year) { this.growth = new TreeGrowth(this.species, this.seed, this.opts.growth); this.skeletonCache = null; }
    if (target > this.growth.year) { this.growth.grow(target - this.growth.year); this.skeletonCache = null; }
    return now() - t0;
  }

  /** Build meshes and phenology for a day of year at the current age. */
  build(dayOfYear: number, latitude: number, growthMs = 0): PlantModel {
    const sp = this.species;
    const t1 = now();
    if (!this.skeletonCache || this.skeletonCache.age !== this.growth.year) {
      const skeleton = this.growth.toSkeleton();
      const meshSkeleton = this.opts.simplify === false ? skeleton : simplifySkeleton(skeleton, this.opts.simplify?.angleDeg ?? 6, this.opts.simplify?.maxLength ?? 1.5).skeleton;
      this.skeletonCache = { age: this.growth.year, skeleton, branches: buildBranchMesh(meshSkeleton, this.opts.mesh) };
    }
    const { skeleton, branches } = this.skeletonCache;
    const phenology = phenologyAt(sp.phenology, dayOfYear, latitude);
    const leaves = buildLeaves(skeleton, sp, phenology, this.growth.year, this.seed);
    const t2 = now();
    const individual: IndividualParams = { seed: this.seed, ageYears: this.growth.year, dayOfYear, latitude, health: 1 };
    return { species: sp, individual, skeleton, branches, leaves, phenology, stats: { ...skeletonStats(skeleton, sp), leaves: leaves.count, growthMs, meshMs: t2 - t1 } };
  }
}

/** Full pipeline in one call: grow -> skeleton -> branch mesh + leaves + phenology + stats. */
export function generate(speciesIn: SpeciesParams, individual: IndividualParams, opts: GenerateOptions = {}): PlantModel {
  const session = new PlantSession(speciesIn, individual, opts);
  const growthMs = session.growTo(individual.ageYears);
  const model = session.build(individual.dayOfYear, individual.latitude, growthMs);
  model.individual = individual;
  return model;
}

export function skeletonStats(sk: Skeleton, sp: SpeciesParams) {
  const n = sk.count;
  let height = 0, tips = 0, minx = 0, maxx = 0, minz = 0, maxz = 0;
  for (let i = 0; i < n; i++) {
    const x = sk.position[i * 3], y = sk.position[i * 3 + 1], z = sk.position[i * 3 + 2];
    if (y > height) height = y;
    if (x < minx) minx = x; if (x > maxx) maxx = x; if (z < minz) minz = z; if (z > maxz) maxz = z;
    if (sk.isTip[i]) tips++;
  }
  // pipe-model check: Σ r_child^n / r_parent^n over internal nodes, ignoring the age-thickening term
  const childSum = new Float64Array(n);
  for (let i = 1; i < n; i++) childSum[sk.parent[i]] += Math.pow(sk.radius[i], sp.daVinciExponent);
  let acc = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (!sk.isTip[i] && sk.radius[i] > 0) { acc += childSum[i] / Math.pow(sk.radius[i], sp.daVinciExponent); cnt++; }
  return { nodes: n, tips, height, crownWidth: Math.max(maxx - minx, maxz - minz), trunkRadius: sk.radius[0], pipeModelRatio: cnt ? acc / cnt : 0 };
}
