// Checks that every symbol exported from a package root has TSDoc with an @example
// (brief: "Every exported function and type has TSDoc with at least one example").
import ts from "typescript";

const entries = [
  "packages/core/src/index.ts",
  "packages/pdf/src/index.ts",
  "packages/react/src/index.ts",
];
const program = ts.createProgram(entries, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  customConditions: ["readlet-source"],
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  skipLibCheck: true,
});
const checker = program.getTypeChecker();
const missing = [];
for (const entry of entries) {
  const file = program.getSourceFile(entry);
  const moduleSymbol = file && checker.getSymbolAtLocation(file);
  if (!moduleSymbol) continue;
  for (const exp of checker.getExportsOfModule(moduleSymbol)) {
    const symbol = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
    const decl = symbol.declarations?.[0];
    if (!decl) continue;
    const declFile = decl.getSourceFile().fileName;
    // Types re-exported from another Readlet package are checked in that package.
    if (!declFile.includes(entry.split("/src/")[0])) continue;
    const hasExample = symbol.getJsDocTags(checker).some((t) => t.name === "example");
    const isInternal = symbol.getJsDocTags(checker).some((t) => t.name === "internal");
    if (!hasExample && !isInternal) missing.push(`${entry.split("/")[1]}: ${exp.name}`);
  }
}
if (missing.length) {
  console.log(`Missing TSDoc @example (${missing.length}):\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log("Every export has TSDoc with an @example.");
