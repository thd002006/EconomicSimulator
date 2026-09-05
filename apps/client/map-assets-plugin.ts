import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Plugin } from "vite";

type MapEntry = { id: string; path: string };

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8"
};

async function discoverMaps(mapsRoot: string): Promise<MapEntry[]> {
  const directories = (await readdir(mapsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const entries = await Promise.all(
    directories.map(async (path) => {
      const manifest = JSON.parse(await readFile(join(mapsRoot, path, "map.json"), "utf8")) as {
        id: string;
      };
      return { id: manifest.id, path };
    })
  );
  const byId = new Map<string, MapEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (existing === undefined || (entry.path === entry.id && existing.path !== existing.id)) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Exposes each map's co-located compiled directory without creating a second
 * generated tree. Development requests read it directly; production builds
 * emit the same files into the application's `maps/<id>/` asset directory.
 */
export function mapAssets(mapsRoot: string): Plugin[] {
  return [
    {
      name: "economic-simulator-map-assets-serve",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          try {
            if (request.url === undefined) return next();
            const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
            const match = /^\/maps\/([^/]+)\/([^/]+)$/.exec(pathname);
            if (match === null) return next();

            const mapId = match[1];
            const filename = match[2];
            if (mapId === undefined || filename === undefined) return next();
            const entry = (await discoverMaps(mapsRoot)).find(
              (candidate) => candidate.id === mapId
            );
            if (entry === undefined || filename.includes("..")) return next();

            const content = await readFile(join(mapsRoot, entry.path, "compiled", filename));
            response.statusCode = 200;
            response.setHeader(
              "Content-Type",
              CONTENT_TYPES[extname(filename)] ?? "application/octet-stream"
            );
            response.end(request.method === "HEAD" ? undefined : content);
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "ENOENT") return next();
            next(error);
          }
        });
      }
    },
    {
      name: "economic-simulator-map-assets-build",
      apply: "build",
      async buildStart() {
        for (const entry of await discoverMaps(mapsRoot)) {
          const compiledDir = join(mapsRoot, entry.path, "compiled");
          for (const filename of await readdir(compiledDir)) {
            this.emitFile({
              type: "asset",
              fileName: `maps/${entry.id}/${filename}`,
              source: await readFile(join(compiledDir, filename))
            });
          }
        }
      }
    }
  ];
}
