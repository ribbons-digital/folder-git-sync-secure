import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import type FolderGitSyncSecurePlugin from "../../main.ts";
import { redactRemoteUrl } from "../security/redaction.ts";

export const STATUS_VIEW_TYPE = "folder-git-sync-secure-status";

export class FolderGitSyncStatusView extends ItemView {
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: FolderGitSyncSecurePlugin
  ) {
    super(leaf);
  }

  public override getViewType(): string {
    return STATUS_VIEW_TYPE;
  }

  public override getDisplayText(): string {
    return "Folder Git Sync Status";
  }

  public override getIcon(): string {
    return "git-pull-request";
  }

  public override async onOpen(): Promise<void> {
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fgss-status-view");
    contentEl.createEl("h2", { text: "Folder Git Sync Secure" });

    new Setting(contentEl)
      .setName("Refresh")
      .setDesc("Reload folder status cards.")
      .addButton((button) => {
        button.setButtonText("Refresh").setCta().onClick(async () => {
          await this.refresh();
        });
      })
      .addButton((button) => {
        button.setButtonText("Run diagnostics").onClick(async () => {
          await this.plugin.runDiagnosticsCommand();
        });
      });

    const statuses = await this.plugin.listFolderStatuses();

    if (statuses.length === 0) {
      contentEl.createEl("p", {
        text: "No folder mappings are configured yet."
      });
      return;
    }

    for (const status of statuses) {
      const card = contentEl.createDiv({ cls: "fgss-status-card" });
      card.createEl("h3", { text: status.folderPath || "/" });
      const meta = card.createDiv({ cls: "fgss-status-meta" });
      meta.createEl("div", {
        text: `Remote: ${status.remoteUrl ? redactRemoteUrl(status.remoteUrl) : "(not configured)"}`
      });
      meta.createEl("div", { text: `Branch: ${status.branch}` });
      meta.createEl("div", {
        text: `State: ${status.clean ? "Clean" : "Dirty"}${status.inProgressState ? ` (${status.inProgressState})` : ""}`
      });
      meta.createEl("div", {
        text: `Counts: untracked ${status.untrackedCount}, staged ${status.stagedCount}, modified ${status.modifiedCount}`
      });
      meta.createEl("div", {
        text: `Ahead/behind: ${status.ahead ?? 0}/${status.behind ?? 0}`
      });
      meta.createEl("div", {
        text: `Last sync: ${status.lastSyncTime ?? "Never"}`
      });
      meta.createEl("div", {
        text: `Auth readiness: ${status.authReadiness}`
      });
      if (status.lastError) {
        const errorEl = meta.createDiv({ cls: "fgss-status-error" });
        errorEl.setText(`Last error: ${status.lastError}`);
      }

      const actions = card.createDiv({ cls: "fgss-status-actions" });
      new Setting(actions)
        .addButton((button) => {
          button.setButtonText("Review").onClick(async () => {
            await this.plugin.openReviewModalForPath(status.folderPath);
          });
        })
        .addButton((button) => {
          button.setButtonText("Commit").onClick(async () => {
            await this.plugin.runCommitCommand(status.folderPath);
          });
        })
        .addButton((button) => {
          button.setButtonText("Pull").onClick(async () => {
            await this.plugin.runPullCommand(status.folderPath);
          });
        })
        .addButton((button) => {
          button.setButtonText("Push").onClick(async () => {
            await this.plugin.runPushCommand(status.folderPath);
          });
        })
        .addButton((button) => {
          button.setButtonText("Sync").setCta().onClick(async () => {
            await this.plugin.runSyncCommand(status.folderPath);
          });
        });
    }
  }
}
