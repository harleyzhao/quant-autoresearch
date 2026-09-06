# ADR-003: Self-organizing growth (Pałubicki 2009) as the structural core; strands and neural priors layered on later

- Status: Accepted (2026-09-06)

## Context

Three families of tree-structure generators were evaluated in the research report
(docs/plant-gen/01 §3.1):

1. Parametric hierarchies (Weber–Penn 1995; SpeedTree, EZ-Tree, SeedThree). Fast, directly
   controllable, botanically shallow; realism depends on per-species curve tuning.
2. Self-organizing growth (Pałubicki et al. 2009; The Grove, Natsura). Form emerges from bud
   competition for light/space, apical control and resource allocation. Few parameters, all with
   botanical meaning; naturally yields age series, shading response, envelope/obstacle control.
3. Learned generators (Latent L-systems 2023, Autoregressive Trees 2025, Tree-D Fusion 2024).
   Excellent for image/point-cloud/sketch conditioning and fast drafts; need training data and give
   less direct control; leaves still added procedurally.

## Decision

- The kernel simulates one season per step with: shadow-propagation light, cone-perception of
  space markers inside a crown envelope, Borchert–Honda allocation with apical control λ, shoot
  production capped by a physiological max shoot length, light-driven shedding of lateral branches,
  pipe-model secondary growth with monotonic radii.
- Implementation choices that deviate from the paper, with reasons:
  - Shade is cast only by foliage-bearing nodes (young shoots and tips), not by bare wood, and the
    shadow pyramid is narrower than 45° (`shadowSpread` 0.6). With full-node 45° casting, open-grown
    crowns lost their sides and became top-heavy poles.
  - Marker occupancy is dynamic (recomputed every `occupancyRefresh` years) so space vacated by shed
    branches is recolonised, giving stable tip counts in mature crowns instead of collapse.
  - The trunk is always orthotropic; negative gravitropism (weeping) applies to laterals only and
    scales with order.
  - A node budget (`maxNodes`) freezes primary growth when reached; the tree keeps thickening.
  - Two mechanisms the paper does not have, added after the first renders came out as upright
    "brooms": (a) gravitational sag, a yearly rigid rotation of every lateral branch about its base by
    `flexibility · moment / r³`, capped by `sagMax`, so heavy old limbs droop and thin twigs do not;
    (b) an axis kink, the continuing shoot deflecting away from each new lateral bud (`axisKink`),
    which breaks up long straight twigs. Both are species parameters.
  - Lateral shoots are capped at `lateralShootScale` × the leader's max shoot length, and conifers use
    a separate near-zero `lateralGravitropism` (plagiotropic branches).
- Neural priors and image-to-parameter fitting (plan §3.2) are P2 and will *produce parameters or
  envelopes for this kernel*, not replace it.
- The strand-based volumetric model (plan §4) is P1 and consumes the same skeleton: strand counts per
  node are already tracked (`Skeleton.strands`).

## Consequences

- Every user-facing shape control must be expressible as an influence on the growth field
  (envelope, markers, light, allocation), never as post-hoc geometry edits.
- Species files are ~40 botanical parameters; artists tune those, not curves.
