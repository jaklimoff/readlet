// Checks the gzipped size of the published entry points against the budgets in the brief.
// pdf.js (and the inlined worker chunk) is outside the budget.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgets = [
  { file: "packages/core/dist/index.js", maxKB: 60 },
  { file: "packages/react/dist/index.js", maxKB: 10 },
  { file: "packages/pdf/dist/index.js", maxKB: 10 },
];

let failed = false;
for (const { file, maxKB } of budgets) {
  const kb = gzipSync(readFileSync(file), { level: 9 }).length / 1024;
  const ok = kb <= maxKB;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${kb.toFixed(1)} KB gz (budget ${maxKB} KB)`);
}
process.exit(failed ? 1 : 0);
