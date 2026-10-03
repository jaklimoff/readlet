# Releasing

Readlet publishes three packages to npm under the `@readletjs` organisation: `@readletjs/core`,
`@readletjs/pdf` and `@readletjs/react`. They always have the same version (Changesets `fixed`
group).

## Every release

1. A pull request that changes a package adds a changeset: run `pnpm changeset`, choose the
   packages and the bump (patch, minor or major), and write one or two lines for the changelog.
2. When changesets reach `main`, the **Release** workflow opens or updates a pull request named
   "chore: version packages". It shows the new versions and the changelog.
3. Merge that pull request to release. The workflow then runs `pnpm release`
   (`scripts/release.mjs`), which publishes every package whose version is not on npm yet, with
   npm Trusted Publishing and provenance. No npm token is stored anywhere.

`node scripts/release.mjs --dry-run` (after `pnpm build`) shows what would be published.

## First release (one time)

npm Trusted Publishing can only be set up for a package that exists. So the first version is
published from a maintainer's machine:

1. Merge the first "chore: version packages" pull request. The workflow skips the packages that
   do not exist on npm yet, with a warning.
2. Locally: `git pull`, `npm login` (an owner of the `readletjs` npm organisation), then
   `pnpm release`. npm asks for the 2FA code for each package.
3. For each of the three packages on npmjs.com: **Settings → Trusted Publisher → GitHub
   Actions**: organisation or user `jaklimoff`, repository `readlet`, workflow filename
   `release.yml`, environment empty. Save.
4. Recommended, also in each package's settings: **Publishing access → Require two-factor
   authentication and disallow tokens**. Trusted Publishing still works.

From then on, releases need only step 3 of "Every release".

## Repository settings that the workflow needs

- Settings → Actions → General → Workflow permissions: **Allow GitHub Actions to create and
  approve pull requests** (Changesets opens the version pull request).
