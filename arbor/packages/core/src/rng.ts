/**
 * Deterministic PRNG (sfc32). Same seed => same tree, on every platform.
 * Never use Math.random anywhere in the kernel.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spareGauss: number | null = null;

  constructor(seed: number) {
    // splitmix-style seeding so nearby seeds diverge quickly
    let s = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Uniform in [0, 1). */
  next(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Standard normal via Marsaglia polar method. */
  gauss(): number {
    if (this.spareGauss !== null) {
      const g = this.spareGauss;
      this.spareGauss = null;
      return g;
    }
    let u: number, v: number, s: number;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareGauss = v * m;
    return u * m;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Independent child stream, e.g. one per subsystem, so adding a subsystem never reshuffles others. */
  fork(tag: number): Rng {
    return new Rng((this.next() * 4294967296) ^ Math.imul(tag + 1, 0x9e3779b1));
  }
}

/** Cheap stable hash for per-item jitter (leaf ids etc.). Returns [0,1). */
export function hash01(i: number, salt = 0): number {
  let h = Math.imul(i ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
