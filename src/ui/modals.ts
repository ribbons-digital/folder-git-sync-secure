import {
  App,
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  TFolder,
  TextAreaComponent,
  TextComponent,
  ToggleComponent
} from "obsidian";
import { createDefaultMapping } from "../settings.ts";
import { validateRemoteUrl } from "../git/repoValidator.ts";
import type { CommitReview, GitService, ReviewFile } from "../git/gitService.ts";
import { redactRemoteUrl } from "../security/redaction.ts";
import type { FolderMappingSettings } from "../types.ts";
import { createDeferredSelection } from "./modalSelection.ts";

interface ReviewCommitModalOptions {
  commitEnabled: boolean;
  queueWrite: <T>(work: () => Promise<T>) => Promise<T>;
  onSuccess?: () => Promise<void> | void;
  onFailure?: (message: string) => Promise<void> | void;
}

export async function pickMapping(
  app: App,
  mappings: readonly FolderMappingSettings[],
  placeholder = "Select a folder mapping"
): Promise<FolderMappingSettings | null> {
  if (mappings.length === 0) {
    new Notice("No folder mappings are configured yet.");
    return null;
  }

  if (mappings.length === 1) {
    return mappings[0] ?? null;
  }

  return new Promise((resolve) => {
    const modal = new MappingSuggestModal(app, mappings, resolve, placeholder);
    modal.open();
  });
}

export async function pickVaultFolder(app: App): Promise<TFolder | null> {
  const folders = [app.vault.getRoot()].concat(
    app.vault.getAllLoadedFiles().filter((entry): entry is TFolder => entry instanceof TFolder && entry.path !== "")
  );

  return new Promise((resolve) => {
    const modal = new FolderSuggestModal(app, folders, resolve);
    modal.open();
  });
}

export async function promptForMappingDetails(
  app: App,
  folderPath: string,
  defaults?: Partial<FolderMappingSettings>
): Promise<FolderMappingSettings | null> {
  return new Promise((resolve) => {
    const modal = new AddFolderMappingModal(app, folderPath, resolve, defaults);
    modal.open();
  });
}

export async function confirmRemoval(
  app: App,
  mapping: Pick<FolderMappingSettings, "folderPath">
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(
      app,
      `Remove ${mapping.folderPath || "/"} from secure Git sync?`,
      resolve
    );
    modal.open();
  });
}

export class ReviewCommitModal extends Modal {
  private review: CommitReview | null = null;
  private selectedPaths = new Set<string>();
  private commitMessage = "";
  private allowSuspicious = false;
  private busy = false;

  public constructor(
    app: App,
    private readonly gitService: GitService,
    private readonly mapping: FolderMappingSettings,
    private readonly options: ReviewCommitModalOptions
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.modalEl.addClass("fgss-review-modal");
    this.titleEl.setText(
      this.options.commitEnabled
        ? `Review and Commit: ${this.mapping.folderPath || "/"}`
        : `Staged File Review: ${this.mapping.folderPath || "/"}`
    );
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    if (this.busy) {
      contentEl.createEl("p", { text: "Working..." });
      return;
    }

    if (!this.review) {
      contentEl.createEl("p", { text: "Loading repository review..." });
      try {
        const review = await this.gitService.getCommitReview(this.mapping);
        this.review = review;
        this.commitMessage = review.defaultCommitMessage;
        this.selectedPaths = new Set(
          review.files
            .filter((file) => file.staged || (!file.blocked && !file.suspicious))
            .map((file) => file.path)
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load review.";
        contentEl.empty();
        contentEl.createEl("p", { text: message });
        await this.options.onFailure?.(message);
        return;
      }
      await this.render();
      return;
    }

    if (this.review.warnings.length > 0) {
      const warningBlock = contentEl.createDiv({ cls: "fgss-warning-block" });
      warningBlock.createEl("strong", { text: "Warnings" });
      const list = warningBlock.createEl("ul");
      for (const warning of this.review.warnings) {
        list.createEl("li", { text: warning });
      }
    }

    const summary = contentEl.createDiv({ cls: "fgss-review-summary" });
    summary.createEl("div", {
      text: `Branch: ${this.review.status.branch}`
    });
    summary.createEl("div", {
      text: `Staged: ${this.review.status.stagedCount} | Modified: ${this.review.status.modifiedCount} | Untracked: ${this.review.status.untrackedCount}`
    });
    summary.createEl("div", {
      text: `Repo root: ${this.review.repoPath}`
    });

    const filesSection = contentEl.createDiv({ cls: "fgss-files-section" });
    filesSection.createEl("h3", { text: "Changed Files" });

    if (this.review.files.length === 0) {
      filesSection.createEl("p", {
        text: "No changed files were detected."
      });
    } else {
      const table = filesSection.createEl("table", { cls: "fgss-review-table" });
      const header = table.createEl("thead").createEl("tr");
      ["Stage", "Path", "State", "Warnings"].forEach((text) =>
        header.createEl("th", { text })
      );
      const body = table.createEl("tbody");
      for (const file of this.review.files) {
        this.renderFileRow(body, file);
      }
    }

    const optionsBlock = contentEl.createDiv({ cls: "fgss-review-options" });
    new Setting(optionsBlock)
      .setName("Include suspicious files")
      .setDesc(
        "Safe mode blocks secret-like files unless you explicitly allow them."
      )
      .addToggle((toggle) => {
        toggle.setValue(this.allowSuspicious).onChange(async (value) => {
          this.allowSuspicious = value;
          await this.render();
        });
      });

    if (this.options.commitEnabled) {
      new Setting(optionsBlock)
        .setName("Commit message")
        .setDesc("Review and adjust the commit message before committing.")
        .addTextArea((textarea) => {
          textarea
            .setValue(this.commitMessage)
            .setPlaceholder("vault sync: {{folderName}} {{timestamp}}")
            .onChange((value) => {
              this.commitMessage = value;
            });
          textarea.inputEl.rows = 3;
        });
    }

    const actions = contentEl.createDiv({ cls: "fgss-review-actions" });
    new Setting(actions)
      .addButton((button) => {
        button.setButtonText("Refresh").onClick(async () => {
          this.review = null;
          await this.render();
        });
      })
      .addButton((button) => {
        button.setButtonText("Apply Selection").setCta().onClick(async () => {
          await this.applySelection();
        });
      });

    if (this.options.commitEnabled) {
      new Setting(actions).addButton((button) => {
        button
          .setButtonText("Commit Selected Changes")
          .setWarning()
          .onClick(async () => {
            await this.commitSelection();
          });
      });
    }
  }

  private renderFileRow(tbody: HTMLElement, file: ReviewFile): void {
    const row = tbody.createEl("tr");
    const checkboxCell = row.createEl("td");
    const checkbox = checkboxCell.createEl("input");
    checkbox.type = "checkbox";
    const selected = this.selectedPaths.has(file.path);
    checkbox.checked = selected;
    checkbox.disabled = file.blocked || (file.suspicious && !this.allowSuspicious);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        this.selectedPaths.add(file.path);
      } else {
        this.selectedPaths.delete(file.path);
      }
    });

    row.createEl("td", {
      text: file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path
    });
    row.createEl("td", {
      text: `${file.indexStatus}${file.workTreeStatus} (${file.kind})`
    });
    row.createEl("td", {
      text: file.warnings.join(" | ") || "None"
    });
  }

  private async applySelection(): Promise<boolean> {
    try {
      this.busy = true;
      await this.render();
      const applied = await this.options.queueWrite(async () =>
        this.applySelectionInternal()
      );
      if (!applied) {
        return false;
      }
      new Notice("Staging selection updated.");
      this.review = null;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update staging.";
      new Notice(message);
      await this.options.onFailure?.(message);
      return false;
    } finally {
      this.busy = false;
      await this.render();
    }
  }

  private async commitSelection(): Promise<void> {
    if (!this.review) {
      return;
    }

    try {
      this.busy = true;
      await this.render();
      let committed = false;
      await this.options.queueWrite(async () => {
        const staged = await this.applySelectionInternal();
        if (!staged) {
          return;
        }
        await this.gitService.commitStaged(this.mapping, this.commitMessage, {
          allowSuspicious: this.allowSuspicious
        });
        committed = true;
      });
      if (!committed) {
        return;
      }
      new Notice("Commit created.");
      await this.options.onSuccess?.();
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Commit failed.";
      new Notice(message);
      await this.options.onFailure?.(message);
    } finally {
      this.busy = false;
      this.review = null;
      await this.render();
    }
  }

  private async applySelectionInternal(): Promise<boolean> {
    if (!this.review) {
      return false;
    }

    const toStage = this.review.files
      .filter((file) => this.selectedPaths.has(file.path) && !file.staged)
      .map((file) => file.path);
    const toUnstage = this.review.files
      .filter((file) => !this.selectedPaths.has(file.path) && file.staged)
      .map((file) => file.path);

    if (toStage.length > 0) {
      await this.gitService.stagePaths(this.mapping, toStage, {
        allowSuspicious: this.allowSuspicious
      });
    }
    if (toUnstage.length > 0) {
      await this.gitService.unstagePaths(this.mapping, toUnstage);
    }

    this.review = null;
    return true;
  }
}

class MappingSuggestModal extends FuzzySuggestModal<FolderMappingSettings> {
  // Avoid `selection` because FuzzySuggestModal uses that name internally.
  private readonly deferredSelection;

  public constructor(
    app: App,
    private readonly mappings: readonly FolderMappingSettings[],
    private readonly onPick: (mapping: FolderMappingSettings | null) => void,
    placeholder: string
  ) {
    super(app);
    this.setPlaceholder(placeholder);
    this.deferredSelection = createDeferredSelection(onPick);
  }

  public getItems(): FolderMappingSettings[] {
    return [...this.mappings];
  }

  public getItemText(item: FolderMappingSettings): string {
    return `${item.folderPath || "/"} -> ${item.remoteUrl ? redactRemoteUrl(item.remoteUrl) : "(no remote)"}`;
  }

  public onChooseItem(item: FolderMappingSettings): void {
    this.deferredSelection.choose(item);
  }

  public override onClose(): void {
    super.onClose();
    this.deferredSelection.finalize();
  }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  // Avoid `selection` because FuzzySuggestModal uses that name internally.
  private readonly deferredSelection;

  public constructor(
    app: App,
    private readonly folders: readonly TFolder[],
    private readonly onPick: (folder: TFolder | null) => void
  ) {
    super(app);
    this.setPlaceholder("Select a vault folder to map");
    this.deferredSelection = createDeferredSelection(onPick);
  }

  public getItems(): TFolder[] {
    return [...this.folders];
  }

  public getItemText(item: TFolder): string {
    return item.path || "/";
  }

  public onChooseItem(item: TFolder): void {
    this.deferredSelection.choose(item);
  }

  public override onClose(): void {
    super.onClose();
    this.deferredSelection.finalize();
  }
}

class AddFolderMappingModal extends Modal {
  private readonly draft: FolderMappingSettings;
  private resolved = false;

  public constructor(
    app: App,
    folderPath: string,
    private readonly onSubmit: (mapping: FolderMappingSettings | null) => void,
    defaults?: Partial<FolderMappingSettings>
  ) {
    super(app);
    this.draft = {
      ...createDefaultMapping(folderPath),
      ...defaults,
      folderPath
    };
  }

  public override onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText(`Add Secure Git Folder: ${this.draft.folderPath || "/"}`);
    contentEl.empty();

    new Setting(contentEl)
      .setName("Remote URL")
      .setDesc("SSH remote only. HTTPS is rejected in v1.")
      .addText((text) => this.bindText(text, "remoteUrl"));

    new Setting(contentEl)
      .setName("Branch")
      .setDesc("Branch to use for push, pull, and sync.")
      .addText((text) => this.bindText(text, "branch"));

    new Setting(contentEl)
      .setName("Commit template")
      .setDesc("Supports {{folderName}}, {{timestamp}}, {{date}}, and {{branch}}.")
      .addTextArea((text) => this.bindTextArea(text, "commitMessageTemplate"));

    new Setting(contentEl)
      .setName("Safe mode")
      .setDesc("Requires manual review before committing.")
      .addToggle((toggle) => this.bindToggle(toggle, "safeMode"));

    new Setting(contentEl)
      .setName("Auto-sync")
      .setDesc("Opt-in only. Safe mode still blocks unattended commits.")
      .addToggle((toggle) => this.bindToggle(toggle, "autoSync"));

    new Setting(contentEl)
      .setName("Auto-sync debounce (ms)")
      .setDesc("Delay before an auto-sync job runs after file changes.")
      .addText((text) => {
        text.setValue(String(this.draft.autoSyncDebounceMs)).onChange((value) => {
          const parsed = Number.parseInt(value, 10);
          this.draft.autoSyncDebounceMs = Number.isFinite(parsed) ? parsed : 15000;
        });
      });

    new Setting(contentEl)
      .setName("Blocked file patterns")
      .setDesc("One glob pattern per line. These files are blocked from plugin commits.")
      .addTextArea((text) => {
        text
          .setValue(this.draft.blockedFilePatterns.join("\n"))
          .onChange((value) => {
            this.draft.blockedFilePatterns = value
              .split("\n")
              .map((entry) => entry.trim())
              .filter(Boolean);
          });
        text.inputEl.rows = 4;
      });

    new Setting(contentEl)
      .setName("Local Git author name")
      .setDesc("Optional. Applied through normal local Git config only.")
      .addText((text) => this.bindText(text, "authorName"));

    new Setting(contentEl)
      .setName("Local Git author email")
      .setDesc("Optional. Applied through normal local Git config only.")
      .addText((text) => this.bindText(text, "authorEmail"));

    const actions = contentEl.createDiv({ cls: "fgss-modal-actions" });
    new Setting(actions)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.onSubmit(null);
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Save Mapping").setCta().onClick(() => {
          const validation = validateRemoteUrl(this.draft.remoteUrl);
          if (!validation.valid) {
            new Notice(validation.message ?? "Remote URL is invalid.");
            return;
          }

          this.resolved = true;
          this.onSubmit({
            ...this.draft,
            blockedFilePatterns: [...this.draft.blockedFilePatterns]
          });
          this.close();
        });
      });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.resolved) {
      this.onSubmit(null);
    }
  }

  private bindText(
    component: TextComponent,
    key: keyof Pick<
      FolderMappingSettings,
      "remoteUrl" | "branch" | "authorName" | "authorEmail"
    >
  ): void {
    component.setValue(this.draft[key] ?? "").onChange((value) => {
      this.draft[key] = value;
    });
  }

  private bindTextArea(
    component: TextAreaComponent,
    key: keyof Pick<FolderMappingSettings, "commitMessageTemplate">
  ): void {
    component
      .setValue(this.draft[key])
      .onChange((value) => {
        this.draft[key] = value;
      });
    component.inputEl.rows = 3;
  }

  private bindToggle(
    component: ToggleComponent,
    key: keyof Pick<FolderMappingSettings, "safeMode" | "autoSync">
  ): void {
    component.setValue(this.draft[key]).onChange((value) => {
      this.draft[key] = value;
    });
  }
}

class ConfirmModal extends Modal {
  private resolved = false;

  public constructor(
    app: App,
    private readonly message: string,
    private readonly onConfirm: (confirmed: boolean) => void
  ) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;
    this.titleEl.setText("Confirm Removal");
    contentEl.empty();
    contentEl.createEl("p", { text: this.message });
    new Setting(contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => {
          this.resolved = true;
          this.onConfirm(false);
          this.close();
        });
      })
      .addButton((button) => {
        button.setButtonText("Remove").setWarning().onClick(() => {
          this.resolved = true;
          this.onConfirm(true);
          this.close();
        });
      });
  }

  public override onClose(): void {
    super.onClose();
    if (!this.resolved) {
      this.onConfirm(false);
    }
  }
}
