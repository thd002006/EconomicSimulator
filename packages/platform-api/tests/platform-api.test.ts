import { describe, expect, it } from "vitest";
import { MemoryPlatformServices } from "../src";

describe("MemoryPlatformServices", () => {
  it("implements the platform contract without native dependencies", async () => {
    const platform = new MemoryPlatformServices();
    await platform.writeSave("autosave", "payload");
    await platform.unlockAchievement("architecture-online");

    expect(await platform.readSave("autosave")).toBe("payload");
    expect(platform.hasAchievement("architecture-online")).toBe(true);
  });
});
