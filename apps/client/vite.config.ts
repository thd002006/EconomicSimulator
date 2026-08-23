import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const clientRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(clientRoot, "../..");
const mapsRoot = resolve(repoRoot, "data-src/maps");

/** Serve committed map packs from data-src/maps at /maps (dev + build). */
function mapAssetsPlugin(): Plugin {
  return {
    name: "economic-simulator-map-assets",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/maps/") && url !== "/maps") {
          next();
          return;
        }
        try {
          const relative = decodeURIComponent(url.replace(/^\/maps\/?/, ""));
          const filePath = resolve(mapsRoot, relative === "" ? "index.json" : relative);
          if (!filePath.startsWith(mapsRoot)) {
            res.statusCode = 403;
            res.end("Forbidden");
            return;
          }
          const { createReadStream, existsSync, statSync } = await import("node:fs");
          if (!existsSync(filePath) || !statSync(filePath).isFile()) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          if (filePath.endsWith(".json")) {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
          }
          createReadStream(filePath).pipe(res);
        } catch (error) {
          next(error);
        }
      });
    },
    async writeBundle(options) {
      const outDir = options.dir ?? resolve(clientRoot, "dist");
      const target = resolve(outDir, "maps");
      await mkdir(target, { recursive: true });
      await cp(mapsRoot, target, { recursive: true });
    }
  };
}

export default defineConfig({
  plugins: [react(), mapAssetsPlugin()],
  clearScreen: false,
  publicDir: resolve(repoRoot, "public"),
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: {
      allow: [repoRoot]
    }
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
