import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseClassCsvText, serializeClassCsv } from "../src/class-split.js";

import { fileURLToPath } from "node:url";

export async function migrateMapClasses(mapDir: string): Promise<number> {
  const provincesDir = join(mapDir, "provinces");
  let provinceIds: string[] = [];
  try {
    provinceIds = (await readdir(provincesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return 0;
  }

  let convertedCount = 0;
  for (const provinceId of provinceIds) {
    const classesDir = join(provincesDir, provinceId, "classes");
    let classFiles: string[] = [];
    try {
      classFiles = (await readdir(classesDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const file of classFiles) {
      const socialClassId = file.slice(0, -".csv".length);
      const filePath = join(classesDir, file);
      const text = await readFile(filePath, "utf8");
      const parsed = parseClassCsvText(socialClassId, text);
      const longitudinal = serializeClassCsv(parsed);
      await writeFile(filePath, longitudinal, "utf8");
      convertedCount += 1;
    }
  }

  return convertedCount;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const defaultMapPath = join(fileURLToPath(new URL("../..", import.meta.url)), "assets", "maps", "world-modern");
  const targetMapPath = process.argv[2] ?? defaultMapPath;
  const count = await migrateMapClasses(targetMapPath);
  console.log(`Successfully migrated ${count} class CSV files to longitudinal dimension format in ${targetMapPath}`);
}
