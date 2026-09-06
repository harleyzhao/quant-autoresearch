# ADR-001: Arbor lives in `arbor/` inside this repository for P0

- Status: Accepted (2026-09-06)
- Deciders: project owner, kernel lead

## Context

The kick-off was requested inside `harleyzhao/quant-autoresearch`, a quant research repository. The
GitHub access granted to the kick-off session is scoped to this repository only, so a separate
repository could not be created from here. Arbor has nothing in common with the quant code.

## Decision

Arbor is a self-contained pnpm workspace under `arbor/` with its own lockfile, tooling and CI
workflow (`arbor/.github/workflows/ci.yml` is a template; GitHub only runs workflows from the repo
root `.github/workflows`, so a copy is placed there with `paths: [arbor/**]`).

At milestone M1 (end of P0) the directory is split into its own repository with full history:

```
git subtree split -P arbor -b arbor-main
# then push arbor-main to the new repository as main
```

Until then, nothing in `arbor/` may import from or depend on anything outside `arbor/`.

## Consequences

- Zero friction to start; history preserved on split.
- Root-level tooling of the quant project (Python, requirements) is not touched.
- Contributors must remember the "no imports across the boundary" rule; CI enforces it by
  building `arbor/` in isolation.
