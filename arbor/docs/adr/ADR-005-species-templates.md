# ADR-005: Species are defined as architectural template × genus × measurable identity sheet

- Status: Accepted (2026-09-06)

## Context

The first species files were flat lists of ~45 kernel parameters filled by hand. That does not scale
to a SpeedTree-sized library (hundreds of species), gives no way to tell a wrong number from a taste
choice, and makes "pick a species and adjust" impossible because every species is tuned differently.
The owner's requirement is SpeedTree-like: ready-made per-species templates whose parameters have
recognised references.

Botany and forestry already have the references we need, spread across several sources:

| parameter group | reference |
|---|---|
| branching architecture | Hallé, Oldeman & Tomlinson (1978) architectural models; Barthélémy & Caraglio (2007) |
| overall proportions | Tallo (Jucker et al. 2022; ~500k trees: height, crown radius, DBH by species), GlobAllomeTree (FAO), national yield tables, Pretzsch (2015) urban-tree crown allometry |
| leaf shape vocabulary | Manual of Leaf Architecture (Ellis et al. 2009) |
| leaf and wood traits | TRY, LEDA |
| phenology dates | PEP725 (Europe), USA-NPN |
| bark | no database; field-guide bark classes (smooth, lenticel, furrowed, plated, fibrous, exfoliating, ridged) |

## Decision

Species are composed from three files, resolved at load time by `packages/core/src/species/resolve.ts`:

1. **`species/templates/<model>.json`** — one per Hallé architectural model that the kernel can
   express. Today: Rauh (monopodial, rhythmic, orthotropic tiers), Massart (monopodial, plagiotropic
   whorls), Troll (sympodial, plagiotropic then erect), Champagnat (sympodial, weeping under weight).
   A template fixes the branching-rule parameters (apical control, whorled/alternate, lateral
   gravitropism, shoot-length ratios, kink, flexibility, shedding). Corner (palms), Leeuwenberg,
   Tomlinson (clumping) and Aubréville (pagoda tiers) follow when the kernel supports them.
2. **`species/genera/<genus>.json`** — template choice, leaf family and shape parameters (Manual of
   Leaf Architecture vocabulary), bark family, crown shape and clear-trunk fraction, branching angle,
   and small kernel deltas that characterise the genus (an oak is a Rauh tree that loses apical
   control as an adult).
3. **`species/<id>.json`** — the identity sheet: only measurable numbers with a `sources` list.
   Height, DBH and crown width at two or more reference ages, leaf length/width, budburst, colouring
   and leaf-fall day-of-year at a reference latitude, maximum height, longevity.

The resolver derives kernel numbers from the identity sheet, so the sheet is the source of truth for
everything measurable:

- crown envelope = mature height and width, base = genus clear-trunk fraction × height;
- max shoot length = 1.3 × young-age height increment; internode = shoot / 2.5;
- radial growth per year from the mature DBH (the pipe-model term is assumed to supply about half);
- budburst GDD = growing-degree-days accumulated to the observed budburst day at the reference
  latitude on the kernel's climate curve; colouring and leaf fall map to the senescence and
  abscission calendar.

The identity curves also drive the kernel at run time (`SpeciesParams.curves`):

- the crown envelope is scaled every season to height(age) and width(age); space markers outside
  the current envelope stay locked, so a young tree cannot fill an adult crown;
- the leader is guaranteed to keep pace with the envelope top (height growth has priority);
- the trunk radius follows dbh(age) exactly and the pipe model only distributes it into the branches;
- near the node budget, shaded interior twigs are shed more readily (twig turnover) and expired dead
  wood is compacted out of the arrays, so the crown keeps growing instead of freezing.

First result (12 species, seed 7): DBH matches at every reference age by construction; height is
within 20% for 11 of 12 species at 50 years (oak crown width is 34% narrow, a genus-level tuning
item); before this change heights were 30–60% short and DBH up to 5× too large.

`scripts/validate-species.ts` rejects a sheet without sources or with implausible numbers, and
`pnpm metrics identity` simulates each species to its reference ages and prints the error of height,
crown width and DBH against the sheet. A species is "done" when those errors are inside the tolerance
set in the backlog and it passes the blind evaluation.

## Consequences

- Adding a species is: pick genus (or add one from an existing template), fill the identity sheet
  from the references, run validate + metrics, look at it in four seasons. Target under one hour.
- Realism of proportions becomes a measured quantity per species, independent of taste.
- The first 12 sheets carry literature-typical values, flagged as such in `sources`; replacing them
  with Tallo / PEP725 extracts is backlog item D2 and does not change the format.
- Kernel improvements (carbon budget, canopy light) change how well the simulation meets the sheet,
  not the sheet itself, so calibration work is never thrown away.
