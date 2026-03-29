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
        void error;
      }
    });
  }

  public start(): void {
    void this.reconfigure();
  }

  public async reconfigure(): Promise<void> {
    const settings = this.callbacks.getSettings();
    await this.engine.applyConfig(
      {
        enabled: settings.periodicPullEnabled,
        intervalSeconds: settings.periodicPullIntervalSeconds
      },
      {
        immediate:
          settings.periodicPullEnabled && settings.periodicPullIntervalSeconds > 0
      }
    );
  }

  public async runCycle(): Promise<void> {
    const startedAt = new Date().toISOString();

    for (const mapping of this.callbacks.getSettings().mappings) {
      try {
        await this.syncManager.enqueue(mapping, "pull", async () => {
          await this.gitService.pull(mapping);
        });

        await this.callbacks.updateMappingState(mapping.id, {
          lastError: undefined,
          lastSyncTime: startedAt
        });
      } catch (error) {
        await this.callbacks.updateMappingState(mapping.id, {
          lastError: toUserMessage(error)
        });
      }
    }

    await this.callbacks.refreshViews();
  }

  public override onunload(): void {
    this.engine.stop();
    super.onunload();
  }
}
