/**
 * Realism metrics per species (plan §13, backlog D1). Prints a markdown table.
 *   pnpm --filter @arbor/core metrics [ages=15,30,45] [seed=7]
 * Metrics:
 *   pipe      Leonardo ratio Σ r_child^n / r_parent^n over internal nodes (1 = pipe model holds)
 *   fill      fraction of crown envelope markers occupied at that age (0..1)
 *   angle     mean ± sd of the angle (deg) between a lateral's first segment and its parent segment
 *   h/w       height / crown width
 *   time      wall time for the growth from scratch (ms)
 */
import { TreeGrowth, getSpecies, getSheet, SPECIES_IDS } from '../src/index.js';
import { skeletonStats } from '../src/generate.js';

const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(k + '=')) ?? `${k}=${d}`).split('=')[1];
const ages = arg('ages', '15,30,45').split(',').map(Number);
const seed = Number(arg('seed', '7'));

const identityMode = process.argv.includes('identity');
if (identityMode) {
  // compare the simulation with each species' identity sheet at its reference ages
  console.log('| species | age | height sim/target m | crown width sim/target m | DBH sim/target cm | height err | width err | DBH err |');
  console.log('|---|---|---|---|---|---|---|---|');
  let worst = 0;
  for (const id of SPECIES_IDS) {
    const sp = getSpecies(id); const idn = getSheet(id).identity;
    const refAges = [...new Set([...Object.keys(idn.heightAt), ...Object.keys(idn.dbhAt), ...Object.keys(idn.crownWidthAt)].map(Number))].sort((a, b) => a - b);
    const g = new TreeGrowth(sp, seed);
    let grown = 0;
    for (const age of refAges) {
      g.grow(age - grown); grown = age;
      const st = skeletonStats(g.toSkeleton(), sp);
      const hT = idn.heightAt[String(age)], wT = idn.crownWidthAt[String(age)], dT = idn.dbhAt[String(age)];
      const dbhSim = st.trunkRadius * 200;
      const pe = (sim: number, t?: number) => (t ? ((sim - t) / t) * 100 : NaN);
      const eh = pe(st.height, hT), ew = pe(st.crownWidth, wT), ed = pe(dbhSim, dT);
      for (const e of [eh, ew, ed]) if (Number.isFinite(e)) worst = Math.max(worst, Math.abs(e));
      const f = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}%` : '–');
      console.log(`| ${sp.name} | ${age} | ${st.height.toFixed(1)} / ${hT ?? '–'} | ${st.crownWidth.toFixed(1)} / ${wT ?? '–'} | ${dbhSim.toFixed(0)} / ${dT ?? '–'} | ${f(eh)} | ${f(ew)} | ${f(ed)} |`);
    }
  }
  console.log(`\nworst absolute error: ${worst.toFixed(0)}%`);
  process.exit(0);
}
console.log('| species | age | nodes | tips | height m | width m | h/w | trunk r cm | pipe | fill | branch angle ° | time ms |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const id of SPECIES_IDS) {
  const sp = getSpecies(id);
  const g = new TreeGrowth(sp, seed);
  const t0 = Date.now();
  let grown = 0;
  for (const age of ages) {
    g.grow(age - grown); grown = age;
    const sk = g.toSkeleton();
    const st = skeletonStats(sk, sp);
    // branch angles
    const P = sk.position;
    let sum = 0, sum2 = 0, cnt = 0;
    for (let i = 1; i < sk.count; i++) {
      if (sk.isMain[i]) continue;
      const p = sk.parent[i], gp = sk.parent[p];
      if (gp < 0) continue;
      const ax = P[i * 3] - P[p * 3], ay = P[i * 3 + 1] - P[p * 3 + 1], az = P[i * 3 + 2] - P[p * 3 + 2];
      const bx = P[p * 3] - P[gp * 3], by = P[p * 3 + 1] - P[gp * 3 + 1], bz = P[p * 3 + 2] - P[gp * 3 + 2];
      const c = (ax * bx + ay * by + az * bz) / ((Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) || 1);
      const deg = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
      sum += deg; sum2 += deg * deg; cnt++;
    }
    const mean = cnt ? sum / cnt : 0, sd = cnt ? Math.sqrt(Math.max(0, sum2 / cnt - mean * mean)) : 0;
    const fill = 1 - g.markers.remaining / g.markers.count;
    console.log(`| ${sp.name} | ${age} | ${st.nodes} | ${st.tips} | ${st.height.toFixed(1)} | ${st.crownWidth.toFixed(1)} | ${(st.height / Math.max(0.1, st.crownWidth)).toFixed(2)} | ${(st.trunkRadius * 100).toFixed(1)} | ${st.pipeModelRatio.toFixed(2)} | ${fill.toFixed(2)} | ${mean.toFixed(0)} ± ${sd.toFixed(0)} | ${Date.now() - t0} |`);
  }
}
