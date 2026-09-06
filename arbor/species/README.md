# Species library

A species is composed from three files (ADR-005). Nothing here is a kernel parameter list any more;
kernel parameters are resolved at load time by `packages/core/src/species/resolve.ts`.

```
species/
  templates/<model>.json   architectural model (Hallé, Oldeman & Tomlinson 1978): the branching rules
  genera/<genus>.json      template choice, leaf family + shape, bark family, crown shape, branching angle
  <species-id>.json        identity sheet: measurable numbers with sources
```

## Templates (architectural models the kernel can express today)

| template | model | habit | genera using it |
|---|---|---|---|
| `rauh` | Rauh | monopodial trunk, rhythmic growth, orthotropic lateral tiers; many genera become decurrent as adults | Quercus, Betula, Pinus, Acer, Fraxinus, Populus, Platanus, Prunus |
| `massart` | Massart | monopodial trunk, plagiotropic whorled branches | Picea |
| `troll` | Troll | sympodial, axes plagiotropic then erect | Fagus, Tilia |
| `champagnat` | Champagnat | sympodial, axes bend under their own weight | Salix |

Planned: `corner` (unbranched palms), `leeuwenberg` (modular, terminal flowering), `tomlinson`
(basal clumping: bamboo, banana), `aubreville` (pagoda tiers).

## Identity sheet fields and where the numbers come from

| field | unit | reference |
|---|---|---|
| `heightAt`, `dbhAt`, `crownWidthAt` at ≥ 2 reference ages | m, cm, m | Tallo (Jucker et al. 2022), GlobAllomeTree, national yield tables, Pretzsch 2015 (urban crowns) |
| `maxHeight`, `longevity` | m, years | floras and field guides |
| `leaf.length`, `leaf.width` | m | TRY / LEDA, floras |
| `phenology.budburstDOY`, `colouringDOY`, `leafFallDOY`, `referenceLatitude` | day of year, deg | PEP725 (Europe), USA-NPN |
| `sources` | text | mandatory; the validator rejects a sheet without it |

Leaf shape vocabulary in `genera/*.json` (`shapeParams`: base, apex, margin serration, lobes,
leaflets) follows the Manual of Leaf Architecture (Ellis et al. 2009). Bark families follow the
usual field-guide classes.

The current 12 sheets carry literature-typical values for open-grown temperate trees at ~50°N and
say so in `sources`. Replacing them with database extracts is backlog item D2; the format does not change.

## Workflow for a new species

1. Find the genus in `genera/`; if missing, copy the closest genus, set its `template`, leaf family,
   bark family, crown shape and clear-trunk fraction.
2. Write `<id>.json` with `genus` and the identity sheet (numbers + sources).
3. `python3 packages/core/scripts/gen-species-registry.py` to register it.
4. `pnpm validate` (structure and ranges), `pnpm metrics identity` (height, crown width and DBH
   error against the sheet at each reference age), then look at it in four seasons in the viewer
   or on the contact sheet.
5. If proportions are off, fix the sheet only if the reference was wrong; otherwise the fix belongs
   in the genus deltas or the kernel, never in per-species magic numbers. `overrides` exists for the
   rare exception and should stay small.

## Identification features per species

| id | crown | branching | leaf | bark | season |
|---|---|---|---|---|---|
| quercus-robur | wide spreading dome, heavy low limbs | tortuous twigs, 50–60° | pinnately lobed, 4–5 rounded lobes per side | deeply furrowed grey-brown | late budburst; brown autumn, held long |
| betula-pendula | narrow, fine pendulous twigs | many thin laterals, 35–40° | ovate-triangular, double-serrate | white with black lenticel bands | early; clear yellow, early drop |
| pinus-sylvestris | excurrent young, umbrella old | whorls of 4–6 plagiotropic branches | paired needles 4–7 cm | orange plates above, grey fissured below | evergreen |
| acer-platanoides | dense rounded, opposite | 40°, moderate sag | palmate 5 pointed lobes | grey shallow ridges | yellow-orange autumn |
| fagus-sylvatica | tall dome, dense shade | fine two-ranked twigs, 35° | ovate, entire wavy margin | smooth silver-grey | late; copper autumn |
| fraxinus-excelsior | open vase, upswept tips | opposite, coarse, 45° | pinnate 9–13 leaflets | grey, closely ridged | very late; falls green-yellow |
| picea-abies | narrow spire, pendulous secondaries | whorls of 5–7 | short needles all round the shoot | reddish thin scales | evergreen |
| populus-tremula | columnar to rounded, light | 40°, upswept | round, coarse rounded teeth | smooth grey-green | early; bright yellow |
| salix-babylonica | broad low dome, shoots to the ground | strongly weeping | lanceolate 8–16 cm | grey-brown furrowed | earliest; latest drop |
| platanus-acerifolia | huge spreading crown | 45–50°, coarse | palmate 3–5 shallow lobes | exfoliating cream/olive | late; brown, held |
| tilia-cordata | dense egg shape, pendulous low limbs | 45°, fine | cordate, acuminate, finely serrate | grey shallow ridges | yellow autumn |
| prunus-avium | egg shape, whorled tiers when young | whorls of 3–5, 50–55° | oblong-ovate, coarse serrate | glossy red-brown, lenticel bands | early; flowers with leaves; red autumn |
