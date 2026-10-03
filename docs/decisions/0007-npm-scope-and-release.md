# 0007 — npm scope `@readletjs` and the release process

Status: accepted · 2026-10-03

## Context

The brief names the packages `@readlet/core`, `@readlet/pdf` and `@readlet/react`. The npm
organisation `readlet` belongs to another account (it has no packages), so the `@readlet` scope
is not available.

## Decision

- The packages are `@readletjs/core`, `@readletjs/pdf` and `@readletjs/react`, in the npm
  organisation `readletjs`. The project name stays "Readlet". `PROJECT_BRIEF.md` and decision
  notes 0001–0002 keep the old names as a historical record.
- A request for the `readlet` name can go to npm support later. A move before 1.0 is acceptable;
  after 1.0 it would be a breaking change for every user.
- Release with Changesets (one fixed version for the three packages) and
  `scripts/release.mjs`: `pnpm pack` (rewrites `workspace:^`, applies `publishConfig`) then
  `npm publish` of the tarball. CI publishes with npm Trusted Publishing and provenance; the first
  version is published locally because Trusted Publishing needs an existing package. Steps in
  `RELEASING.md`.
- The published `exports` do not have the internal `readlet-source` condition (it points to
  `src/`, which is not published); `publishConfig.exports` replaces it at pack time.
- The source maps of the inlined pdf.js worker are not published (2.6 MB that map one string).
