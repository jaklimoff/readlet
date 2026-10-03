import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { defineConfig } from "tsup";

const require = createRequire(import.meta.url);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["pdfjs-dist", "@readlet/core"],
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
