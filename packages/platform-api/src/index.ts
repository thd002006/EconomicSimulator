export type PlatformKind = "web" | "desktop" | "steam" | "memory";

export interface SaveDescriptor {
  readonly id: string;
  readonly displayName: string;
}

export interface PlatformServices {
  readonly kind: PlatformKind;
  writeSave(id: string, content: string): Promise<void>;
  readSave(id: string): Promise<string>;
  listSaves(): Promise<readonly SaveDescriptor[]>;
  writeLog(level: "error" | "warning" | "info" | "debug", message: string): Promise<void>;
  unlockAchievement(id: string): Promise<void>;
  setRichPresence(value: Readonly<Record<string, string>>): Promise<void>;
}

export class MemoryPlatformServices implements PlatformServices {
  public readonly kind = "memory" as const;
  private readonly saves = new Map<string, string>();
  private readonly achievements = new Set<string>();
  private presence: Readonly<Record<string, string>> = {};

  public async writeSave(id: string, content: string): Promise<void> {
    this.saves.set(id, content);
  }

  public async readSave(id: string): Promise<string> {
    const content = this.saves.get(id);
    if (content === undefined) {
      throw new Error(`Save not found: ${id}.`);
    }
    return content;
  }

  public async listSaves(): Promise<readonly SaveDescriptor[]> {
    return [...this.saves.keys()].sort().map((id) => ({ id, displayName: id }));
  }

  public async writeLog(
    _level: "error" | "warning" | "info" | "debug",
    _message: string
  ): Promise<void> {
    void _level;
    void _message;
  }

  public async unlockAchievement(id: string): Promise<void> {
    this.achievements.add(id);
  }

  public async setRichPresence(value: Readonly<Record<string, string>>): Promise<void> {
    this.presence = { ...value };
  }

  public hasAchievement(id: string): boolean {
    return this.achievements.has(id);
  }

  public getRichPresence(): Readonly<Record<string, string>> {
    return this.presence;
  }
}
