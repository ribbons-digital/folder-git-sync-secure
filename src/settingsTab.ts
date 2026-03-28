import { Notice, PluginSettingTab, Setting } from "obsidian";
import type FolderGitSyncSecurePlugin from "../main.ts";
import { validateRemoteUrl } from "./git/repoValidator.ts";
import { toUserMessage } from "./utils/errors.ts";

export class FolderGitSyncSecureSettingTab extends PluginSettingTab {
  public constructor(
    app: import("obsidian").App,
    private readonly plugin: FolderGitSyncSecurePlugin
  ) {
    super(app, plugin);
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Folder Git Sync Secure" });
    containerEl.createEl("p", {
      text: "Desktop-only, SSH-only, manual-first Git syncing for folder-scoped repositories."
    });

    new Setting(containerEl)
      .setName("Add folder mapping")
      .setDesc("Create a new secure Git mapping for a vault folder.")
      .addButton((button) => {
        button.setButtonText("Add Folder").setCta().onClick(async () => {
          try {
            await this.plugin.addFolderMappingFlow();
          } catch (error) {
            new Notice(toUserMessage(error));
          } finally {
            this.display();
          }
        });
      });

    containerEl.createEl("h3", { text: "Defaults" });

    new Setting(containerEl)
      .setName("Default safe mode")
      .setDesc("New mappings start in safe mode unless you disable it here.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.defaultSafeMode)
          .onChange(async (value) => {
            this.plugin.settings.defaultSafeMode = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default auto-sync")
      .setDesc("New mappings start with auto-sync disabled unless changed here.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.defaultAutoSync)
          .onChange(async (value) => {
            this.plugin.settings.defaultAutoSync = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default auto-sync debounce (ms)")
      .setDesc("Used when creating a new mapping.")
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.defaultAutoSyncDebounceMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.defaultAutoSyncDebounceMs = Number.isFinite(parsed)
              ? parsed
              : 15000;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default blocked file patterns")
      .setDesc("One glob pattern per line for new mappings.")
      .addTextArea((textarea) => {
        textarea
          .setValue(this.plugin.settings.defaultBlockedFilePatterns.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.defaultBlockedFilePatterns = value
              .split("\n")
              .map((entry) => entry.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          });
        textarea.inputEl.rows = 4;
      });

    new Setting(containerEl)
      .setName("Recommended .gitignore template")
      .setDesc("Copy and adapt this manually inside each repository as needed.")
      .addButton((button) => {
        button.setButtonText("Copy Template").onClick(async () => {
          await navigator.clipboard.writeText(
            this.plugin.settings.defaultGitIgnoreTemplate
          );
          new Notice("Recommended .gitignore template copied.");
        });
      });

    containerEl.createEl("pre", {
      text: this.plugin.settings.defaultGitIgnoreTemplate,
      cls: "fgss-gitignore-template"
    });

    containerEl.createEl("h3", { text: "Folder Mappings" });

    if (this.plugin.settings.mappings.length === 0) {
      containerEl.createEl("p", {
        text: "No folders are configured yet."
      });
      return;
    }

    for (const mapping of this.plugin.settings.mappings) {
      const section = containerEl.createDiv({ cls: "fgss-setting-section" });
      section.createEl("h4", { text: mapping.folderPath || "/" });

      new Setting(section)
        .setName("Remote URL")
        .setDesc("SSH remote only.")
        .addText((text) => {
          let draftRemoteUrl = mapping.remoteUrl;
          let persistedRemoteUrl = mapping.remoteUrl;
          const commitRemoteUpdate = async (): Promise<void> => {
            const normalizedRemote = draftRemoteUrl.trim();

            if (normalizedRemote === persistedRemoteUrl) {
              return;
            }

            if (normalizedRemote) {
              const validation = validateRemoteUrl(normalizedRemote);
              if (!validation.valid) {
                new Notice(validation.message ?? "Remote URL is invalid.");
                draftRemoteUrl = persistedRemoteUrl;
                text.setValue(persistedRemoteUrl);
                return;
              }
            }

            try {
              await this.plugin.updateMapping(mapping.id, {
                remoteUrl: normalizedRemote
              });
              persistedRemoteUrl = normalizedRemote;
              draftRemoteUrl = normalizedRemote;
              text.setValue(normalizedRemote);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Failed to update remote URL.";
              new Notice(message);
              draftRemoteUrl = persistedRemoteUrl;
              text.setValue(persistedRemoteUrl);
            }
          };

          text.setValue(mapping.remoteUrl).onChange((value) => {
            draftRemoteUrl = value;
          });
          text.inputEl.addEventListener("blur", () => {
            void commitRemoteUpdate();
          });
          text.inputEl.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") {
              return;
            }

            event.preventDefault();
            void commitRemoteUpdate();
          });
        });

      new Setting(section)
        .setName("Branch")
        .setDesc("Configured branch for push, pull, and sync.")
        .addText((text) => {
          text.setValue(mapping.branch).onChange(async (value) => {
            await this.plugin.updateMapping(mapping.id, { branch: value || "main" });
          });
        });

      new Setting(section)
        .setName("Commit template")
        .setDesc("Supports {{folderName}}, {{timestamp}}, {{date}}, and {{branch}}.")
        .addTextArea((text) => {
          text.setValue(mapping.commitMessageTemplate).onChange(async (value) => {
            await this.plugin.updateMapping(mapping.id, {
              commitMessageTemplate: value
            });
          });
          text.inputEl.rows = 3;
        });

      new Setting(section)
        .setName("Safe mode")
        .setDesc("Manual review is required before plugin commits.")
        .addToggle((toggle) => {
          toggle.setValue(mapping.safeMode).onChange(async (value) => {
            await this.plugin.updateMapping(mapping.id, { safeMode: value });
          });
        });

      new Setting(section)
        .setName("Auto-sync")
        .setDesc("Opt-in only. Safe mode still blocks unattended commits.")
        .addToggle((toggle) => {
          toggle.setValue(mapping.autoSync).onChange(async (value) => {
            await this.plugin.updateMapping(mapping.id, { autoSync: value });
          });
        });

      new Setting(section)
        .setName("Auto-sync debounce (ms)")
        .setDesc("Delay before an auto-sync job runs after file changes.")
        .addText((text) => {
          text.setValue(String(mapping.autoSyncDebounceMs)).onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            await this.plugin.updateMapping(mapping.id, {
              autoSyncDebounceMs: Number.isFinite(parsed) ? parsed : 15000
            });
          });
        });

      new Setting(section)
        .setName("Blocked file patterns")
        .setDesc("One glob pattern per line.")
        .addTextArea((text) => {
          text.setValue(mapping.blockedFilePatterns.join("\n")).onChange(async (value) => {
            await this.plugin.updateMapping(mapping.id, {
              blockedFilePatterns: value
                .split("\n")
                .map((entry) => entry.trim())
                .filter(Boolean)
            });
          });
          text.inputEl.rows = 4;
        });

      new Setting(section)
        .setName("Local Git author override")
        .setDesc("Applied through normal local Git config only when both fields are provided.")
        .addText((text) => {
          text.setPlaceholder("Name").setValue(mapping.authorName ?? "").onChange(async (value) => {
            await this.plugin.updateMapping(mapping.id, { authorName: value });
          });
        })
        .addText((text) => {
          text
            .setPlaceholder("Email")
            .setValue(mapping.authorEmail ?? "")
            .onChange(async (value) => {
              await this.plugin.updateMapping(mapping.id, { authorEmail: value });
            });
        });

      new Setting(section)
        .setName("Remove mapping")
        .setDesc("Stops plugin management for this folder. Existing Git metadata remains on disk.")
        .addButton((button) => {
          button.setButtonText("Remove").setWarning().onClick(async () => {
            await this.plugin.removeMappingById(mapping.id);
            this.display();
          });
        });
    }
  }
}
