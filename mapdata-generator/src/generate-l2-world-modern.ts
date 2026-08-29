import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "./geo.js";

interface ReviewProvince {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly countryId: string;
  readonly members: readonly string[];
}

interface ProjectGroup {
  readonly id: string;
  readonly countryId: string;
  readonly members: readonly string[];
  readonly name: string;
  readonly nameEn: string;
}

interface ProjectGroupsFile {
  readonly groups: readonly ProjectGroup[];
}

function asReviewProvince(value: unknown): ReviewProvince {
  if (!isRecord(value)) throw new Error("review province must be an object.");
  for (const key of ["id", "name", "nameEn", "countryId", "members"] as const) {
    if (!(key in value)) throw new Error(`Review province missing ${key}.`);
  }
  const members = (value as { members: unknown }).members;
  if (!Array.isArray(members) || !members.every((m): m is string => typeof m === "string")) {
    throw new Error("members must be a string array.");
  }
  return {
    id: String((value as { id: unknown }).id),
    name: String((value as { name: unknown }).name),
    nameEn: String((value as { nameEn: unknown }).nameEn),
    countryId: String((value as { countryId: unknown }).countryId),
    members
  };
}

export interface GenerateL2Options {
  readonly outDir: string;
}

export async function generateL2FromReviewReport(
  reviewReportPath: string,
  options: GenerateL2Options
): Promise<{ projectPath: string; groupsPath: string; groupCount: number }> {
  const raw = JSON.parse(await readFile(reviewReportPath, "utf8")) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.provinces)) {
    throw new Error(`Review report at ${reviewReportPath} must contain a provinces array.`);
  }
  const groups: ProjectGroup[] = (raw.provinces as readonly unknown[]).map((entry) => {
    const province = asReviewProvince(entry);
    return {
      id: province.id,
      countryId: province.countryId,
      members: [...province.members].sort((a, b) => a.localeCompare(b)),
      name: province.name,
      nameEn: province.nameEn
    };
  });
  const sortedGroups = [...groups].sort((a, b) => a.id.localeCompare(b.id));
  const payload: ProjectGroupsFile = { groups: sortedGroups };
  await mkdir(options.outDir, { recursive: true });
  const projectPath = join(options.outDir, "project.json");
  const groupsPath = join(options.outDir, "groups.json");
  await writeFile(groupsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { projectPath, groupsPath, groupCount: sortedGroups.length };
}

function parseArgs(args: readonly string[]): { reviewReport: string; outDir: string } {
  let reviewReport = "output/world-modern/review-report.json";
  let outDir = "projects/world-modern-editor";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--review") {
      reviewReport = args[++index]!;
      continue;
    }
    if (argument === "--out") {
      outDir = args[++index]!;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      console.log("Usage: generate-l2-world-modern [--review <reviewReport.json>] [--out <outDir>]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { reviewReport, outDir };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = parseArgs(process.argv.slice(2));
  const reviewReportPath = resolve(projectRoot, args.reviewReport);
  const outDirPath = resolve(projectRoot, args.outDir);

  const result = await generateL2FromReviewReport(reviewReportPath, {
    outDir: outDirPath
  });
  const projectJson = {
    schemaVersion: 1 as const,
    projectId: "world-modern-editor",
    baseMapId: "world-admin1",
    suggestedMapId: "world-modern",
    name: "World Modern Editor",
    nameEn: "World Modern Editor"
  };
  await writeFile(join(outDirPath, "project.json"), `${JSON.stringify(projectJson, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}
