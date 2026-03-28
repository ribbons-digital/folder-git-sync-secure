import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_BRANCH,
  DEFAULT_COMMIT_MESSAGE_TEMPLATE,
  normalizeMapping,
  normalizeSettings
} from "./src/settings.ts";
import { FolderGitSyncSecureSettingTab } from "./src/settingsTab.ts";
import { AuthDetector } from "./src/git/authDetector.ts";
import { GitProcess } from "./src/git/gitProcess.ts";
import {
  type FolderStatusSummary,
  GitService
} from "./src/git/gitService.ts";
import { AutoSyncManager } from "./src/sync/autoSync.ts";
import { SyncManager } from "./src/sync/syncManager.ts";
import type {
  FolderMappingPatch,
  FolderGitSyncSettings,
  FolderMappingSettings
} from "./src/types.ts";
import { validateRemoteUrl } from "./src/git/repoValidator.ts";
import {
  FolderGitSyncError,
  toUserMessage
} from "./src/utils/errors.ts";
import { PluginLogger } from "./src/utils/logger.ts";
import {
  confirmRemoval,
  pickMapping,
  pickVaultFolder,
  promptForMappingDetails,
  ReviewCommitModal
} from "./src/ui/modals.ts";
import {
  DIAGNOSTICS_VIEW_TYPE,
  FolderGitSyncDiagnosticsView
} from "./src/ui/diagnosticsView.ts";
import {
  FolderGitSyncStatusView,
  STATUS_VIEW_TYPE
} from "./src/ui/statusView.ts";

export default class FolderGitSyncSecurePlugin extends Plugin {
  public settings!: FolderGitSyncSettings;
  public diagnosticsReportText = "";

  private logger!: PluginLogger;
  private gitService!: GitService;
  private syncManager!: SyncManager;

  public override async onload(): Promise<void> {
    await this.loadSettings();

    this.logger = new PluginLogger("plugin", this.settings.logLevel);
    const gitProcess = new GitProcess(this.logger.child("git-process"));
    const authDetector = new AuthDetector(
      gitProcess,
      this.logger.child("auth-detector")
    );

    this.syncManager = new SyncManager();
    this.gitService = new GitService(
      this.app,
      gitProcess,
      authDetector,
      this.logger.child("git-service")
    );

    const autoSync = new AutoSyncManager(
      this.app,
      this.gitService,
      this.syncManager,
      {
        getMappings: () => [...this.settings.mappings],
        updateMappingState: async (mappingId, patch) => {
          await this.updateMapping(mappingId, patch);
        },
        refreshViews: async () => {
          await this.refreshViews();
        }
      },
      this.logger.child("auto-sync")
    );
    autoSync.start();
    this.addChild(autoSync);

    this.registerView(
      STATUS_VIEW_TYPE,
      (leaf) => new FolderGitSyncStatusView(leaf, this)
    );
    this.registerView(
      DIAGNOSTICS_VIEW_TYPE,
      (leaf) => new FolderGitSyncDiagnosticsView(leaf, this)
    );

    this.addSettingTab(new FolderGitSyncSecureSettingTab(this.app, this));
    this.registerCommands();
  }

  public async loadSettings(): Promise<void> {
    const rawSettings = await this.loadData();
    this.settings = normalizeSettings(rawSettings);

    const mappings: Array<{ remoteUrl?: unknown } | null | undefined> = Array.isArray(
      rawSettings?.mappings
    )
      ? rawSettings.mappings
      : [];
    const containsUnsafeStoredRemote = mappings.some((mapping) => {
      if (!mapping || typeof mapping.remoteUrl !== "string") {
        return false;
      }

      const remoteUrl = mapping.remoteUrl.trim();
      return Boolean(remoteUrl) && !validateRemoteUrl(remoteUrl).valid;
    });

    if (containsUnsafeStoredRemote) {
      await this.saveData(this.settings);
    }
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshViews();
  }

  public async updateMapping(
    mappingId: string,
    patch: FolderMappingPatch
  ): Promise<void> {
    const normalizedPatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, "remoteUrl")) {
      const remoteUrl = (normalizedPatch.remoteUrl ?? "").trim();
      if (remoteUrl) {
        const remoteValidation = validateRemoteUrl(remoteUrl);
        if (!remoteValidation.valid) {
          throw new FolderGitSyncError(
            "invalid-remote",
            remoteValidation.message ?? "Remote URL is not valid for v1."
          );
        }
      }

      normalizedPatch.remoteUrl = remoteUrl;
    }

    this.settings.mappings = this.settings.mappings.map((mapping) => {
      if (mapping.id !== mappingId) {
        return mapping;
      }

      const merged = {
        ...mapping,
        ...normalizedPatch
      };

      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "authorName") && normalizedPatch.authorName === undefined) {
        delete merged.authorName;
      }
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "authorEmail") && normalizedPatch.authorEmail === undefined) {
        delete merged.authorEmail;
      }
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "lastError") && normalizedPatch.lastError === undefined) {
        delete merged.lastError;
      }
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "lastSyncTime") && normalizedPatch.lastSyncTime === undefined) {
        delete merged.lastSyncTime;
      }
      if (Object.prototype.hasOwnProperty.call(normalizedPatch, "lastAuthCheck") && normalizedPatch.lastAuthCheck === undefined) {
        delete merged.lastAuthCheck;
      }

      return normalizeMapping(merged);
    });

    await this.saveSettings();
  }

  public async addFolderMappingFlow(): Promise<void> {
    const folder = await pickVaultFolder(this.app);
    if (!folder) {
      return;
    }

    if (this.settings.mappings.some((mapping) => mapping.folderPath === folder.path)) {
      new Notice("That folder is already configured.");
      return;
    }

    const defaults = {
      branch: DEFAULT_BRANCH,
      commitMessageTemplate: DEFAULT_COMMIT_MESSAGE_TEMPLATE,
      autoSync: this.settings.defaultAutoSync,
      autoSyncDebounceMs: this.settings.defaultAutoSyncDebounceMs,
      safeMode: this.settings.defaultSafeMode,
      blockedFilePatterns: [...this.settings.defaultBlockedFilePatterns]
    } satisfies Partial<FolderMappingSettings>;

    const mapping = await promptForMappingDetails(this.app, folder.path, defaults);
    if (!mapping) {
      return;
    }

    this.settings.mappings = [...this.settings.mappings, normalizeMapping(mapping)];
    await this.saveSettings();

    try {
      await this.gitService.ensureInitialized(mapping);
      await this.updateMapping(mapping.id, { lastError: undefined });
      new Notice("Folder mapping added and repository prepared.");
    } catch (error) {
      const message = toUserMessage(error);
      await this.updateMapping(mapping.id, { lastError: message });
      new Notice(message);
    }
  }

  public async removeMappingById(mappingId: string): Promise<void> {
    const mapping = this.settings.mappings.find((entry) => entry.id === mappingId);
    if (!mapping) {
      return;
    }

    const confirmed = await confirmRemoval(this.app, mapping);
    if (!confirmed) {
      return;
    }

    this.settings.mappings = this.settings.mappings.filter(
      (entry) => entry.id !== mappingId
    );
    await this.saveSettings();
  }

  public async listFolderStatuses(): Promise<FolderStatusSummary[]> {
    const results: FolderStatusSummary[] = [];

    for (const mapping of this.settings.mappings) {
      try {
        results.push(await this.gitService.getFolderStatus(mapping));
      } catch (error) {
        results.push({
          folderPath: mapping.folderPath,
          remoteUrl: mapping.remoteUrl,
          repoExists: false,
          branch: mapping.branch,
          clean: false,
          stagedCount: 0,
          modifiedCount: 0,
          untrackedCount: 0,
          lastSyncTime: mapping.lastSyncTime,
          lastError: toUserMessage(error),
          authReadiness: mapping.lastAuthCheck?.summary ?? "Status check failed."
        });
      }
    }

    return results;
  }

  public async openStatusView(): Promise<void> {
    const leaf = await this.ensureViewLeaf(STATUS_VIEW_TYPE);
    const view = leaf.view;
    if (view instanceof FolderGitSyncStatusView) {
      await view.refresh();
    }
  }

  public async openDiagnosticsView(): Promise<void> {
    const leaf = await this.ensureViewLeaf(DIAGNOSTICS_VIEW_TYPE);
    const view = leaf.view;
    if (view instanceof FolderGitSyncDiagnosticsView) {
      await view.refresh();
    }
  }

  public async runDiagnosticsCommand(): Promise<void> {
    if (this.settings.mappings.length === 0) {
      new Notice("No folder mappings are configured yet.");
      return;
    }

    const reports: string[] = [];
    for (const mapping of this.settings.mappings) {
      const report = await this.gitService.buildDiagnosticsReport(mapping);
      reports.push(this.gitService.formatDiagnosticsReport(report));
      const remoteCheck = report.checks.find(
        (entry) => entry.label === "Read-only remote check"
      );
      await this.updateMapping(mapping.id, {
        lastAuthCheck: remoteCheck
          ? {
              checkedAt: new Date().toISOString(),
              ok: remoteCheck.ok,
              summary: remoteCheck.detail
            }
          : mapping.lastAuthCheck
      });
    }

    this.diagnosticsReportText = reports.join("\n\n----------------------------------------\n\n");
    await this.openDiagnosticsView();
  }

  public async openReviewModalForPath(folderPath?: string): Promise<void> {
    const mapping = await this.resolveMapping(folderPath);
    if (!mapping) {
      return;
    }

    const modal = new ReviewCommitModal(this.app, this.gitService, mapping, {
      commitEnabled: false,
      queueWrite: (work) =>
        this.syncManager.enqueue(mapping, "review", work, {
          respectBackoff: false,
          recordFailures: false
        }),
      onFailure: async (message) => {
        await this.updateMapping(mapping.id, { lastError: message });
      }
    });
    modal.open();
  }

  public async runCommitCommand(folderPath?: string): Promise<void> {
    const mapping = await this.resolveMapping(folderPath);
    if (!mapping) {
      return;
    }

    const modal = new ReviewCommitModal(this.app, this.gitService, mapping, {
      commitEnabled: true,
      queueWrite: (work) =>
        this.syncManager.enqueue(mapping, "review", work, {
          respectBackoff: false,
          recordFailures: false
        }),
      onSuccess: async () => {
        await this.updateMapping(mapping.id, { lastError: undefined });
      },
      onFailure: async (message) => {
        await this.updateMapping(mapping.id, { lastError: message });
      }
    });
    modal.open();
  }

  public async runPullCommand(folderPath?: string): Promise<void> {
    const mapping = await this.resolveMapping(folderPath);
    if (!mapping) {
      return;
    }

    await this.runNetworkOperation(mapping, "pull", async () => {
      await this.gitService.pull(mapping);
      new Notice(`Pull completed for ${mapping.folderPath || "/"}.`);
    });
  }

  public async runPushCommand(folderPath?: string): Promise<void> {
    const mapping = await this.resolveMapping(folderPath);
    if (!mapping) {
      return;
    }

    await this.runNetworkOperation(mapping, "push", async () => {
      await this.gitService.push(mapping);
      await this.updateMapping(mapping.id, {
        lastError: undefined,
        lastAuthCheck: {
          checkedAt: new Date().toISOString(),
          ok: true,
          summary: "SSH Git operation succeeded."
        }
      });
      new Notice(`Push completed for ${mapping.folderPath || "/"}.`);
    });
  }

  public async runSyncCommand(folderPath?: string): Promise<void> {
    const mapping = await this.resolveMapping(folderPath);
    if (!mapping) {
      return;
    }

    await this.runNetworkOperation(mapping, "sync", async () => {
      await this.gitService.sync(mapping);
      await this.updateMapping(mapping.id, {
        lastError: undefined,
        lastSyncTime: new Date().toISOString(),
        lastAuthCheck: {
          checkedAt: new Date().toISOString(),
          ok: true,
          summary: "SSH Git operation succeeded."
        }
      });
      new Notice(`Sync completed for ${mapping.folderPath || "/"}.`);
    });
  }

  public async refreshViews(): Promise<void> {
    const statusLeaves = this.app.workspace.getLeavesOfType(STATUS_VIEW_TYPE);
    for (const leaf of statusLeaves) {
      if (leaf.view instanceof FolderGitSyncStatusView) {
        await leaf.view.refresh();
      }
    }

    const diagnosticsLeaves =
      this.app.workspace.getLeavesOfType(DIAGNOSTICS_VIEW_TYPE);
    for (const leaf of diagnosticsLeaves) {
      if (leaf.view instanceof FolderGitSyncDiagnosticsView) {
        await leaf.view.refresh();
      }
    }
  }

  private registerCommands(): void {
    this.addCommand({
      id: "add-folder-to-secure-git-sync",
      name: "Add folder to secure Git sync",
      callback: async () => {
        try {
          await this.addFolderMappingFlow();
        } catch (error) {
          new Notice(toUserMessage(error));
        }
      }
    });

    this.addCommand({
      id: "remove-folder-from-secure-git-sync",
      name: "Remove folder from secure Git sync",
      callback: async () => {
        const mapping = await this.resolveMapping();
        if (mapping) {
          await this.removeMappingById(mapping.id);
        }
      }
    });

    this.addCommand({
      id: "open-sync-status-panel",
      name: "Open sync status panel",
      callback: async () => {
        await this.openStatusView();
      }
    });

    this.addCommand({
      id: "commit-folder",
      name: "Commit folder",
      callback: async () => {
        await this.runCommitCommand();
      }
    });

    this.addCommand({
      id: "pull-folder",
      name: "Pull folder",
      callback: async () => {
        await this.runPullCommand();
      }
    });

    this.addCommand({
      id: "push-folder",
      name: "Push folder",
      callback: async () => {
        await this.runPushCommand();
      }
    });

    this.addCommand({
      id: "sync-folder",
      name: "Sync folder",
      callback: async () => {
        await this.runSyncCommand();
      }
    });

    this.addCommand({
      id: "run-folder-git-diagnostics",
      name: "Run diagnostics",
      callback: async () => {
        await this.runDiagnosticsCommand();
      }
    });

    this.addCommand({
      id: "open-staged-file-review",
      name: "Open staged file review",
      callback: async () => {
        await this.openReviewModalForPath();
      }
    });
  }

  private async runNetworkOperation(
    mapping: FolderMappingSettings,
    jobKind: "pull" | "push" | "sync",
    operation: () => Promise<void>
  ): Promise<void> {
    try {
      await this.syncManager.enqueue(mapping, jobKind, operation);
      await this.updateMapping(mapping.id, { lastError: undefined });
      await this.refreshViews();
    } catch (error) {
      const message = toUserMessage(error);
      await this.updateMapping(mapping.id, { lastError: message });
      new Notice(message);
    }
  }

  private async resolveMapping(
    folderPath?: string
  ): Promise<FolderMappingSettings | null> {
    if (folderPath) {
      return (
        this.settings.mappings.find((mapping) => mapping.folderPath === folderPath) ??
        null
      );
    }

    return pickMapping(this.app, this.settings.mappings);
  }

  private async ensureViewLeaf(viewType: string): Promise<WorkspaceLeaf> {
    const existing = this.app.workspace.getLeavesOfType(viewType)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return existing;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      throw new Error("Unable to open Obsidian side panel.");
    }

    await leaf.setViewState({ type: viewType, active: true });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }
}
