import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const KUMMU_USER_AGENT = "Mozilla/5.0";
const KUMMU_NODATA = -3.4e38;
const KUMMU_RESOLUTION_DEGREES = 5 / 60;

export interface SocioeconomicConfig {
  readonly baseYear: number;
  readonly population: {
    readonly source: string;
    readonly epochYear: number;
    readonly url: string;
    readonly fileName: string;
    readonly license: string;
  };
  readonly ageSex: {
    readonly source: string;
    readonly maleUrl: string;
    readonly femaleUrl: string;
    readonly countryTableUrl: string;
    readonly fileNamePrefix: string;
    readonly license: string;
  };
  readonly education: {
    readonly source: string;
    readonly url: string;
    readonly fileName: string;
    readonly interpolationYears: readonly [number, number];
    readonly license: string;
  };
  readonly gdpPpp: {
    readonly source: string;
    readonly datasetUrl: string;
    readonly url: string;
    readonly fileName: string;
    readonly convertedFileName?: string;
    readonly unit: string;
    readonly license: string;
  };
  readonly educationAdjustment: {
    readonly maxShiftSharePoints: number;
    readonly reference: string;
  };
}

export async function loadSocioeconomicConfig(path: string): Promise<SocioeconomicConfig> {
  return JSON.parse(await readFile(path, "utf8")) as SocioeconomicConfig;
}

async function downloadTo(
  url: string,
  destination: string,
  headers?: Record<string, string>
): Promise<void> {
  const response = await fetch(url, headers === undefined ? {} : { headers });
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function ensureFile(
  cacheDir: string,
  fileName: string,
  url: string,
  headers?: Record<string, string>
): Promise<string> {
  const destination = join(cacheDir, fileName);
  try {
    await stat(destination);
    return destination;
  } catch {
    console.log(`Downloading ${fileName}...`);
    await downloadTo(url, destination, headers);
    return destination;
  }
}

function sha256File(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface FetchedSocioeconomicSources {
  readonly wppMalePath: string;
  readonly wppFemalePath: string;
  readonly countryTablePath: string;
  readonly educationCsvPath: string;
  readonly ghsPopTifPath: string;
  readonly kummuNcPath: string;
  readonly kummuTifPath: string;
  readonly hashes: Record<string, string>;
}

/** Download (or reuse cached) every upstream socioeconomic source. */
export async function ensureSocioeconomicSources(
  projectRoot: string,
  config: SocioeconomicConfig
): Promise<FetchedSocioeconomicSources> {
  const cacheDir = join(projectRoot, "cache/socioeconomic");
  await mkdir(cacheDir, { recursive: true });
  const prefix = config.ageSex.fileNamePrefix;

  const wppMalePath = await ensureFile(
    cacheDir,
    `${prefix}_popM.txt`,
    config.ageSex.maleUrl
  );
  const wppFemalePath = await ensureFile(
    cacheDir,
    `${prefix}_popF.txt`,
    config.ageSex.femaleUrl
  );
  const countryTablePath = await ensureFile(
    cacheDir,
    "ne_admin0_countries.geojson",
    config.ageSex.countryTableUrl
  );
  const educationCsvPath = await ensureFile(
    cacheDir,
    config.education.fileName,
    config.education.url
  );
  const ghsZipPath = await ensureFile(
    cacheDir,
    config.population.fileName,
    config.population.url
  );
  const kummuNcPath = await ensureFile(cacheDir, config.gdpPpp.fileName, config.gdpPpp.url, {
    "User-Agent": KUMMU_USER_AGENT
  });

  const tifName = config.population.fileName.replace(/\.zip$/, ".tif");
  const tifPath = join(cacheDir, tifName);
  let ghsPopTifPath = tifPath;
  try {
    await stat(tifPath);
  } catch {
    console.log(`Extracting ${config.population.fileName} -> ${tifName}`);
    const zip = unzipSync(new Uint8Array(await readFile(ghsZipPath)));
    const entry = Object.entries(zip).find(([name]) => name.toLowerCase().endsWith(".tif"));
    if (entry === undefined) throw new Error(`No GeoTIFF inside ${config.population.fileName}.`);
    await writeFile(tifPath, entry[1]);
    ghsPopTifPath = tifPath;
  }

  const kummuTifName = config.gdpPpp.convertedFileName ?? "kummu_gdp_ppp_2001.tif";
  const kummuTifPath = join(cacheDir, kummuTifName);
  try {
    await stat(kummuTifPath);
  } catch {
    console.log(`Converting ${config.gdpPpp.fileName} -> ${kummuTifName} (requires Python netCDF4+rasterio)...`);
    const pythonScript = [
      "import sys, pathlib, netCDF4, rasterio, numpy",
      "from rasterio.transform import from_origin",
      "nc = pathlib.Path(sys.argv[1])",
      "tif = pathlib.Path(sys.argv[2])",
      "ds = netCDF4.Dataset(str(nc))",
      "times = ds.variables['time'][:]",
      "idx = int(numpy.argmin(numpy.abs(times - 2000)))",
      "lat = ds.variables['latitude'][:]; lon = ds.variables['longitude'][:]",
      `res = ${KUMMU_RESOLUTION_DEGREES}`,
      "data = ds.variables['GDP_PPP'][idx,:,:].astype('float32')",
      "tr = from_origin(float(lon[0])-res/2, float(lat[0])+res/2, res, res) if lat[0] > lat[-1] else from_origin(float(lon[0])-res/2, float(lat[-1])+res/2, res, res)",
      "dat = data if lat[0] > lat[-1] else data[::-1,:]",
      `nodata = numpy.float32(${KUMMU_NODATA})`,
      "dat = numpy.where(numpy.isnan(dat), nodata, dat)",
      "with rasterio.open(str(tif), 'w', driver='GTiff', height=dat.shape[0], width=dat.shape[1], count=1, dtype='float32', crs='EPSG:4326', transform=tr, nodata=nodata, compress='deflate') as dst: dst.write(dat,1)",
      "print('converted')"
    ].join("\n");
    const trySpawn = (command: string): Promise<void> =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        const python = spawn(command, ["-c", pythonScript, kummuNcPath, kummuTifPath], {
          stdio: "inherit"
        });
        python.on("close", (code) =>
          code === 0 ? resolvePromise() : rejectPromise(new Error(`Kummu conversion failed with code ${code}. Install Python deps: pip install netCDF4 rasterio numpy`))
        );
        python.on("error", rejectPromise);
      });
    try {
      await trySpawn("python3");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        await trySpawn("python");
      } else {
        throw error;
      }
    }
  }

  const hashes: Record<string, string> = {};
  for (const path of [wppMalePath, wppFemalePath, educationCsvPath, ghsPopTifPath, kummuNcPath, kummuTifPath]) {
    try {
      hashes[path] = sha256File(await readFile(path));
    } catch {
      // Converted tif may be missing on first run before conversion — hash will be added next run.
    }
  }

  return {
    wppMalePath,
    wppFemalePath,
    countryTablePath,
    educationCsvPath,
    ghsPopTifPath,
    kummuNcPath,
    kummuTifPath,
    hashes
  };
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const config = await loadSocioeconomicConfig(
    join(toolRoot, "config/world-modern-socioeconomic.json")
  );
  const sources = await ensureSocioeconomicSources(toolRoot, config);
  console.log(JSON.stringify({ sources: sources.hashes }, null, 2));
}
