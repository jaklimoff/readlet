#!/usr/bin/env node
// Publishes the packages whose current version is not on npm yet. Run after `pnpm build`
// (`pnpm release` does both).
//
// Each package is packed with `pnpm pack` (which turns `workspace:^` into real version ranges and
// applies `publishConfig`) and the tarball is published with `npm publish`.
//
// - Locally: you must be logged in (`npm login`); npm asks for your 2FA code. Use this for the
//   first release, because npm Trusted Publishing can only be set up for packages that exist.
// - In GitHub Actions (CI=true): npm uses Trusted Publishing (OIDC, no token) and adds
//   provenance. A package that does not exist on npm yet is skipped with a warning.
//
//   node scripts/release.mjs [--dry-run]

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Dependencies first: pdf and react depend on core.
const PACKAGES = ["core", "pdf", "react"];
const OUT = join(ROOT, ".release");
const dryRun = process.argv.includes("--dry-run");
const ci = process.env.CI === "true";

/** The versions of `name` on npm, or `null` when the package does not exist. */
function publishedVersions(name) {
  try {
    const out = execFileSync("npm", ["view", name, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    if (String(error.stderr ?? "").includes("E404")) return null;
    throw error;
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
let published = 0;
for (const dir of PACKAGES) {
  const pkgDir = join(ROOT, "packages", dir);
  const { name, version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const versions = publishedVersions(name);
  if (versions?.includes(version)) {
    console.log(`skip     ${name}@${version}: already on npm`);
    continue;
  }
  if (versions === null && ci) {
    console.warn(
      `::warning::${name} does not exist on npm yet. Publish the first version locally with ` +
        "`pnpm release`, then set up Trusted Publishing for it (see RELEASING.md).",
    );
    continue;
  }
  const tarball = execFileSync("pnpm", ["pack", "--pack-destination", OUT], {
    cwd: pkgDir,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .pop();
  const args = ["publish", tarball, "--access", "public"];
  if (ci) args.push("--provenance");
  if (dryRun) args.push("--dry-run");
  console.log(`publish  ${name}@${version}${dryRun ? " (dry run)" : ""}`);
  execFileSync("npm", args, { stdio: "inherit" });
  published++;
}
console.log(`${published} package(s) ${dryRun ? "would be " : ""}published.`);
