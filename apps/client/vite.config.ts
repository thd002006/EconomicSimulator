import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mapAssets } from "./map-assets-plugin.js";

const clientRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(clientRoot, "../..");

export default defineConfig({
  base: "./",
  plugins: [react(), mapAssets(resolve(repoRoot, "assets/maps"))],
  clearScreen: false,
  publicDir: false,
  server: {
    host: true,
    port: 1420,
    strictPort: true,
    fs: { allow: [repoRoot] }
  },
  build: { target: "es2022", sourcemap: true }
});
