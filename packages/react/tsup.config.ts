import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // tsup sets the deprecated `baseUrl` option for the d.ts build; TypeScript 6 warns about it.
  // `stripInternal` keeps members marked `@internal` out of the published types.
  dts: { compilerOptions: { ignoreDeprecations: "6.0", stripInternal: true } },
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["react", "react-dom", "@readletjs/core"],
});
