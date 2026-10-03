import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Use the workspace packages from source (see the "readlet-source" export condition).
  resolve: { conditions: ["readlet-source"] },
  // Fixture PDFs are served at the root, for example /single-column.pdf.
  publicDir: "../../fixtures",
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
