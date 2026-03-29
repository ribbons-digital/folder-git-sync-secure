import { Component } from "obsidian";
import type { GitService } from "../git/gitService.ts";
import type { FolderMappingPatch, FolderGitSyncSettings } from "../types.ts";
import { toUserMessage } from "../utils/errors.ts";
import { PeriodicPullEngine } from "./periodicPullEngine.ts";
import { SyncManager } from "./syncManager.ts";

interface PeriodicPullCallbacks {
  getSettings: () => FolderGitSyncSettings;
  updateMappingState: (
    mappingId: string,
    patch: FolderMappingPatch
  ) => Promise<void>;
  refreshViews: () => Promise<void>;
}

export class PeriodicPullManager extends Component {
  private readonly engine: PeriodicPullEngine;
  private reconfigureTail: Promise<void> = Promise.resolve();
  private unloading = false;

  public constructor(
    private readonly gitService: GitService,
    private readonly syncManager: SyncManager,
    private readonly callbacks: PeriodicPullCallbacks
  ) {
    super();
    this.engine = new PeriodicPullEngine({
      runCycle: async () => {
        await this.runCycle();
      },
      onError: (error) => {
        const message = toUserMessage(error);
        console.error(`[PeriodicPullManager] ${message}`, error);
      }
    });
  }

  public start(): void {
    void this.reconfigure();
  }

  public async reconfigure(): Promise<void> {
    this.reconfigureTail = this.reconfigureTail
      .catch(() => undefined)
      .then(async () => {
        if (this.unloading) {
          return;
        }

        const settings = this.callbacks.getSettings();
        await this.engine.applyConfig(
          {
            enabled:
              settings.periodicPullEnabled &&
              settings.periodicPullIntervalSeconds > 0,
            intervalSeconds: settings.periodicPullIntervalSeconds
          },
          { immediate: true }
        );
      });

    await this.reconfigureTail;
  }

  public async runCycle(): Promise<void> {
    if (this.unloading) {
      return;
    }

    const mappings = [...this.callbacks.getSettings().mappings];

    for (const mapping of mappings) {
      if (this.unloading) {
        return;
      }

      try {
        await this.syncManager.enqueue(mapping, "pull", async () => {
          await this.gitService.pull(mapping);
        });

        await this.updateMappingState(mapping.id, {
          lastError: undefined,
          lastSyncTime: new Date().toISOString()
        });
      } catch (error) {
        await this.updateMappingState(mapping.id, {
          lastError: toUserMessage(error)
        });
      }
    }

    if (!this.unloading) {
      await this.callbacks.refreshViews();
    }
  }

  public override onunload(): void {
    this.unloading = true;
    this.engine.stop();
    super.onunload();
  }

  private async updateMappingState(
    mappingId: string,
    patch: FolderMappingPatch
  ): Promise<void> {
    if (this.unloading) {
      return;
    }

    try {
      await this.callbacks.updateMappingState(mappingId, patch);
    } catch (error) {
      if (this.unloading) {
        return;
      }

      console.error(
        `[PeriodicPullManager] Failed to update periodic pull state for ${mappingId}`,
        error
      );
    }
  }
}
