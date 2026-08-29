import type { Plugin } from "vite";
import { access, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  identityGroupsFromIds,
  listProjects,
  loadProject,
  mergeGroups,
  saveProject,
  splitGroupWithNames,
  validatePartition,
  type EditorProject
} from "../src/project.js";
import { exportProjectToL3L4 } from "../src/export-map.js";
import { seedProjectClassesFromBase } from "../src/class-split.js";

const generatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(generatorRoot, "..");

async function readJsonBody(req: import("http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : JSON.parse(text);
}

function sendJson(res: import("http").ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function loadBaseIndex(baseMapId: string): Promise<{
  provinces: { id: string; countryId: string; name: string; nameEn: string }[];
  countries: string[];
  nameById: Map<string, { name: string; nameEn: string }>;
}> {
  const baseRoot = join(generatorRoot, "base", baseMapId);
  const collection = JSON.parse(
    await readFile(join(baseRoot, "geometry/provinces.geojson"), "utf8")
  ) as {
    features: {
      id?: string | number;
      properties: Record<string, unknown> | null;
    }[];
  };
  const provinces = collection.features.flatMap((feature) => {
    if (feature.properties === null) return [];
    const id = String(feature.id);
    return [
      {
        id,
        countryId:
          typeof feature.properties.adm0A3 === "string" ? feature.properties.adm0A3 : "UNK",
        name: typeof feature.properties.name === "string" ? feature.properties.name : id,
        nameEn: typeof feature.properties.nameEn === "string" ? feature.properties.nameEn : id
      }
    ];
  });
  const countries = [...new Set(provinces.map((province) => province.countryId))].sort();
  const nameById = new Map(
    provinces.map((province) => [
      province.id,
      { name: province.name, nameEn: province.nameEn }
    ] as const)
  );
  return { provinces, countries, nameById };
}

function mergedGroupId(countryId: string, members: readonly string[]): string {
  const hash = createHash("sha1")
    .update(`${countryId}|${[...members].sort().join(",")}`)
    .digest("hex")
    .slice(0, 7)
    .toUpperCase();
  return `${countryId}-G${hash}`;
}

export function mapEditorApiPlugin(): Plugin {
  return {
    name: "map-editor-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === undefined || !req.url.startsWith("/api/")) return next();
        try {
          const url = new URL(req.url, "http://localhost");
          if (req.method === "GET" && url.pathname === "/api/bases") {
            const baseRoot = join(generatorRoot, "base");
            let names: string[] = [];
            try {
              names = (await readdir(baseRoot, { withFileTypes: true }))
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort();
            } catch {
              names = [];
            }
            return sendJson(res, 200, { bases: names });
          }
          if (req.method === "GET" && url.pathname === "/api/projects") {
            return sendJson(res, 200, {
              projects: await listProjects(join(generatorRoot, "projects"))
            });
          }
          if (req.method === "GET" && url.pathname.startsWith("/api/projects/")) {
            const projectId = decodeURIComponent(url.pathname.slice("/api/projects/".length));
            const project = await loadProject(join(generatorRoot, "projects", projectId));
            return sendJson(res, 200, project);
          }
          if (req.method === "GET" && url.pathname.startsWith("/api/bases/")) {
            const parts = url.pathname.split("/").filter(Boolean);
            // /api/bases/:id/index, /api/bases/:id/full, or /api/bases/:id/geojson?country=
            const baseMapId = decodeURIComponent(parts[2] ?? "");
            if (parts[3] === "index") {
              const index = await loadBaseIndex(baseMapId);
              return sendJson(res, 200, {
                provinces: index.provinces,
                countries: index.countries
              });
            }
            if (parts[3] === "full") {
              const baseRoot = join(generatorRoot, "base", baseMapId);
              const provincesJson = JSON.parse(
                await readFile(join(baseRoot, "geometry/provinces.geojson"), "utf8")
              ) as unknown;
              let coastlinesJson: unknown = { type: "FeatureCollection", features: [] };
              try {
                coastlinesJson = JSON.parse(
                  await readFile(join(baseRoot, "geometry/coastlines.geojson"), "utf8")
                );
              } catch {
                // optional
              }
              let boundariesJson: unknown = { type: "BoundaryCollection", features: [] };
              try {
                boundariesJson = JSON.parse(
                  await readFile(join(baseRoot, "geometry/boundaries.json"), "utf8")
                );
              } catch {
                // optional
              }
              let demographics: Record<string, unknown> = {};
              try {
                demographics = JSON.parse(
                  await readFile(join(baseRoot, "demographics.json"), "utf8")
                );
              } catch {
                // optional
              }
              const countryNames: Record<string, { name?: string; nameEn: string }> = {};
              try {
                const csv = await readFile(join(baseRoot, "countries.csv"), "utf8");
                const lines = csv.split(/\r?\n/).filter(Boolean);
                for (let i = 1; i < lines.length; i++) {
                  const parts = lines[i]!.split(",");
                  const id = parts[0]?.trim();
                  const name = parts[2]?.trim();
                  if (id) {
                    const nameEn = parts[1]?.trim() || id;
                    countryNames[id] = { nameEn, ...(name ? { name } : {}) };
                  }
                }
              } catch {
                // optional
              }
              return sendJson(res, 200, {
                provinces: provincesJson,
                coastlines: coastlinesJson,
                boundaries: boundariesJson,
                demographics,
                countryNames
              });
            }
            if (parts[3] === "geojson") {
              const country = url.searchParams.get("country");
              const collection = JSON.parse(
                await readFile(
                  join(generatorRoot, "base", baseMapId, "geometry/provinces.geojson"),
                  "utf8"
                )
              ) as {
                type: string;
                features: {
                  id?: string | number;
                  properties: Record<string, unknown> | null;
                  geometry: unknown;
                }[];
              };
              const features =
                country === null || country === ""
                  ? collection.features
                  : collection.features.filter(
                      (feature) => feature.properties?.adm0A3 === country
                    );
              return sendJson(res, 200, { type: "FeatureCollection", features });
            }
          }
          if (req.method === "POST" && url.pathname === "/api/projects") {
            const body = (await readJsonBody(req)) as {
              projectId?: string;
              baseMapId?: string;
              suggestedMapId?: string;
              name?: string;
            };
            const baseMapId = body.baseMapId ?? "world-admin1";
            const projectId =
              body.projectId?.trim() ||
              `project-${new Date().toISOString().replace(/[:.]/g, "-")}`;
            const projectDir = join(generatorRoot, "projects", projectId);
            try {
              await access(join(projectDir, "project.json"));
              return sendJson(res, 409, { error: `Project already exists: ${projectId}` });
            } catch {
              // create
            }
            const index = await loadBaseIndex(baseMapId);
            const project: EditorProject = {
              meta: {
                schemaVersion: 1,
                projectId,
                baseMapId,
                suggestedMapId: body.suggestedMapId?.trim() || projectId,
                name: body.name?.trim() || projectId
              },
              groups: identityGroupsFromIds(index.provinces)
            };
            await saveProject(projectDir, project);
            const baseRoot = join(generatorRoot, "base", baseMapId);
            let classFiles = 0;
            try {
              classFiles = await seedProjectClassesFromBase(projectDir, baseRoot);
            } catch (error) {
              await rm(projectDir, { recursive: true, force: true });
              return sendJson(res, 500, {
                error: `Class seeding failed (need L1 demographics.json): ${
                  error instanceof Error ? error.message : String(error)
                }`
              });
            }
            return sendJson(res, 201, { ...project, classFiles });
          }
          if (req.method === "PUT" && url.pathname.startsWith("/api/projects/")) {
            const projectId = decodeURIComponent(url.pathname.slice("/api/projects/".length));
            const body = (await readJsonBody(req)) as EditorProject;
            if (body.meta.projectId !== projectId) {
              return sendJson(res, 400, { error: "projectId mismatch" });
            }
            const index = await loadBaseIndex(body.meta.baseMapId);
            const errors = validatePartition(
              body.groups,
              new Set(index.provinces.map((province) => province.id))
            );
            if (errors.length > 0) {
              return sendJson(res, 400, {
                error: `Invalid partition:\n${errors.slice(0, 20).join("\n")}`
              });
            }
            await saveProject(join(generatorRoot, "projects", projectId), body);
            return sendJson(res, 200, { ok: true });
          }
          if (req.method === "POST" && url.pathname.endsWith("/merge")) {
            const projectId = decodeURIComponent(
              url.pathname.slice("/api/projects/".length, -"/merge".length)
            );
            const body = (await readJsonBody(req)) as {
              groupIds: string[];
              name?: string;
              nameEn?: string;
            };
            const project = await loadProject(join(generatorRoot, "projects", projectId));
            const parts = project.groups.filter((group) => body.groupIds.includes(group.id));
            const members = parts.flatMap((group) => group.members);
            const countryId = parts[0]?.countryId ?? "UNK";
            const mergedId = mergedGroupId(countryId, members);
            const name =
              body.name?.trim() ||
              parts.map((group) => group.name).join("–") ||
              mergedId;
            const nameEn =
              body.nameEn?.trim() ||
              parts.map((group) => group.nameEn).join("–") ||
              mergedId;
            const groups = mergeGroups(project.groups, body.groupIds, {
              id: mergedId,
              name,
              nameEn
            });
            const next = { ...project, groups };
            await saveProject(join(generatorRoot, "projects", projectId), next);
            return sendJson(res, 200, next);
          }
          if (req.method === "POST" && url.pathname.endsWith("/split")) {
            const projectId = decodeURIComponent(
              url.pathname.slice("/api/projects/".length, -"/split".length)
            );
            const body = (await readJsonBody(req)) as { groupId: string };
            const project = await loadProject(join(generatorRoot, "projects", projectId));
            const index = await loadBaseIndex(project.meta.baseMapId);
            const groups = splitGroupWithNames(project.groups, body.groupId, index.nameById);
            const next = { ...project, groups };
            await saveProject(join(generatorRoot, "projects", projectId), next);
            return sendJson(res, 200, next);
          }
          if (req.method === "POST" && url.pathname.endsWith("/export")) {
            const projectId = decodeURIComponent(
              url.pathname.slice("/api/projects/".length, -"/export".length)
            );
            const body = (await readJsonBody(req)) as { mapId?: string };
            const result = await exportProjectToL3L4({
              generatorRoot,
              repoRoot,
              projectId,
              ...(body.mapId === undefined || body.mapId === ""
                ? {}
                : { requestedMapId: body.mapId })
            });
            return sendJson(res, 200, result);
          }
          return sendJson(res, 404, { error: "Not found" });
        } catch (error) {
          return sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });
    }
  };
}
