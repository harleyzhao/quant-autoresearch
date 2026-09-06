import type { SpeciesParams, Skeleton, Obstacle, CrownEnvelope } from '../types.js';
import { curveAt } from '../types.js';
import { Rng } from '../rng.js';
import { MarkerField, generateMarkers, insideEnvelope } from './markers.js';
import { ShadowGrid } from './shadow.js';

/**
 * Self-organizing tree growth (Pałubicki, Horel, Longay, Runions, Lane, Měch, Prusinkiewicz 2009),
 * space-colonization flavour with shadow propagation, Borchert–Honda resource allocation and
 * pipe-model secondary growth. One call to `step()` = one growing season.
 *
 * Everything here is deterministic given (species, seed).
 */

interface Bud {
  node: number;
  dx: number; dy: number; dz: number;
  order: number;
  /** true until the bud has produced its first metamer (it then becomes the terminal bud of a new branch). */
  lateral: boolean;
  /** years spent dormant */
  age: number;
  /** phyllotactic phase accumulated along the shoot this bud extends */
  phase: number;
  alive: boolean;
  // per-year scratch
  q: number; v: number;
  /** light-only quality (no space term); drives shedding */
  light: number;
  /** markers seen last season (-1 = never evaluated). A dormant bud that saw none sees none until occupancy is refreshed. */
  lastCnt: number;
  ox: number; oy: number; oz: number;
}

export interface GrowthOptions {
  maxNodes?: number;
  /** Marker spacing in internode lengths (smaller = denser space, more metamers). */
  markerSpacing?: number;
  /** Shadow propagation: per-node shadow a, decay base b, pyramid depth (voxels). */
  shadowA?: number;
  shadowB?: number;
  shadowDepth?: number;
  /** Pyramid half-width growth per voxel of depth (1 = 45°). */
  shadowSpread?: number;
  /** Recompute marker occupancy from scratch every N years (frees space left by shed branches). */
  occupancyRefresh?: number;
  /** Environment obstacles: no markers inside, shoots stop at the surface, boxes cast shade. */
  obstacles?: Obstacle[];
}

export function insideObstacle(o: Obstacle, x: number, y: number, z: number): boolean {
  if (o.kind === 'box') return x >= o.min[0] && x <= o.max[0] && y >= o.min[1] && y <= o.max[1] && z >= o.min[2] && z <= o.max[2];
  const dx = x - o.center[0], dy = y - o.center[1], dz = z - o.center[2];
  return dx * dx + dy * dy + dz * dz <= o.radius * o.radius;
}

const DEG = Math.PI / 180;

export class TreeGrowth {
  readonly sp: SpeciesParams;
  readonly rng: Rng;
  private opts: Required<Omit<GrowthOptions, 'obstacles'>>;
  readonly obstacles: Obstacle[];
  private obstacleCorners: Float32Array | undefined;

  // node storage (growable)
  parent: number[] = [];
  px: number[] = []; py: number[] = []; pz: number[] = [];
  dx: number[] = []; dy: number[] = []; dz: number[] = [];
  birthYear: number[] = [];
  order: number[] = [];
  isMain: number[] = [];
  alive: number[] = [];
  children: number[][] = [];
  mainChild: number[] = [];
  lowLightYears: number[] = [];
  /** accumulated gravitational bend per lateral root (rad) */
  sag: number[] = [];
  /** season in which the node died (-1 = alive) */
  deadYear: number[] = [];
  // per-year derived
  nodeQ: number[] = [];
  nodeLight: number[] = [];
  nodeV: number[] = [];
  strands: number[] = [];
  radius: number[] = [];

  buds: Bud[] = [];
  /** lateral buds sitting on each node (indices into buds) */
  private nodeBuds: number[][] = [];
  markers: MarkerField;
  shadow: ShadowGrid;
  year = 0;
  private retainedThisSeason = 0;
  private retainedAtStart = 0;
  /** last season in which any shoot was produced; foliage is placed relative to it when growth is frozen by the node budget */
  lastShootYear = 0;
  private juvenileCleared = false;
  /** cumulative ms per phase, for tuning */
  profile = { light: 0, occupancy: 0, perceive: 0, allocate: 0, shoots: 0, shed: 0, secondary: 0, sag: 0 };
  private scratch = new Float32Array(3);
  private static now(): number { const p = (globalThis as unknown as { performance?: { now(): number } }).performance; return p ? p.now() : Date.now(); }

  constructor(species: SpeciesParams, seed: number, opts: GrowthOptions = {}) {
    this.sp = species;
    this.rng = new Rng(seed);
    this.opts = { maxNodes: opts.maxNodes ?? 60_000, markerSpacing: opts.markerSpacing ?? 0.85, shadowA: opts.shadowA ?? 0.05, shadowB: opts.shadowB ?? 2.0, shadowDepth: opts.shadowDepth ?? 6, shadowSpread: opts.shadowSpread ?? 0.6, occupancyRefresh: opts.occupancyRefresh ?? 4 };
    this.obstacles = opts.obstacles ?? [];
    if (this.obstacles.length) {
      const c: number[] = [];
      for (const o of this.obstacles) {
        if (o.kind === 'box') c.push(...o.min, ...o.max);
        else c.push(o.center[0] - o.radius, o.center[1] - o.radius, o.center[2] - o.radius, o.center[0] + o.radius, o.center[1] + o.radius, o.center[2] + o.radius);
      }
      this.obstacleCorners = Float32Array.from(c);
    }
    const L = species.internodeLength;
    let pts = generateMarkers(species.crown, L * this.opts.markerSpacing, this.rng.fork(1));
    if (this.obstacles.length) {
      const keep: number[] = [];
      for (let i = 0; i < pts.length; i += 3) if (!this.blocked(pts[i], pts[i + 1], pts[i + 2])) keep.push(pts[i], pts[i + 1], pts[i + 2]);
      pts = Float32Array.from(keep);
    }
    this.markers = new MarkerField(pts, L * species.perceptionDistance * 0.5);
    if (species.curves) { this.markers.lockAll(); this.unlockEnvelope(1); }
    this.shadow = new ShadowGrid(L * 1.0, this.opts.shadowA, this.opts.shadowB, this.opts.shadowDepth, this.opts.shadowSpread);
    // root node at ground
    this.addNode(-1, 0, 0, 0, 0, 1, 0, 0, 1);
    this.buds.push({ node: 0, dx: 0, dy: 1, dz: 0, order: 0, lateral: false, age: 0, phase: 0, alive: true, q: 0, v: 0, light: 1, lastCnt: -1, ox: 0, oy: 1, oz: 0 });
    this.nodeBuds[0].push(0);
  }

  get nodeCount(): number { return this.parent.length; }

  /** Crown envelope the tree is allowed to fill at `age` (mature envelope scaled by the identity curves). */
  envelopeAt(age: number): CrownEnvelope {
    const c = this.sp.curves, env = this.sp.crown;
    if (!c) return env;
    const hM = curveAt(c.ages, c.height, Infinity), wM = curveAt(c.ages, c.width, Infinity);
    const h = curveAt(c.ages, c.height, age), w = curveAt(c.ages, c.width, age);
    // the mature envelope may have been overridden by the user; keep that ratio
    const totalM = env.height + env.baseHeight;
    const hs = hM > 0 ? (h / hM) * totalM : totalM, ws = wM > 0 ? (w / wM) * env.width : env.width;
    const base = env.baseHeight * (hs / Math.max(1e-6, totalM));
    return { shape: env.shape, height: Math.max(0.3, hs - base), width: Math.max(0.3, ws), baseHeight: base };
  }

  private unlockEnvelope(age: number): void {
    const env = this.envelopeAt(age);
    this.markers.unlockWhere((x, y, z) => insideEnvelope(env, x, y, z));
  }

  /** Trunk radius at breast height the identity sheet prescribes for `age`, or undefined without curves. */
  trunkRadiusAt(age: number): number | undefined {
    const c = this.sp.curves;
    if (!c) return undefined;
    const dM = curveAt(c.ages, c.dbh, Infinity);
    const d = curveAt(c.ages, c.dbh, age);
    // user crown-size overrides scale the trunk with the same factor as the height
    const totalM = this.sp.crown.height + this.sp.crown.baseHeight, hM = curveAt(c.ages, c.height, Infinity);
    const k = hM > 0 ? totalM / hM : 1;
    return Math.max(0.002, (d / 2) * k) || (dM / 2) * k;
  }

  /** True if the point is inside any obstacle. */
  blocked(x: number, y: number, z: number): boolean {
    for (const o of this.obstacles) if (insideObstacle(o, x, y, z)) return true;
    return false;
  }

  private addNode(parent: number, x: number, y: number, z: number, dx: number, dy: number, dz: number, order: number, isMain: number): number {
    const i = this.parent.length;
    this.parent.push(parent);
    this.px.push(x); this.py.push(y); this.pz.push(z);
    this.dx.push(dx); this.dy.push(dy); this.dz.push(dz);
    this.birthYear.push(this.year);
    this.order.push(order);
    this.isMain.push(isMain);
    this.alive.push(1);
    this.children.push([]);
    this.mainChild.push(-1);
    this.lowLightYears.push(0);
    this.sag.push(0);
    this.deadYear.push(-1);
    this.nodeQ.push(0); this.nodeLight.push(0); this.nodeV.push(0); this.strands.push(0); this.radius.push(0);
    this.nodeBuds.push([]);
    if (parent >= 0) {
      this.children[parent].push(i);
      if (isMain) this.mainChild[parent] = i;
    }
    return i;
  }

  /** Run `years` growing seasons. */
  grow(years: number): void {
    for (let y = 0; y < years; y++) this.step();
  }

  step(): void {
    const sp = this.sp;
    const n = this.nodeCount;
    if (sp.curves) this.unlockEnvelope(this.year + 1);
    this.retainedThisSeason = this.retainedCount();
    this.retainedAtStart = this.nodeCount;
    // 1. light: shade is cast by foliage, i.e. young shoots and shoot tips, not by bare interior wood
    const foliageAge = sp.leaf.maxShootAge;
    const pos = new Float32Array(n * 3);
    let live = 0;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      if (this.year - this.birthYear[i] > foliageAge && this.mainChild[i] >= 0 && this.alive[this.mainChild[i]]) continue;
      pos[live * 3] = this.px[i]; pos[live * 3 + 1] = this.py[i]; pos[live * 3 + 2] = this.pz[i]; live++;
    }
    let t = TreeGrowth.now();
    this.shadow.rebuild(pos, live, this.obstacleCorners);
    for (const o of this.obstacles) {
      if (o.kind === 'box') this.shadow.addBox(o.min, o.max);
      else this.shadow.addBox([o.center[0] - o.radius, o.center[1] - o.radius, o.center[2] - o.radius], [o.center[0] + o.radius, o.center[1] + o.radius, o.center[2] + o.radius]);
    }
    this.profile.light += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 1a. canopy closure: once the leader is well into the crown, the juvenile zone below the crown base disappears
    if (!this.juvenileCleared) {
      let top = 0;
      for (let i = 0; i < n; i++) if (this.alive[i] && this.order[i] === 0 && this.py[i] > top) top = this.py[i];
      if (top > sp.crown.baseHeight + Math.min(2, sp.crown.height * 0.15)) {
        const base = sp.crown.baseHeight;
        this.markers.removeWhere((_x, y) => y < base);
        this.juvenileCleared = true;
      }
    }

    // 1b. dynamic occupancy: space is free again where branches were shed
    const L = sp.internodeLength;
    const refreshed = this.year > 0 && this.year % this.opts.occupancyRefresh === 0;
    if (refreshed) {
      const occ = sp.occupancyRadius * L;
      const pts = new Float32Array(n * 3);
      let m = 0;
      for (let i = 0; i < n; i++) if (this.alive[i]) { pts[m * 3] = this.px[i]; pts[m * 3 + 1] = this.py[i]; pts[m * 3 + 2] = this.pz[i]; m++; }
      this.markers.recomputeOccupancy(pts, m, occ);
    }

    this.profile.occupancy += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 2. bud perception
    const cosA = Math.cos(sp.perceptionAngle * DEG);
    const dist = sp.perceptionDistance * L;
    const envNow = this.envelopeAt(this.year + 1);
    const crownBase = envNow.baseHeight + envNow.height * 0.1;
    // at the node budget the crown is frozen: only shedding and secondary growth continue
    const anySpace = this.markers.remaining > 0 && this.retainedThisSeason < this.opts.maxNodes;
    for (const b of this.buds) {
      if (!b.alive) continue;
      b.v = 0; // allocation is recomputed every season
      const x = this.px[b.node], y = this.py[b.node], z = this.pz[b.node];
      b.light = this.shadow.lightAt(x, y, z);
      // deeply shaded buds cannot grow whatever the space; skip the expensive cone query.
      // Markers are only consumed between refreshes, so a dormant bud that saw none last year still sees none.
      let cnt: number;
      if (!anySpace || b.light <= 0.05) cnt = 0;
      else if (b.lastCnt === 0 && !refreshed) cnt = 0; // bud has not moved since it last saw nothing
      else { cnt = this.markers.perceive(x, y, z, b.dx, b.dy, b.dz, dist, cosA, this.scratch); b.lastCnt = cnt; }
      let qs: number;
      if (cnt > 0) {
        qs = Math.min(1, cnt / 6);
        const m = 1 / Math.hypot(this.scratch[0], this.scratch[1], this.scratch[2]);
        b.ox = this.scratch[0] * m; b.oy = this.scratch[1] * m; b.oz = this.scratch[2] * m;
      } else {
        // the leader keeps seeking upward until it reaches the crown; everything else needs space
        qs = b.order === 0 && y < crownBase ? 0.6 : 0;
        b.ox = b.dx; b.oy = b.dy; b.oz = b.dz;
      }
      b.q = qs * b.light;
    }

    this.profile.perceive += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 3. accumulate Q toward the root (children always have larger indices)
    for (let i = 0; i < n; i++) { this.nodeQ[i] = 0; this.nodeLight[i] = 0; }
    for (const b of this.buds) if (b.alive) { this.nodeQ[b.node] += b.q; this.nodeLight[b.node] += b.light; }
    for (let i = n - 1; i > 0; i--) if (this.alive[i]) { const p = this.parent[i]; this.nodeQ[p] += this.nodeQ[i]; this.nodeLight[p] += this.nodeLight[i]; }

    // 4. distribute resource v from the root (Borchert–Honda with apical control λ)
    const lambda = sp.apicalControl;
    for (let i = 0; i < n; i++) this.nodeV[i] = 0;
    this.nodeV[0] = sp.resourceScale * this.nodeQ[0];
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const v = this.nodeV[i];
      if (v <= 0) continue;
      const mc = this.mainChild[i];
      let qm = 0;
      let termBud: Bud | null = null;
      if (mc >= 0 && this.alive[mc]) qm = this.nodeQ[mc];
      else {
        // terminal bud lives on a tip node
        for (const bi of this.nodeBuds[i]) { const b = this.buds[bi]; if (b.alive && !b.lateral) { termBud = b; qm = b.q; } }
      }
      let ql = 0;
      for (const c of this.children[i]) if (this.alive[c] && c !== mc) ql += this.nodeQ[c];
      for (const bi of this.nodeBuds[i]) { const b = this.buds[bi]; if (b.alive && b.lateral) ql += b.q; }
      const denom = lambda * qm + (1 - lambda) * ql;
      const vm = denom > 0 ? (v * lambda * qm) / denom : 0;
      const vl = v - vm;
      if (mc >= 0 && this.alive[mc]) this.nodeV[mc] = vm; else if (termBud) termBud.v = vm;
      if (ql > 0) {
        for (const c of this.children[i]) if (this.alive[c] && c !== mc) this.nodeV[c] = (vl * this.nodeQ[c]) / ql;
        for (const bi of this.nodeBuds[i]) { const b = this.buds[bi]; if (b.alive && b.lateral) b.v = (vl * b.q) / ql; }
      }
    }

    this.profile.allocate += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 4b. the leader keeps pace with the growing envelope, but never runs more than a shoot's length
    //     ahead of the foliage (a naked whip above the crown is not how a healthy leader looks)
    if (sp.curves) {
      const envTop = envNow.baseHeight + envNow.height;
      // 95th percentile of live tip heights = where the foliage currently ends
      const ys: number[] = [];
      for (let i = 1; i < n; i++) if (this.alive[i] && this.children[i].length === 0 && this.order[i] > 0) ys.push(this.py[i]);
      ys.sort((a, b) => a - b);
      const foliageTop = ys.length ? ys[Math.floor(ys.length * 0.95)] : 0;
      const target = Math.min(envTop, Math.max(foliageTop, 0) + Math.max(1.0, sp.maxShootLength * 1.5));
      for (const b of this.buds) {
        if (!b.alive || b.lateral || b.order !== 0) continue;
        const y = this.py[b.node];
        if (y < target - 0.3 && b.light > 0.05) {
          const L0 = sp.internodeLength;
          const need = Math.min(Math.floor(sp.maxShootLength / L0), Math.ceil((target - y) / L0));
          if (b.v < need) { b.v = need; if (b.lastCnt === 0) b.lastCnt = -1; }
        }
      }
    }

    // 5. shoot production
    const budCount = this.buds.length; // new buds appended during the loop are not grown this year
    for (let bi = 0; bi < budCount; bi++) {
      const b = this.buds[bi];
      if (!b.alive) continue;
      if (b.v < 1 || this.retainedThisSeason + (this.nodeCount - this.retainedAtStart) >= this.opts.maxNodes) { b.age++; if (b.age > sp.budLifespan && b.lateral) b.alive = false; continue; }
      this.growShoot(b, bi);
    }

    this.profile.shoots += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 6. shedding of under-lit lateral branches
    this.shed();
    this.profile.shed += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 7. secondary growth
    this.secondaryGrowth();
    this.profile.secondary += TreeGrowth.now() - t; t = TreeGrowth.now();

    // 8. branches bend under their own weight
    // settled every few seasons with the accumulated angle: same droop, a third of the traversals
    if (sp.flexibility > 0 && (this.year + 1) % 3 === 0) this.applySag(3);
    this.profile.sag += TreeGrowth.now() - t;

    // 9. compaction: fallen dead wood leaves the arrays so it stops consuming the node budget
    this.compactIfNeeded();
    this.year++;
  }

  private growShoot(b: Bud, bi: number): void {
    const sp = this.sp;
    const rng = this.rng;
    const L0 = sp.internodeLength * Math.max(0.4, 1 - 0.12 * b.order);
    const maxLen = sp.maxShootLength * (b.order > 0 ? sp.lateralShootScale : 1);
    const nMet = Math.max(1, Math.min(Math.floor(b.v), Math.floor(maxLen / L0)));
    const lenScale = Math.min(1.35, Math.sqrt(b.v / nMet));
    const L = Math.min(L0 * lenScale, maxLen / nMet);
    const cosA = Math.cos(sp.perceptionAngle * DEG);
    const dist = sp.perceptionDistance * sp.internodeLength;
    let cur = b.node;
    let pdx = b.dx, pdy = b.dy, pdz = b.dz;
    // the trunk is always orthotropic; weeping (negative gravitropism) only affects laterals and grows with order
    const latGrav = sp.lateralGravitropism ?? sp.gravitropism;
    const grav = b.order === 0 ? Math.max(0.3, sp.gravitropism) : latGrav < 0 ? latGrav * Math.min(1, b.order / 2) : latGrav;
    // detach bud from its node list
    const list = this.nodeBuds[b.node];
    const at = list.indexOf(bi); if (at >= 0) list.splice(at, 1);
    const wasLateral = b.lateral;

    for (let k = 0; k < nMet; k++) {
      if (k > 0) {
        const cnt = this.markers.perceive(this.px[cur], this.py[cur], this.pz[cur], pdx, pdy, pdz, dist, cosA, this.scratch);
        if (cnt > 0) { const m = 1 / Math.hypot(this.scratch[0], this.scratch[1], this.scratch[2]); b.ox = this.scratch[0] * m; b.oy = this.scratch[1] * m; b.oz = this.scratch[2] * m; }
        else if (b.order > 0) break; // ran out of space mid-shoot
      }
      let gx = pdx * sp.directionInertia + b.ox * sp.phototropism + rng.gauss() * sp.noise;
      let gy = pdy * sp.directionInertia + b.oy * sp.phototropism + rng.gauss() * sp.noise + grav;
      let gz = pdz * sp.directionInertia + b.oz * sp.phototropism + rng.gauss() * sp.noise;
      let m = Math.hypot(gx, gy, gz); if (m < 1e-6) { gx = 0; gy = 1; gz = 0; m = 1; }
      gx /= m; gy /= m; gz /= m;
      let nx = this.px[cur] + gx * L, ny = this.py[cur] + gy * L, nz = this.pz[cur] + gz * L;
      if (ny < 0.05) { ny = 0.05; }
      if (this.obstacles.length && this.blocked(nx, ny, nz)) break; // shoot stops at the obstacle surface
      const isMain = wasLateral && k === 0 ? 0 : 1;
      const node = this.addNode(cur, nx, ny, nz, gx, gy, gz, b.order, isMain);
      this.markers.consume(nx, ny, nz, sp.occupancyRadius * sp.internodeLength);

      // lateral buds
      if (b.order + 1 <= sp.maxOrder) {
        const mode = b.order === 0 ? sp.branchingMode : (sp.lateralBranchingMode ?? sp.branchingMode);
        if (mode === 'alternate') {
          const perNode = b.order > 0 ? Math.max(1, Math.round(sp.lateralBudsPerNode ?? 1)) : 1;
          for (let q = 0; q < perNode; q++) {
            if (!rng.chance(sp.lateralBudProbability)) continue;
            if (q === 0) b.phase += sp.phyllotaxis * DEG;
            const kinkIdx = this.addLateralBud(node, gx, gy, gz, b.phase + q * Math.PI, b.order + 1);
            if (q > 0) continue;
            // sympodial tendency: the continuing axis kinks away from the new lateral
            const kb = this.buds[kinkIdx];
            gx -= sp.axisKink * kb.dx; gy -= sp.axisKink * kb.dy; gz -= sp.axisKink * kb.dz;
            const km = Math.hypot(gx, gy, gz) || 1; gx /= km; gy /= km; gz /= km;
          }
        } else if (k === nMet - 1) {
          const cnt = sp.whorlCount;
          const off = rng.next() * Math.PI * 2;
          for (let w = 0; w < cnt; w++) if (rng.chance(sp.lateralBudProbability)) this.addLateralBud(node, gx, gy, gz, off + (w / cnt) * Math.PI * 2, b.order + 1);
        } else if (rng.chance(sp.lateralBudProbability * 0.1)) {
          this.addLateralBud(node, gx, gy, gz, rng.next() * Math.PI * 2, b.order + 1);
        }
      }
      cur = node; pdx = gx; pdy = gy; pdz = gz;
    }
    this.lastShootYear = this.year;
    // bud continues as the terminal bud of the shoot
    b.node = cur; b.dx = pdx; b.dy = pdy; b.dz = pdz; b.lateral = false; b.age = 0; b.lastCnt = -1;
    this.nodeBuds[cur].push(bi);
  }

  private addLateralBud(node: number, ax: number, ay: number, az: number, phase: number, order: number): number {
    const sp = this.sp;
    // build an orthonormal frame around the axis
    let ux: number, uy: number, uz: number;
    if (Math.abs(ay) < 0.9) { ux = -az; uy = 0; uz = ax; } else { ux = 1; uy = 0; uz = 0; }
    // u = normalize(u - (u·a)a)
    const d = ux * ax + uy * ay + uz * az; ux -= d * ax; uy -= d * ay; uz -= d * az;
    const um = Math.hypot(ux, uy, uz); ux /= um; uy /= um; uz /= um;
    const vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    const ang = sp.branchingAngle * DEG + this.rng.gauss() * 6 * DEG;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const cp = Math.cos(phase), spp = Math.sin(phase);
    const bx = ax * ca + (ux * cp + vx * spp) * sa;
    const by = ay * ca + (uy * cp + vy * spp) * sa;
    const bz = az * ca + (uz * cp + vz * spp) * sa;
    const bi = this.buds.length;
    this.buds.push({ node, dx: bx, dy: by, dz: bz, order, lateral: true, age: 0, phase: this.rng.next() * Math.PI * 2, alive: true, q: 0, v: 0, light: 0, lastCnt: -1, ox: bx, oy: by, oz: bz });
    this.nodeBuds[node].push(bi);
    return bi;
  }

  /**
   * Gravitational bending. For every lateral branch root, the subtree's mass moment about the
   * base (Σ segment length × horizontal lever) bends it down by flexibility·M/r² per year, up to
   * sagMax in total. Old, heavy limbs droop; thin young shoots barely move; weeping habits use a
   * high flexibility. Positions, growth directions and bud directions of the subtree rotate rigidly.
   */
  private applySag(years = 1): void {
    const sp = this.sp;
    const n = this.nodeCount;
    // bottom-up subtree sums: weight, weighted x/z, node count
    const W = new Float64Array(n), SX = new Float64Array(n), SZ = new Float64Array(n);
    const C = new Int32Array(n);
    for (let j = n - 1; j >= 1; j--) {
      if (!this.alive[j]) continue;
      const pj = this.parent[j];
      const w = Math.hypot(this.px[j] - this.px[pj], this.py[j] - this.py[pj], this.pz[j] - this.pz[pj]) * (1 + 20 * this.radius[j]);
      W[j] += w; SX[j] += w * this.px[j]; SZ[j] += w * this.pz[j]; C[j] += 1;
      W[pj] += W[j]; SX[pj] += SX[j]; SZ[pj] += SZ[j]; C[pj] += C[j];
    }
    const sub: number[] = [];
    const stack: number[] = [];
    for (let i = 1; i < n; i++) {
      if (!this.alive[i] || this.isMain[i] || this.sag[i] >= sp.sagMax || C[i] < 4) continue;
      const p = this.parent[i];
      const bx = this.px[p], by = this.py[p], bz = this.pz[p];
      // horizontal mass-moment vector about the base
      const mx = SX[i] - W[i] * bx, mz = SZ[i] - W[i] * bz;
      const moment = Math.hypot(mx, mz);
      if (moment < 1e-6) continue;
      const r = Math.max(this.radius[i], 1e-3);
      let theta = (sp.flexibility * moment) / (r * r * r);
      theta = Math.min(theta * years, 0.06 * years, sp.sagMax - this.sag[i]);
      if (theta < 1e-4) continue;
      // axis = horizontal ⟂ to the moment direction, oriented so a positive rotation lowers the branch:
      // rotating (mx,0,mz) about axis (mz,0,-mx)/|m| by +θ gives a negative y component.
      const ax = mz / moment, az = -mx / moment;
      sub.length = 0; stack.length = 0; stack.push(i);
      while (stack.length) { const j = stack.pop()!; if (!this.alive[j]) continue; sub.push(j); for (const c of this.children[j]) stack.push(c); }
      if (this.rotateSubtree(sub, bx, by, bz, ax, az, theta)) this.sag[i] += theta;
    }
  }

  /** Rigidly rotate a subtree about base b around horizontal axis (ax,0,az). Skipped (returns false) if it would enter an obstacle. */
  private rotateSubtree(sub: number[], bx: number, by: number, bz: number, ax: number, az: number, theta: number): boolean {
    const c = Math.cos(theta), s1 = Math.sin(theta), oc = 1 - c;
    const m00 = c + ax * ax * oc, m01 = -az * s1, m02 = ax * az * oc;
    const m10 = az * s1, m11 = c, m12 = -ax * s1;
    const m20 = ax * az * oc, m21 = ax * s1, m22 = c + az * az * oc;
    const tmp = new Float32Array(sub.length * 3);
    for (let k = 0; k < sub.length; k++) {
      const j = sub[k];
      const x = this.px[j] - bx, y = this.py[j] - by, z = this.pz[j] - bz;
      const nx = bx + m00 * x + m01 * y + m02 * z, ny = Math.max(0.1, by + m10 * x + m11 * y + m12 * z), nz = bz + m20 * x + m21 * y + m22 * z;
      if (this.obstacles.length && this.blocked(nx, ny, nz)) return false;
      tmp[k * 3] = nx; tmp[k * 3 + 1] = ny; tmp[k * 3 + 2] = nz;
    }
    for (let k = 0; k < sub.length; k++) {
      const j = sub[k];
      this.px[j] = tmp[k * 3]; this.py[j] = tmp[k * 3 + 1]; this.pz[j] = tmp[k * 3 + 2];
      const dx = this.dx[j], dy = this.dy[j], dz = this.dz[j];
      this.dx[j] = m00 * dx + m01 * dy + m02 * dz; this.dy[j] = m10 * dx + m11 * dy + m12 * dz; this.dz[j] = m20 * dx + m21 * dy + m22 * dz;
      for (const bi of this.nodeBuds[j]) {
        const b = this.buds[bi];
        const ex = b.dx, ey = b.dy, ez = b.dz;
        b.dx = m00 * ex + m01 * ey + m02 * ez; b.dy = m10 * ex + m11 * ey + m12 * ez; b.dz = m20 * ex + m21 * ey + m22 * ez;
      }
    }
    return true;
  }

  private shed(): void {
    const sp = this.sp;
    const n = this.nodeCount;
    // budget pressure: near the node budget, shaded interior twigs are shed more readily (twig turnover)
    const pressure = Math.max(0, Math.min(1, (this.retainedThisSeason - 0.7 * this.opts.maxNodes) / (0.3 * this.opts.maxNodes)));
    const threshold = sp.shedThreshold * (1 + 4 * pressure);
    const years = pressure > 0.5 ? Math.max(1, sp.shedYears - 1) : sp.shedYears;
    // tips per subtree (live)
    const tips = new Int32Array(n);
    for (let i = n - 1; i >= 0; i--) {
      if (!this.alive[i]) continue;
      let hasLiveChild = false;
      for (const c of this.children[i]) if (this.alive[c]) { hasLiveChild = true; break; }
      if (!hasLiveChild) tips[i] = 1;
      if (i > 0) tips[this.parent[i]] += tips[i];
    }
    for (let i = 1; i < n; i++) {
      if (!this.alive[i] || this.isMain[i]) continue; // only whole lateral branches are shed
      if (this.year - this.birthYear[i] < 2) continue;
      const perTip = tips[i] > 0 ? this.nodeLight[i] / tips[i] : 0;
      if (perTip < threshold) this.lowLightYears[i]++; else this.lowLightYears[i] = 0;
      if (this.lowLightYears[i] >= years) this.killSubtree(i);
    }
  }

  private killSubtree(root: number): void {
    const stack = [root];
    while (stack.length) {
      const i = stack.pop()!;
      if (!this.alive[i]) continue;
      this.alive[i] = 0;
      this.deadYear[i] = this.year;
      for (const bi of this.nodeBuds[i]) this.buds[bi].alive = false;
      this.nodeBuds[i].length = 0;
      for (const c of this.children[i]) stack.push(c);
    }
  }

  private secondaryGrowth(): void {
    const sp = this.sp;
    const n = this.nodeCount;
    for (let i = 0; i < n; i++) this.strands[i] = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (!this.alive[i]) continue;
      let hasLiveChild = false;
      for (const c of this.children[i]) if (this.alive[c]) { hasLiveChild = true; break; }
      if (!hasLiveChild) this.strands[i] = 1;
      if (i > 0) this.strands[this.parent[i]] += this.strands[i];
    }
    const inv = 1 / sp.daVinciExponent;
    const rTrunk = this.trunkRadiusAt(this.year + 1);
    if (rTrunk !== undefined && this.strands[0] > 0) {
      // identity-driven: the trunk follows the DBH curve, the pipe model distributes it down the branches
      const rootStrands = this.strands[0];
      for (let i = 0; i < n; i++) {
        if (!this.alive[i]) continue;
        const r = Math.max(sp.tipRadius, rTrunk * Math.pow(this.strands[i] / rootStrands, inv));
        this.radius[i] = Math.max(this.radius[i], r); // wood never shrinks
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const age = this.year + 1 - this.birthYear[i];
      // wood never shrinks: heartwood laid down for tips that were later shed remains
      this.radius[i] = Math.max(this.radius[i], sp.tipRadius * Math.pow(this.strands[i], inv) + sp.radialGrowthPerYear * Math.max(0, age - 1));
    }
  }

  /** Number of nodes that are alive or still retained as dead wood (what the mesh will show). */
  private retainedCount(): number {
    const retain = this.sp.deadBranchYears ?? 0;
    let n = 0;
    for (let i = 0; i < this.parent.length; i++) if (this.alive[i] || (retain > 0 && this.year - this.deadYear[i] < retain)) n++;
    return n;
  }

  /** Drop expired dead nodes from every array, remapping parents, children and buds. */
  private compactIfNeeded(): void {
    const n = this.parent.length;
    if (n < 5000) return;
    const retain = this.sp.deadBranchYears ?? 0;
    const keep = new Uint8Array(n);
    let kept = 0;
    for (let i = 0; i < n; i++) {
      if (this.alive[i]) keep[i] = 1;
      else if (retain > 0 && this.deadYear[i] >= 0 && this.year - this.deadYear[i] < retain) { const p = this.parent[i]; keep[i] = p < 0 || keep[p] ? 1 : 0; }
      kept += keep[i];
    }
    if (n - kept < n * 0.15) return; // not worth it yet
    const remap = new Int32Array(n).fill(-1);
    let j = 0;
    for (let i = 0; i < n; i++) if (keep[i]) remap[i] = j++;
    const pick = <T>(arr: T[]): T[] => { const out: T[] = new Array(kept); for (let i = 0; i < n; i++) if (keep[i]) out[remap[i]] = arr[i]; return out; };
    this.parent = pick(this.parent).map((p) => (p < 0 ? -1 : remap[p]));
    this.px = pick(this.px); this.py = pick(this.py); this.pz = pick(this.pz);
    this.dx = pick(this.dx); this.dy = pick(this.dy); this.dz = pick(this.dz);
    this.birthYear = pick(this.birthYear); this.order = pick(this.order); this.isMain = pick(this.isMain); this.alive = pick(this.alive);
    this.children = pick(this.children).map((list) => list.filter((c) => keep[c]).map((c) => remap[c]));
    this.mainChild = pick(this.mainChild).map((c) => (c >= 0 && keep[c] ? remap[c] : -1));
    this.lowLightYears = pick(this.lowLightYears); this.sag = pick(this.sag); this.deadYear = pick(this.deadYear);
    this.nodeQ = pick(this.nodeQ); this.nodeLight = pick(this.nodeLight); this.nodeV = pick(this.nodeV); this.strands = pick(this.strands); this.radius = pick(this.radius);
    this.nodeBuds = pick(this.nodeBuds);
    // buds on dropped nodes are dead already; remap the live ones and drop dead bud records
    const liveBuds: Bud[] = [];
    const budRemap = new Int32Array(this.buds.length).fill(-1);
    for (let b = 0; b < this.buds.length; b++) {
      const bud = this.buds[b];
      if (!bud.alive || !keep[bud.node]) continue;
      budRemap[b] = liveBuds.length; bud.node = remap[bud.node]; liveBuds.push(bud);
    }
    this.buds = liveBuds;
    for (let i = 0; i < kept; i++) this.nodeBuds[i] = this.nodeBuds[i].map((b) => budRemap[b]).filter((b) => b >= 0);
  }

  /** Pack live nodes into a compact SoA skeleton (parents before children preserved). */
  toSkeleton(): Skeleton {
    const n = this.nodeCount;
    const remap = new Int32Array(n).fill(-1);
    const retain = this.sp.deadBranchYears ?? 0;
    // a dead node is kept only if it died recently and its parent is kept (dead wood falls from the break outward)
    const keep = new Uint8Array(n);
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (this.alive[i]) keep[i] = 1;
      else if (retain > 0 && this.deadYear[i] >= 0 && this.year - this.deadYear[i] < retain) { const p = this.parent[i]; keep[i] = p < 0 || keep[p] ? 1 : 0; }
      if (keep[i]) remap[i] = count++;
    }
    const sk: Skeleton = {
      count,
      parent: new Int32Array(count),
      position: new Float32Array(count * 3),
      birthYear: new Uint16Array(count),
      order: new Uint8Array(count),
      strands: new Uint32Array(count),
      radius: new Float32Array(count),
      isMain: new Uint8Array(count),
      isTip: new Uint8Array(count),
      dead: new Uint8Array(count),
    };
    for (let i = 0; i < n; i++) {
      const j = remap[i]; if (j < 0) continue;
      sk.dead[j] = this.alive[i] ? 0 : 1;
      sk.parent[j] = this.parent[i] < 0 ? -1 : remap[this.parent[i]];
      sk.position[j * 3] = this.px[i]; sk.position[j * 3 + 1] = this.py[i]; sk.position[j * 3 + 2] = this.pz[i];
      sk.birthYear[j] = this.birthYear[i];
      sk.order[j] = this.order[i];
      sk.strands[j] = this.strands[i];
      sk.radius[j] = this.radius[i];
      sk.isMain[j] = this.isMain[i];
      let tip = 1;
      for (const c of this.children[i]) if (keep[c]) { tip = 0; break; }
      sk.isTip[j] = tip;
    }
    return sk;
  }

  /** Utility for tests/tools: is a world point inside the species crown envelope. */
  insideCrown(x: number, y: number, z: number): boolean { return insideEnvelope(this.sp.crown, x, y, z); }
}
