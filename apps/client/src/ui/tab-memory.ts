import type { MapSelectionKind } from "./selection.js";

const memory = new Map<MapSelectionKind, string>();

export function getRememberedTab(
  kind: MapSelectionKind,
  tabs: readonly string[],
  fallback: string
): string {
  const remembered = memory.get(kind);
  if (remembered !== undefined && tabs.includes(remembered)) return remembered;
  return tabs.includes(fallback) ? fallback : (tabs[0] ?? fallback);
}

export function rememberTab(kind: MapSelectionKind, tabId: string): void {
  memory.set(kind, tabId);
}

/** Test helper: clear session tab memory. */
export function clearTabMemory(): void {
  memory.clear();
}
