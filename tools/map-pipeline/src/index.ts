import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectFeatureCollection } from "@economic-simulator/map-runtime";

const inputPath = process.argv.slice(2).find((argument) => argument !== "--");
if (inputPath === undefined) {
  console.error("Usage: pnpm map:inspect -- <path-to-geojson>");
  process.exitCode = 1;
} else {
  const absolutePath = resolve(process.env.INIT_CWD ?? process.cwd(), inputPath);
  const content = await readFile(absolutePath, "utf8");
  const report = inspectFeatureCollection(JSON.parse(content) as unknown);
  console.log(JSON.stringify({ input: absolutePath, ...report }, null, 2));
}
