/**
 * Species library linter (docs/plant-gen/04 §2): every parameter must exist, be of the right
 * type and lie in a botanically plausible range. Exits non-zero on the first species with errors.
 *   pnpm --filter @arbor/core validate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES } from '../src/index.js';
import { LEAF_FAMILY_DEFAULTS, leafFamilyOf } from '../src/organs/leafShape.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', '..', 'species');

type Range = [number, number];
const RANGES: Record<string, Range> = {
  apicalControl: [0.1, 0.95], resourceScale: [1, 6], internodeLength: [0.05, 0.6], maxShootLength: [0.2, 2.5],
  perceptionAngle: [30, 90], perceptionDistance: [2, 8], occupancyRadius: [0.5, 2], branchingAngle: [15, 90],
  phyllotaxis: [90, 180], whorlCount: [0, 10], lateralBudProbability: [0.1, 1], budLifespan: [1, 6],
  directionInertia: [0.3, 3], phototropism: [0.1, 2], gravitropism: [-0.6, 0.6], lateralShootScale: [0.2, 1],
  axisKink: [0, 0.4], flexibility: [0, 1e-6], sagMax: [0, 1.6], noise: [0, 0.8], maxOrder: [3, 12],
  shedThreshold: [0.02, 0.4], shedYears: [1, 6], daVinciExponent: [1.8, 2.6], tipRadius: [0.0008, 0.005], radialGrowthPerYear: [0.0005, 0.005],
};
const LEAF_SHAPES = ['ovate', 'lanceolate', 'lobed', 'palmate', 'pinnate', 'needle'];
const BARK = ['smooth', 'lenticel', 'furrowed', 'plated', 'fibrous', 'exfoliating', 'ridged'];
const CROWNS = ['ellipsoid', 'sphere', 'cone', 'column', 'spreading', 'vase'];
const PIGMENTS = ['yellow', 'orange', 'red', 'brown', 'none'];

let failures = 0;
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  const errs: string[] = [];
  const sp = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
  const id = String(sp.id);
  if (id + '.json' !== f) errs.push(`id '${id}' does not match file name`);
  if (!SPECIES[id]) errs.push('not registered in packages/core/src/species/index.ts');
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    const v = sp[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) { errs.push(`${k}: missing or not a number`); continue; }
    if (v < lo || v > hi) errs.push(`${k}=${v} outside [${lo}, ${hi}]`);
  }
  if (sp.deadBranchYears !== undefined && !((sp.deadBranchYears as number) >= 0 && (sp.deadBranchYears as number) <= 12)) errs.push('deadBranchYears outside [0, 12]');
  if (sp.lateralGravitropism !== undefined && (typeof sp.lateralGravitropism !== 'number' || Math.abs(sp.lateralGravitropism as number) > 0.6)) errs.push('lateralGravitropism outside [-0.6, 0.6]');
  if (!['alternate', 'whorled'].includes(String(sp.branchingMode))) errs.push('branchingMode must be alternate|whorled');
  if (sp.branchingMode === 'whorled' && !((sp.whorlCount as number) >= 3)) errs.push('whorled species need whorlCount >= 3');
  const crown = sp.crown as Record<string, number | string> | undefined;
  if (!crown) errs.push('crown missing');
  else {
    if (!CROWNS.includes(String(crown.shape))) errs.push(`crown.shape '${crown.shape}' unknown`);
    if (!((crown.height as number) >= 2 && (crown.height as number) <= 60)) errs.push('crown.height outside [2, 60]');
    if (!((crown.width as number) >= 1 && (crown.width as number) <= 40)) errs.push('crown.width outside [1, 40]');
    if (!((crown.baseHeight as number) >= 0 && (crown.baseHeight as number) <= 15)) errs.push('crown.baseHeight outside [0, 15]');
  }
  const leaf = sp.leaf as Record<string, unknown> | undefined;
  if (!leaf) errs.push('leaf missing');
  else {
    if (!LEAF_SHAPES.includes(String(leaf.shape))) errs.push(`leaf.shape '${leaf.shape}' unknown`);
    if (!((leaf.length as number) > 0.005 && (leaf.length as number) < 1.5)) errs.push('leaf.length outside (0.005, 1.5) m');
    if (!((leaf.perNode as number) >= 1 && (leaf.perNode as number) <= 12)) errs.push('leaf.perNode outside [1, 12]');
    if (!((leaf.maxBranchRadius as number) > 0.002 && (leaf.maxBranchRadius as number) < 0.03)) errs.push('leaf.maxBranchRadius outside (0.002, 0.03)');
    if (!PIGMENTS.includes(String(leaf.autumnPigment))) errs.push(`leaf.autumnPigment '${leaf.autumnPigment}' unknown`);
    const col = leaf.color as number[];
    if (!Array.isArray(col) || col.length !== 3 || col.some((c) => c < 0 || c > 1)) errs.push('leaf.color must be 3 numbers in [0,1]');
    const shp = leaf.shapeParams as Record<string, unknown> | undefined;
    if (shp) {
      const fam = leafFamilyOf(String(leaf.shape)).family;
      const allowed = new Set(Object.keys(LEAF_FAMILY_DEFAULTS[fam]));
      for (const k of Object.keys(shp)) if (!allowed.has(k)) errs.push(`leaf.shapeParams.${k} is not a LeafShapeParams field`);
      if (shp.aspect !== undefined && !((shp.aspect as number) > 0.02 && (shp.aspect as number) < 2)) errs.push('leaf.shapeParams.aspect outside (0.02, 2)');
      const lobes = shp.lobes as Record<string, number> | undefined;
      if (lobes && lobes.depth !== undefined && (lobes.depth < 0 || lobes.depth > 0.9)) errs.push('leaf.shapeParams.lobes.depth outside [0, 0.9]');
    }
  }
  const ph = sp.phenology as Record<string, number | boolean> | undefined;
  if (!ph) errs.push('phenology missing');
  else if (!ph.evergreen) {
    if (!((ph.budburstGDD as number) >= 50 && (ph.budburstGDD as number) <= 600)) errs.push('phenology.budburstGDD outside [50, 600]');
    if (!((ph.senescenceDay as number) < (ph.abscissionDay as number))) errs.push('phenology: senescenceDay must precede abscissionDay');
    if (!((ph.abscissionDay as number) <= 365)) errs.push('phenology.abscissionDay > 365 for a deciduous species');
  }
  const bark = sp.bark as Record<string, unknown> | undefined;
  if (!bark) errs.push('bark missing');
  else {
    if (bark.family !== undefined && !BARK.includes(String(bark.family))) errs.push(`bark.family '${bark.family}' unknown`);
    if (bark.scale !== undefined && !((bark.scale as number) > 0.2 && (bark.scale as number) < 6)) errs.push('bark.scale outside (0.2, 6)');
  }
  if (errs.length) { failures++; console.log(`✗ ${f}\n   - ${errs.join('\n   - ')}`); }
  else console.log(`✓ ${f}`);
}
console.log(`${files.length - failures}/${files.length} species valid`);
if (failures) process.exit(1);
