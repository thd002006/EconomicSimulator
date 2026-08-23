import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

/** Resolve an existing file while proving that symlinks cannot escape its map directory. */
export async function resolveContainedFile(
  mapDirectory: string,
  candidate: unknown,
  label: string
): Promise<string> {
  if (typeof candidate !== "string" || candidate.length === 0 || isAbsolute(candidate)) {
    throw new Error(`${label} must be a non-empty relative path inside its map directory.`);
  }
  const root = await realpath(mapDirectory);
  const resolved = await realpath(resolve(root, candidate));
  const fromRoot = relative(root, resolved);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..\\`) ||
    fromRoot.startsWith("../") ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`${label} escapes its map directory: ${candidate}`);
  }
  return resolved;
}
