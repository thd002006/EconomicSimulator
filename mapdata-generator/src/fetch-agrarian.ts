import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORLDCLIM_URL = "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_bio.zip";

export const GAEZ_CROP_CODES = [
  "ban", "brl", "cc2", "cot", "fdd",
  "frt", "grd", "mlt", "mze", "nes",
  "oce", "olp", "olv", "pls", "rcw",
  "rsd", "rt1", "rt2", "rt3", "sfl",
  "soy", "srg", "sub", "suc", "tob", "veg", "whe"
] as const;

async function downloadTo(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function ensureFile(
  cacheDir: string,
  fileName: string,
  url: string
): Promise<string> {
  const destination = join(cacheDir, fileName);
  try {
    await stat(destination);
    console.log(`[skip] ${fileName} already exists`);
    return destination;
  } catch {
    console.log(`[fetch] Downloading ${fileName}...`);
    await downloadTo(url, destination);
    return destination;
  }
}

async function extractZipMember(
  zipPath: string,
  memberName: string,
  outPath: string
): Promise<void> {
  const { unzipSync } = await import("fflate");
  const zipBuffer = await readFile(zipPath);
  const zip = unzipSync(new Uint8Array(zipBuffer));
  const entry = Object.entries(zip).find(([name]) =>
    name.toLowerCase().includes(memberName.toLowerCase())
  );
  if (entry === undefined) throw new Error(`No member matching "${memberName}" in zip.`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, entry[1]!);
}

export async function checkGaezSources(agrarianDir: string): Promise<{ present: boolean; count: number }> {
  const gaezDir = join(agrarianDir, "gaez");
  let count = 0;
  for (const code of GAEZ_CROP_CODES) {
    try {
      await stat(join(gaezDir, `${code}__har.tif`));
      count++;
    } catch {
      // not present
    }
  }
  if (count === GAEZ_CROP_CODES.length) {
    console.log(`[ok] GAEZ crop rasters present (${count}/${GAEZ_CROP_CODES.length}) in ${gaezDir}`);
    return { present: true, count };
  }
  console.warn(
    `[notice] GAEZ Theme 5 crop rasters partially found (${count}/${GAEZ_CROP_CODES.length}).\n` +
    `         GAEZ data requires manual download from FAO GAEZ v4 (Theme 5: Actual Crop Harvested Area).\n` +
    `         Place the 27 GeoTIFF files in: ${gaezDir}\n` +
    `         Missing crops will default to 0 harvested area during aggregation.`
  );
  return { present: false, count };
}

export interface FetchedAgrarianSources {
  readonly bioTifDir: string;
  readonly gaezDir: string;
}

export async function ensureAgrarianSources(
  projectRoot: string
): Promise<FetchedAgrarianSources> {
  const agrarianDir = join(projectRoot, "cache/agrarian");
  await mkdir(agrarianDir, { recursive: true });

  const zipFileName = "wc2.1_2.5m_bio.zip";
  const zipPath = join(agrarianDir, zipFileName);
  await ensureFile(agrarianDir, zipFileName, WORLDCLIM_URL);

  const bioTifDir = join(agrarianDir, "bio");
  await mkdir(bioTifDir, { recursive: true });

  const neededBioTifs = ["bio_1.tif", "bio_7.tif", "bio_12.tif"];
  for (const name of neededBioTifs) {
    const outPath = join(bioTifDir, name);
    try {
      await stat(outPath);
      console.log(`[skip] ${name} already extracted`);
    } catch {
      console.log(`[extract] ${name} from zip...`);
      await extractZipMember(zipPath, name, outPath);
    }
  }

  await checkGaezSources(agrarianDir);
  await writeFile(join(agrarianDir, "_download_done.txt"), `Downloaded ${new Date().toISOString()}\n`);

  return { bioTifDir, gaezDir: join(agrarianDir, "gaez") };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await ensureAgrarianSources(projectRoot);
  console.log(JSON.stringify(result, null, 2));
}
