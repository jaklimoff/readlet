import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // tsup sets the deprecated `baseUrl` option for the d.ts build; TypeScript 6 warns about it.
  dts: { compilerOptions: { ignoreDeprecations: "6.0" } },
  splitting: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["pdfjs-dist", "@readlet/core"],
  // The worker source is inlined (decision 0004), although pdfjs-dist is a dependency.
  noExternal: [/\?raw$/],
  esbuildPlugins: [
    {
      // Supports Vite-style `?raw` imports so that src works in Vite and in tsup.
      name: "raw",
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: require.resolve(args.path.slice(0, -4)),
          namespace: "raw",
        }));
        build.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
      },
    },
  ],
});
