/**
 * Species library linter (docs/plant-gen/04 §2): every parameter must exist, be of the right
 * type and lie in a botanically plausible range. Exits non-zero on the first species with errors.
 *   pnpm --filter @arbor/core validate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES, SHEETS_BY_ID, GENERA_BY_ID, TEMPLATES_BY_ID } from '../src/index.js';
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
  const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
  const id = String(raw.id);
  if (id + '.json' !== f) errs.push(`id '${id}' does not match file name`);
  // --- identity sheet ---
  const genus = GENERA_BY_ID[String(raw.genus)];
  if (!genus) errs.push(`genus '${raw.genus}' not found in species/genera`);
  else if (!TEMPLATES_BY_ID[genus.template]) errs.push(`genus '${genus.id}' references unknown template '${genus.template}'`);
  const idn = raw.identity as Record<string, unknown> | undefined;
  if (!idn) errs.push('identity missing');
  else {
    for (const k of ['heightAt', 'dbhAt', 'crownWidthAt']) {
      const rec = idn[k] as Record<string, number> | undefined;
      if (!rec || Object.keys(rec).length < 2) errs.push(`identity.${k} needs at least two reference ages`);
      else for (const [age, v] of Object.entries(rec)) if (!(Number(age) > 0 && v > 0)) errs.push(`identity.${k}[${age}] invalid`);
    }
    const h = idn.heightAt as Record<string, number> | undefined, w = idn.crownWidthAt as Record<string, number> | undefined;
    if (h && w) for (const age of Object.keys(h)) if (w[age] !== undefined && w[age] > h[age] * 1.6) errs.push(`identity: crown width at ${age} y exceeds 1.6× height`);
    const lf = idn.leaf as Record<string, number> | undefined;
    if (!lf || !(lf.length > 0.005 && lf.length < 1.5) || !(lf.width > 0.001 && lf.width < 1.5)) errs.push('identity.leaf length/width out of range');
    const ph = idn.phenology as Record<string, number | boolean> | undefined;
    if (!ph || !((ph.budburstDOY as number) >= 30 && (ph.budburstDOY as number) <= 200)) errs.push('identity.phenology.budburstDOY outside [30, 200]');
    else if (!ph.evergreen) {
      if (!((ph.colouringDOY as number) > (ph.budburstDOY as number) + 100)) errs.push('identity.phenology.colouringDOY must be > budburst + 100 days');
      if (!((ph.leafFallDOY as number) >= (ph.colouringDOY as number))) errs.push('identity.phenology.leafFallDOY must be >= colouringDOY');
    }
    if (!(Array.isArray(idn.sources) && (idn.sources as string[]).length)) errs.push('identity.sources must cite where the numbers came from');
  }
  // --- resolved kernel parameters ---
  const sp = SPECIES[id] as unknown as Record<string, unknown> | undefined;
  if (!sp) errs.push('did not resolve (not in registry? run scripts/gen-species-registry.py)');
  else {
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      const v = sp[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) { errs.push(`${k}: missing or not a number`); continue; }
      if (v < lo || v > hi) errs.push(`${k}=${v} outside [${lo}, ${hi}]`);
    }
    if (sp.deadBranchYears !== undefined && !((sp.deadBranchYears as number) >= 0 && (sp.deadBranchYears as number) <= 12)) errs.push('deadBranchYears outside [0, 12]');
    if (sp.lateralGravitropism !== undefined && (typeof sp.lateralGravitropism !== 'number' || Math.abs(sp.lateralGravitropism as number) > 0.6)) errs.push('lateralGravitropism outside [-0.6, 0.6]');
    if (!['alternate', 'whorled'].includes(String(sp.branchingMode))) errs.push('branchingMode must be alternate|whorled');
    if (sp.branchingMode === 'whorled' && !((sp.whorlCount as number) >= 3)) errs.push('whorled species need whorlCount >= 3');
    const crown = sp.crown as Record<string, number | string>;
    if (!CROWNS.includes(String(crown.shape))) errs.push(`crown.shape '${crown.shape}' unknown`);
    if (!((crown.height as number) >= 2 && (crown.height as number) <= 60)) errs.push('crown.height outside [2, 60]');
    if (!((crown.width as number) >= 1 && (crown.width as number) <= 40)) errs.push('crown.width outside [1, 40]');
    const leaf = sp.leaf as Record<string, unknown>;
    if (!LEAF_SHAPES.includes(String(leaf.shape))) errs.push(`leaf.shape '${leaf.shape}' unknown`);
    if (!((leaf.perNode as number) >= 1 && (leaf.perNode as number) <= 12)) errs.push('leaf.perNode outside [1, 12]');
    if (!((leaf.maxBranchRadius as number) > 0.002 && (leaf.maxBranchRadius as number) < 0.03)) errs.push('leaf.maxBranchRadius outside (0.002, 0.03)');
    if (!PIGMENTS.includes(String(leaf.autumnPigment))) errs.push(`leaf.autumnPigment '${leaf.autumnPigment}' unknown`);
    const shp = leaf.shapeParams as Record<string, unknown> | undefined;
    if (shp) {
      const fam = leafFamilyOf(String(leaf.shape)).family;
      const allowed = new Set(Object.keys(LEAF_FAMILY_DEFAULTS[fam]));
      for (const k of Object.keys(shp)) if (!allowed.has(k)) errs.push(`leaf.shapeParams.${k} is not a LeafShapeParams field`);
    }
    const ph = sp.phenology as Record<string, number | boolean>;
    if (!ph.evergreen && !((ph.senescenceDay as number) < (ph.abscissionDay as number))) errs.push('phenology: senescenceDay must precede abscissionDay');
    const bark = sp.bark as Record<string, unknown>;
    if (bark.family !== undefined && !BARK.includes(String(bark.family))) errs.push(`bark.family '${bark.family}' unknown`);
  }
  if (errs.length) { failures++; console.log(`✗ ${f}\n   - ${errs.join('\n   - ')}`); }
  else console.log(`✓ ${f}  (${genus?.template ?? '?'} / ${genus?.id ?? '?'})`);
}
console.log(`${files.length - failures}/${files.length} species valid; ${Object.keys(SHEETS_BY_ID).length} registered`);
if (failures) process.exit(1);
