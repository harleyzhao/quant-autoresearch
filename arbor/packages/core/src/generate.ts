import type { IndividualParams, PlantModel, SpeciesParams, Skeleton } from './types.js';
import { TreeGrowth, type GrowthOptions } from './growth/grow.js';
import { phenologyAt } from './growth/phenology.js';
import { buildBranchMesh, type BranchMeshOptions } from './mesh/branches.js';
import { buildLeaves } from './mesh/leaves.js';
import { applyOverrides } from './species/index.js';

const perf = (globalThis as unknown as { performance?: { now(): number } }).performance;
const now = (): number => (perf ? perf.now() : Date.now());

export function defaultIndividual(seed = 1): IndividualParams {
  return { seed, ageYears: 25, dayOfYear: 190, latitude: 48, health: 1 };
}

export interface GenerateOptions {
  growth?: GrowthOptions;
  mesh?: BranchMeshOptions;
}

/** Full pipeline: grow -> skeleton -> branch mesh + leaves + phenology + stats. */
export function generate(speciesIn: SpeciesParams, individual: IndividualParams, opts: GenerateOptions = {}): PlantModel {
  const species = applyOverrides(speciesIn, individual.overrides);
  const health = Math.max(0.05, Math.min(1, individual.health ?? 1));
  const sp: SpeciesParams = health === 1 ? species : { ...species, resourceScale: species.resourceScale * health };

  const t0 = now();
  const g = new TreeGrowth(sp, individual.seed, opts.growth);
  g.grow(Math.max(1, Math.round(individual.ageYears)));
  const skeleton = g.toSkeleton();
  const t1 = now();

  const phenology = phenologyAt(sp.phenology, individual.dayOfYear, individual.latitude);
  const branches = buildBranchMesh(skeleton, opts.mesh);
  const leaves = buildLeaves(skeleton, sp, phenology, g.year, individual.seed);
  const t2 = now();

  return { species: sp, individual, skeleton, branches, leaves, phenology, stats: { ...skeletonStats(skeleton, sp), leaves: leaves.count, growthMs: t1 - t0, meshMs: t2 - t1 } };
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
