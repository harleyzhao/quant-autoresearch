/**
 * Core data model. See docs/plant-gen/02 §2 (PlantGraph).
 * Species = biology of a kind of plant. Individual = one plant at one moment.
 * All lengths in meters, angles in degrees at the API boundary.
 */

export type CrownShape = 'ellipsoid' | 'sphere' | 'cone' | 'column' | 'spreading' | 'vase';
export type LeafShape = 'ovate' | 'lanceolate' | 'lobed' | 'palmate' | 'pinnate' | 'needle';
export type BarkFamily = 'smooth' | 'lenticel' | 'furrowed' | 'plated' | 'fibrous' | 'exfoliating' | 'ridged';
export type AutumnPigment = 'yellow' | 'orange' | 'red' | 'brown' | 'none';

export interface CrownEnvelope {
  shape: CrownShape;
  /** Total height of the mature crown envelope (m), measured from baseHeight. */
  height: number;
  /** Max width of the mature crown envelope (m). */
  width: number;
  /** Height below which no growth markers exist (clear trunk), m. */
  baseHeight: number;
}

export interface LeafParams {
  shape: LeafShape;
  length: number;
  width: number;
  /** Leaves per node on young shoots. */
  perNode: number;
  /** Leaves only on shoots at most this many years old. */
  maxShootAge: number;
  /** Leaves only on branches thinner than this radius (m). */
  maxBranchRadius: number;
  /** Summer color, linear RGB 0..1. */
  color: [number, number, number];
  autumnPigment: AutumnPigment;
  /** Overrides for the procedural silhouette (see organs/leafShape.ts); family is derived from `shape`. */
  shapeParams?: Partial<import('./organs/leafShape.js').LeafShapeParams>;
}

export interface PhenologyParams {
  /** Growing-degree-days (base 5°C) needed for budburst. */
  budburstGDD: number;
  /** Days from budburst to full leaf expansion. */
  leafExpandDays: number;
  /** Day of year when senescence starts (photoperiod proxy). */
  senescenceDay: number;
  /** Days from senescence start to full colour. */
  senescenceDays: number;
  /** Day of year when abscission (leaf drop) begins. */
  abscissionDay: number;
  /** Days over which the canopy drops. */
  abscissionDays: number;
  evergreen: boolean;
}

export interface BarkParams {
  color: [number, number, number];
  roughness: number;
  /** Procedural bark texture family (docs/plant-gen/04 §3.2). */
  family?: BarkFamily;
  /** Texture repeats per meter along the trunk. */
  scale?: number;
  /** Colour of young twigs (linear RGB); bark texture fades in above `twigRadius`. Defaults to a darker trunk colour. */
  twigColor?: [number, number, number];
  /** Radius (m) below which a branch is rendered as twig; the blend completes at 3× this radius. */
  twigRadius?: number;
}

export interface SpeciesParams {
  id: string;
  name: string;
  latinName?: string;
  habit: 'broadleaf' | 'conifer';

  // --- primary growth (self-organizing model, Pałubicki et al. 2009) ---
  /** λ ∈ [0,1]. Share of resource routed to the main axis vs laterals. >0.5 = strong apical control (excurrent), <0.5 = decurrent. */
  apicalControl: number;
  /** α. Metamers produced per unit of light captured at the root. Governs vigour. */
  resourceScale: number;
  /** Base internode (metamer) length in meters. */
  internodeLength: number;
  /** Physiological cap on the length one bud can extend in a season (m). */
  maxShootLength: number;
  /** Half-angle of the bud perception cone (deg). */
  perceptionAngle: number;
  /** Perception distance in internode lengths. */
  perceptionDistance: number;
  /** Radius (in internode lengths) within which a node consumes space markers. */
  occupancyRadius: number;
  /** Angle between a lateral bud and its parent axis (deg). */
  branchingAngle: number;
  /** Divergence angle between successive lateral buds (deg). 137.5 = Fibonacci spiral. */
  phyllotaxis: number;
  /** 'alternate' = one lateral bud per metamer; 'whorled' = whorlCount buds at each shoot end (conifers). */
  branchingMode: 'alternate' | 'whorled';
  /** Branching mode of lateral axes (order ≥ 1); conifers are whorled on the trunk but pinnate on the branches. Defaults to branchingMode. */
  lateralBranchingMode?: 'alternate' | 'whorled';
  whorlCount: number;
  /** Probability a metamer bears a lateral bud. */
  lateralBudProbability: number;
  /** Years a dormant bud stays viable. */
  budLifespan: number;
  /** Weight of the previous growth direction. */
  directionInertia: number;
  /** Weight toward available space/light (markers). */
  phototropism: number;
  /** Weight toward +Y (negative for weeping habits). */
  gravitropism: number;
  /** Gravitropism used by lateral (order ≥ 1) shoots; conifers are plagiotropic (~0). Defaults to gravitropism. */
  lateralGravitropism?: number;
  /** Max shoot length of laterals relative to the leader (0..1). */
  lateralShootScale: number;
  /** How far the continuing axis kinks away from each new lateral bud (0 = none, 0.15 = typical). */
  axisKink: number;
  /** Bending of lateral branches under their own weight: yearly angle = flexibility · moment / r³ (EI-like stiffness). 0 disables. */
  flexibility: number;
  /** Cumulative sag cap per branch (rad). */
  sagMax: number;
  /** Random perturbation weight. */
  noise: number;
  /** Deepest branching order allowed to spawn laterals. */
  maxOrder: number;

  // --- shedding ---
  /** Branches whose mean light per tip falls below this for shedYears consecutive years are shed. */
  shedThreshold: number;
  shedYears: number;
  /** Years a shed branch stays on the tree as dead wood before it falls (0 = removed immediately). */
  deadBranchYears?: number;

  // --- secondary growth (pipe model) ---
  /** n in r_parent^n = Σ r_child^n. Leonardo's rule = 2. */
  daVinciExponent: number;
  /** Radius of a single terminal pipe (one strand), m. */
  tipRadius: number;
  /** Extra radial growth per year of a node's age, m (cambium keeps working on old wood). */
  radialGrowthPerYear: number;

  crown: CrownEnvelope;
  leaf: LeafParams;
  phenology: PhenologyParams;
  bark: BarkParams;
  /**
   * Growth curves from the species identity sheet (ADR-005). When present, the crown envelope is
   * scaled to height(age)/width(age) each season and the trunk radius follows dbh(age); the pipe
   * model then only distributes radius to the branches. Ages ascending, values in metres.
   */
  curves?: GrowthCurves;
}

export interface GrowthCurves {
  ages: number[];
  height: number[];
  width: number[];
  /** trunk diameter at breast height, metres */
  dbh: number[];
}

/** Piecewise-linear lookup with (0,0) implied and a flat tail after the last age. */
export function curveAt(ages: number[], values: number[], age: number): number {
  if (ages.length === 0) return 0;
  if (age <= 0) return 0;
  let prevA = 0, prevV = 0;
  for (let i = 0; i < ages.length; i++) {
    if (age <= ages[i]) return prevV + ((values[i] - prevV) * (age - prevA)) / Math.max(1e-6, ages[i] - prevA);
    prevA = ages[i]; prevV = values[i];
  }
  return prevV;
}

/** Axis-aligned obstacle in world space (meters). Markers inside are removed, shoots cannot enter, and it casts shade. */
export type Obstacle =
  | { kind: 'box'; min: [number, number, number]; max: [number, number, number] }
  | { kind: 'sphere'; center: [number, number, number]; radius: number };

export interface IndividualParams {
  seed: number;
  /** Age in years. Growth is simulated one year per step. */
  ageYears: number;
  /** Day of year 1..365 used for phenology (leaf state, colour). */
  dayOfYear: number;
  /** Latitude in degrees; drives the climate curve. Negative = southern hemisphere. */
  latitude: number;
  /** 0..1, scales vigour. */
  health: number;
  /** Optional overrides applied on top of the species. */
  overrides?: Partial<SpeciesParams> & { crown?: Partial<CrownEnvelope> };
  /** Environment: walls, buildings, neighbouring crowns. */
  obstacles?: Obstacle[];
}

/** Structure-of-arrays skeleton. Node 0 is the root (ground). Parents always precede children. */
export interface Skeleton {
  count: number;
  parent: Int32Array; // -1 for root
  position: Float32Array; // xyz
  /** Year (0-based) the node was created. */
  birthYear: Uint16Array;
  /** Branching order: 0 = trunk. */
  order: Uint8Array;
  /** Number of terminal pipes (live tips) supported by this node. */
  strands: Uint32Array;
  radius: Float32Array;
  /** 1 if this node is the continuation (main child) of its parent, 0 if it starts a lateral branch. */
  isMain: Uint8Array;
  /** 1 if node has no children. */
  isTip: Uint8Array;
  /** 1 for retained dead wood: no leaves, no growth, radius frozen. */
  dead: Uint8Array;
}

export interface BranchMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint32Array;
  /** Branch radius (m) at each vertex; lets renderers blend twig and trunk bark. */
  radius: Float32Array;
}

/** Per-leaf instance data. Quaternion as xyzw. */
export interface LeafInstances {
  count: number;
  position: Float32Array; // n*3
  quaternion: Float32Array; // n*4
  scale: Float32Array; // n (uniform, 0 when dropped)
  color: Float32Array; // n*3 linear RGB
  /** [expansion, chlorophyll, carotenoid, anthocyanin] per leaf. */
  pigment: Float32Array; // n*4
  /** Parent skeleton node per leaf (for wind hierarchy). */
  node: Uint32Array;
  /** Leaves represented by one instance: 1 = a single leaf card, >1 = a baked cluster (spray) of that many leaves. */
  leavesPerInstance: number;
}

export interface PhenologyState {
  /** 0..1 fraction of leaves currently expanded (before drop). */
  expansion: number;
  chlorophyll: number;
  carotenoid: number;
  anthocyanin: number;
  browning: number;
  /** 0..1 fraction of the canopy that has been shed. */
  shed: number;
  stage: 'dormant' | 'budburst' | 'expanding' | 'mature' | 'senescing' | 'shedding';
  gdd: number;
}

export interface PlantStats {
  nodes: number;
  tips: number;
  leaves: number;
  height: number;
  crownWidth: number;
  trunkRadius: number;
  /** Mean over internal nodes of (Σ r_child^n) / r_parent^n; ≈1 means pipe model holds. */
  pipeModelRatio: number;
  growthMs: number;
  meshMs: number;
}

export interface PlantModel {
  species: SpeciesParams;
  individual: IndividualParams;
  skeleton: Skeleton;
  branches: BranchMesh;
  leaves: LeafInstances;
  phenology: PhenologyState;
  stats: PlantStats;
}
