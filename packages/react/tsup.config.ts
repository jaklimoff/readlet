import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // tsup sets the deprecated `baseUrl` option for the d.ts build; TypeScript 6 warns about it.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react", "react-dom", "@readletjs/core"],
});
