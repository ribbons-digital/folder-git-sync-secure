import { Component, TAbstractFile } from "obsidian";
import { renderCommitMessageTemplate } from "../settings.ts";
import type { GitService } from "../git/gitService.ts";
import type { FolderMappingPatch, FolderMappingSettings } from "../types.ts";
import { toUserMessage } from "../utils/errors.ts";
import { PluginLogger } from "../utils/logger.ts";
import { SyncManager } from "./syncManager.ts";

interface AutoSyncCallbacks {
  getMappings: () => FolderMappingSettings[];
  updateMappingState: (
    mappingId: string,
    patch: FolderMappingPatch
  ) => Promise<void>;
  refreshViews: () => Promise<void>;
}

export class AutoSyncManager extends Component {
  private readonly timers = new Map<string, number>();

  public constructor(
    private readonly app: import("obsidian").App,
    private readonly gitService: GitService,
    private readonly syncManager: SyncManager,
    private readonly callbacks: AutoSyncCallbacks,
    private readonly logger: PluginLogger
  ) {
    super();
  }

  public start(): void {
    const queuePath = (file: TAbstractFile): void => {
      for (const mapping of this.callbacks.getMappings()) {
        if (!mapping.autoSync) {
          continue;
        }

        if (isPathInsideFolder(file.path, mapping.folderPath)) {
          this.schedule(mapping);
        }
      }
    };

    this.registerEvent(this.app.vault.on("modify", queuePath));
    this.registerEvent(this.app.vault.on("create", queuePath));
    this.registerEvent(this.app.vault.on("delete", queuePath));
    this.registerEvent(this.app.vault.on("rename", queuePath));
  }

  public override onunload(): void {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
    super.onunload();
  }

  private schedule(mapping: FolderMappingSettings): void {
    const existing = this.timers.get(mapping.id);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }

    const timer = window.setTimeout(() => {
      void this.run(mapping.id);
    }, mapping.autoSyncDebounceMs);

    this.timers.set(mapping.id, timer);
  }

  private async run(mappingId: string): Promise<void> {
    this.timers.delete(mappingId);
    const mapping = this.callbacks.getMappings().find((entry) => entry.id === mappingId);
    if (!mapping || !mapping.autoSync) {
      return;
    }

    if (mapping.safeMode) {
      await this.callbacks.updateMappingState(mapping.id, {
        lastError: "Auto-sync skipped because safe mode requires manual review."
      });
      await this.callbacks.refreshViews();
      return;
    }

    try {
      await this.syncManager.enqueue(mapping, "auto-sync", async () => {
        const review = await this.gitService.getCommitReview(mapping);
        if (review.inProgressState || review.status.hasConflicts) {
          throw new Error(
            "Auto-sync blocked: repository has an active merge, rebase, or conflict state."
          );
        }

        if (review.blocked.length > 0 || review.suspicious.length > 0) {
          throw new Error(
            "Auto-sync blocked: suspicious or blocked files were detected."
          );
        }

        if (review.files.length > 0) {
          const safePaths = review.files.map((file) => file.path);
          await this.gitService.commitSelectedPaths(
            mapping,
            safePaths,
            renderCommitMessageTemplate(mapping.commitMessageTemplate, mapping)
          );
        }

        await this.gitService.sync(mapping);
      });

      await this.callbacks.updateMappingState(mapping.id, {
        lastError: undefined,
        lastSyncTime: new Date().toISOString()
      });
      await this.callbacks.refreshViews();
    } catch (error) {
      const message = toUserMessage(error);
      this.logger.warn(`Auto-sync failed for ${mapping.folderPath}`, message);
      await this.callbacks.updateMappingState(mapping.id, {
        lastError: message
      });
      await this.callbacks.refreshViews();
    }
  }
}

function isPathInsideFolder(filePath: string, folderPath: string): boolean {
  const normalizedFile = normalizeVaultPath(filePath);
  const normalizedFolder = normalizeVaultPath(folderPath);

  if (!normalizedFolder) {
    return true;
  }

  return (
    normalizedFile === normalizedFolder ||
    normalizedFile.startsWith(`${normalizedFolder}/`)
  );
}

function normalizeVaultPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/$/, "");
}
