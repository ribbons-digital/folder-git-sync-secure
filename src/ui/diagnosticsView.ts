import { ItemView, Setting, WorkspaceLeaf } from "obsidian";
import type FolderGitSyncSecurePlugin from "../../main.ts";

export const DIAGNOSTICS_VIEW_TYPE = "folder-git-sync-secure-diagnostics";

export class FolderGitSyncDiagnosticsView extends ItemView {
  public constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: FolderGitSyncSecurePlugin
  ) {
    super(leaf);
  }

  public override getViewType(): string {
    return DIAGNOSTICS_VIEW_TYPE;
  }

  public override getDisplayText(): string {
    return "Folder Git Diagnostics";
  }

  public override getIcon(): string {
    return "shield-alert";
  }

  public override async onOpen(): Promise<void> {
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("fgss-diagnostics-view");
    contentEl.createEl("h2", { text: "Folder Git Diagnostics" });

    new Setting(contentEl).addButton((button) => {
      button.setButtonText("Run Diagnostics").setCta().onClick(async () => {
        await this.plugin.runDiagnosticsCommand();
      });
    });

    contentEl.createEl("pre", {
      text:
        this.plugin.diagnosticsReportText ||
        "Run diagnostics to populate this report."
    });
  }
}
