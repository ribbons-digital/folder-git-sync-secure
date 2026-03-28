import process from "node:process";
import { redactSensitiveText } from "../security/redaction.ts";
import type { AuthReadinessSummary, FolderMappingSettings } from "../types.ts";
import { toUserMessage } from "../utils/errors.ts";
import { PluginLogger } from "../utils/logger.ts";
import { GitProcess } from "./gitProcess.ts";
import { validateRemoteUrl } from "./repoValidator.ts";

export interface LocalGitReadiness {
  gitAvailable: boolean;
  gitVersion?: string | undefined;
  sshAvailable: boolean;
  sshVersion?: string | undefined;
}

export interface RemoteCheckResult {
  ok: boolean;
  summary: string;
  detail?: string | undefined;
}

export class AuthDetector {
  private readonly gitProcess: GitProcess;
  private readonly logger: PluginLogger;

  public constructor(
    gitProcess: GitProcess,
    logger: PluginLogger
  ) {
    this.gitProcess = gitProcess;
    this.logger = logger;
  }

  public async checkLocalReadiness(): Promise<LocalGitReadiness> {
    const [gitVersion, sshVersion] = await Promise.all([
      this.getGitVersion(),
      this.getSshVersion()
    ]);

    return {
      gitAvailable: gitVersion !== undefined,
      gitVersion,
      sshAvailable: sshVersion !== undefined,
      sshVersion
    };
  }

  public async checkRemoteReadOnly(
    repoPath: string,
    remoteUrl: string
  ): Promise<RemoteCheckResult> {
    try {
      await this.gitProcess.runGit(
        repoPath,
        ["ls-remote", "--heads", remoteUrl],
        {
          timeoutMs: 30000
        }
      );

      return {
        ok: true,
        summary: "SSH remote check succeeded."
      };
    } catch (error) {
      this.logger.warn("Remote read-only check failed.", error);
      return {
        ok: false,
        summary: "SSH remote check failed. Verify your SSH key and GitHub SSH setup.",
        detail: toUserMessage(error)
      };
    }
  }

  public createFailureGuidance(
    mapping: Pick<FolderMappingSettings, "remoteUrl">
  ): string[] {
    const remoteValidation = validateRemoteUrl(mapping.remoteUrl);
    const guidance = [
      "This plugin does not manage GitHub credentials.",
      "Ensure Git is installed and available in PATH.",
      "Ensure your SSH key is configured on this machine and added to GitHub.",
      "You can test SSH outside Obsidian before retrying."
    ];

    if (!remoteValidation.valid) {
      guidance.splice(
        1,
        0,
        "Use an SSH remote such as git@github.com:owner/repo.git."
      );
      return guidance;
    }

    const host = remoteValidation.host ?? "your Git host";
    guidance.splice(
      1,
      0,
      `Verify SSH access to ${redactSensitiveText(host)} outside Obsidian before retrying.`
    );

    return guidance;
  }

  public toAuthSummary(
    ok: boolean,
    summary: string
  ): AuthReadinessSummary {
    return {
      checkedAt: new Date().toISOString(),
      ok,
      summary
    };
  }

  private async getGitVersion(): Promise<string | undefined> {
    try {
      const result = await this.gitProcess.runGit(process.cwd(), ["--version"], {
        timeoutMs: 5000
      });

      return result.stdout.trim() || result.stderr.trim() || "git";
    } catch {
      return undefined;
    }
  }

  private async getSshVersion(): Promise<string | undefined> {
    try {
      const result = await this.gitProcess.runSsh(["-V"], process.cwd(), {
        allowNonZeroExit: true,
        timeoutMs: 5000
      });

      return (result.stderr || result.stdout).trim() || "ssh";
    } catch {
      return undefined;
    }
  }
}
