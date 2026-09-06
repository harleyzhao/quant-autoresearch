# ADR-002: TypeScript growth kernel for P0, Rust/WASM port gated by a performance threshold

- Status: Accepted (2026-09-06)

## Context

The plan (docs/plant-gen/02 §11) calls for a Rust → WASM growth kernel. The toolchain was verified
in the kick-off environment: `cargo 1.94`, target `wasm32-unknown-unknown`, a crates.io dependency
(`glam`) compiled to a `.wasm` in 12 s. So Rust is available, but P0's job is to find the *right
algorithm*, and that means dozens of parameter/structure iterations per day against the viewer.

Measured on the first TS kernel (single thread, Node 22), 60 simulated years:

| species | nodes at year 30 | total time | dominant phase |
|---|---|---|---|
| Quercus robur | 59k (budget cap) | 11.0 s | marker perception 5.8 s, occupancy 2.7 s |
| Betula pendula | 60k (budget cap) | 13.3 s | perception 7.9 s |
| Pinus sylvestris | 16k | 3.9 s | perception 2.1 s |

At the default viewer age (25 years) generation is 0.7–3 s inside a Worker, which is acceptable for
P0 but not for the "< 200 ms incremental regrow" target in the plan.

Update after the first algorithmic pass (same machine, 60 simulated years, 60k node budget):

| species | total before | total after | what changed |
|---|---|---|---|
| Quercus robur | 11.0 s | 2.7 s | dense-grid marker field (no Map lookups), marker-centric occupancy refresh, perception skipped for buds that have not moved since they last saw no free space, sag settled every 3 seasons |
| Betula pendula | 13.3 s | 2.5 s | same |
| Pinus sylvestris | 3.9 s | 2.9 s | same; cone perception of ~6k live tips during years 5–20 is now the dominant cost |

Incremental use (the viewer's normal case) is already inside the target: `PlantSession.growTo(age+1)`
costs one season (30–150 ms at 20–60k nodes) and a day-of-year change rebuilds only leaves.

## Decision

1. P0 kernel stays in TypeScript (`packages/core`), pure and DOM-free, so it runs in Node tests,
   Web Workers and later on a server unchanged.
2. Algorithmic optimisations come first (they carry over to Rust): light-gated perception (done),
   per-year caching, incremental occupancy, dormant-bud pruning, chain simplification before meshing.
3. **Gate for the Rust port**: if, after algorithmic work, a 25-year oak still takes > 1 s or a
   1-year incremental regrow > 200 ms on a 2023 laptop, the port starts at the beginning of P1.
   The TS kernel then becomes the reference implementation for cross-checking determinism.
4. The data model (`Skeleton` SoA typed arrays) is already WASM-friendly: a port changes the
   producer, not the consumers.

## Consequences

- Fast iteration now; a known, measured decision point instead of a speculative rewrite.
- Two implementations may coexist for a while; the test suite must run against both.
