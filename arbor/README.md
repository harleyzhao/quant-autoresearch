# Arbor

Growth-based procedural plant generator for film and games. Web-first (three.js / WebGPU), exports to
glTF today and to USD / engine sidecars later. See the project documents in `../docs/plant-gen/`:

- `00-立项书.md` — project charter (goals, milestones, team, risks)
- `01-调研-SpeedTree与学术前沿.md` — research: SpeedTree 10, competitors, 2009–2025 papers
- `02-方案-超越SpeedTree的Web端植物生成器.md` — technical plan
- `docs/adr/` — architecture decision records

## Layout

```
arbor/
  packages/core   @arbor/core  pure TypeScript growth kernel (no DOM): growth, phenology, meshing, species
  packages/web    @arbor/web   Vite + three.js viewer, Worker-hosted generation, Tweakpane UI, glTF export
  species/        species definitions (JSON, ~40 botanical parameters each)
  docs/adr/       decisions
```

## Quick start

```bash
cd arbor
pnpm install
pnpm dev          # viewer at http://localhost:5173
pnpm test         # kernel tests (vitest)
pnpm typecheck
pnpm build
pnpm smoke        # headless render of three reference trees -> packages/web/smoke-out/*.png
```

Share a tree by URL, e.g. `#species=quercus-robur&seed=7&age=30&day=290` (autumn oak).

## Kernel in one paragraph

One `step()` is one growing season. Foliage-bearing nodes cast shadow into a voxel grid; each bud
perceives free space markers inside the crown envelope within a cone and reads its light; bud quality
`Q = light × space` is summed to the root and resource `v = α·ΣQ` flows back down with apical control
λ (Borchert–Honda). A bud with `v ≥ 1` produces `⌊v⌋` metamers, capped by a physiological max shoot
length, steering by inertia + phototropism + gravitropism + noise, leaving lateral buds by
phyllotaxis or whorls. Lateral branches whose mean light per tip stays below a threshold for several
years are shed; freed space is recolonised. Radii follow the pipe model (`r ∝ strands^(1/n)`) plus
annual radial growth and never shrink. Phenology is separate: growing-degree-days drive budburst,
calendar days drive senescence and abscission, and each leaf mixes chlorophyll / carotenoid /
anthocyanin / browning with per-leaf and exposure jitter.

See `packages/core/src/growth/grow.ts` and ADR-003 for the deviations from Pałubicki et al. 2009.

## Status

P0 (technical validation). Done on day 1: kernel, four species (oak, birch, pine, maple), 19 tests, viewer, export, smoke test,
CI. Known day-1 issues are listed in `../docs/plant-gen/00-立项书.md` §8 (pine branch habit, whippy twigs, 1–2 s generation). Not yet: strand-based junctions, procedural bark/leaf materials, wind, LOD/impostors, USD.
Roadmap in the plan document §14.
