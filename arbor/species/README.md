# Species library

One JSON per species (~45 botanical parameters, see `packages/core/src/types.ts` → `SpeciesParams`).
This file records the identification features each definition is trying to reproduce, so that
parameter changes and blind evaluations have a target. Numbers are the values a mature open-grown
individual should reach in the kernel; the metrics script (`pnpm metrics`) prints what it actually does.

| id | habit / crown | branching | leaf | bark | season |
|---|---|---|---|---|---|
| quercus-robur (English oak) | decurrent, wide spreading dome, wider than tall by 60 y, heavy low limbs | tortuous twigs, wide angles (50–60°), strong self-shading | pinnately lobed, 4–5 rounded lobes per side, short petiole, 8–12 cm | deeply furrowed, grey-brown, ridges vertical | late budburst; brown autumn, leaves held long |
| betula-pendula (silver birch) | narrow crown, upright trunk, fine pendulous twigs | many thin laterals, 35–40° | ovate-triangular, truncate base, acuminate tip, double-serrate, 4–7 cm | white with black horizontal lenticel bands and dark fissured base | early budburst; clear yellow, early drop |
| pinus-sylvestris (Scots pine) | excurrent when young, flattening umbrella crown when old | whorls of 4–6 plagiotropic branches, straight | needles in pairs, 4–7 cm, blue-green | orange-red plates high up, grey-brown fissured low | evergreen, slight winter bronzing |
| acer-platanoides (Norway maple) | dense rounded crown, opposite branching | 40° angles, moderate sag | palmate 5 pointed lobes, few large teeth, 10–15 cm wide | grey, shallow narrow ridges (not plated) | budburst before leaves show flowers; yellow-orange autumn |
| fagus-sylvatica (European beech) | tall dome, very dense shade, smooth long limbs | fine, 35°, two-ranked twigs | ovate, entire wavy margin, 6–10 cm, silky | smooth silver-grey | late budburst; copper-orange autumn, juvenile leaves retained |
| fraxinus-excelsior (European ash) | tall, open, vase-like, upswept branch tips | opposite, coarse, 45° | pinnate 9–13 leaflets, 20–35 cm | grey, becoming closely ridged in a network | very late budburst; leaves fall green-yellow early |
| picea-abies (Norway spruce) | narrow spire, layered pendulous secondaries | whorls of 5–7, drooping branchlets | short needles 1–2.5 cm, dark green, all round the shoot | reddish-brown thin scales | evergreen |
| populus-tremula (aspen) | columnar to rounded, light crown | 40°, upswept | round-ovate, coarse rounded teeth, flattened petiole (trembles), 4–8 cm | smooth grey-green with diamond lenticels | early budburst; bright yellow, early drop |
| salix-babylonica (weeping willow) | broad low dome, long pendulous shoots reaching the ground | strongly weeping laterals, vigorous shoots >1 m/yr | lanceolate 8–16 cm × 1–2 cm, finely serrate | grey-brown, coarsely furrowed | earliest budburst; yellow, latest drop |
| platanus-acerifolia (London plane) | huge spreading crown, massive limbs | 45–50°, coarse | palmate 3–5 shallow lobes, 12–25 cm | exfoliating cream/olive/grey patches | late budburst; brown autumn, leaves held |
| tilia-cordata (small-leaved lime) | dense egg-shaped crown, pendulous lower limbs | 45°, fine, drooping | cordate, acuminate, finely serrate, 3–8 cm | grey, shallow ridges | mid budburst; yellow autumn |
| prunus-avium (wild cherry) | excurrent when young with whorled tiers, egg-shaped | whorls of 3–5, 50–55° | oblong-ovate, coarse serrate, drooping, 6–15 cm | reddish-brown, glossy, horizontal lenticel bands, peeling | early; flowers before/with leaves; red-orange autumn |

## Adding a species

1. Copy the closest JSON, change `id`, `name`, `latinName`.
2. Fill the row above with the identification features you are targeting (crown, branching, leaf, bark, season).
3. Set the crown envelope (mature height/width/base), the leaf family via `leaf.shape` + `leaf.shapeParams`, `bark.family`, and the phenology thresholds.
4. Register it in `packages/core/src/species/index.ts`, run `pnpm metrics ages=12,24,45`, then look at it in the viewer in four seasons.
5. Trunk radius sanity: `tipRadius × sqrt(tips)` should land near the real diameter at that age; if the tree has many fine tips, lower `tipRadius` (1.5–2 mm) rather than the crown size.
