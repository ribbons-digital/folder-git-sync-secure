import path from "node:path";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import type { App, FileSystemAdapter } from "obsidian";
import { renderCommitMessageTemplate } from "../settings.ts";
import {
  assertSafeRepoRelativePath,
  resolveCanonicalRepoPath
} from "../security/pathGuards.ts";
import {
  scanPathsForSecrets,
  scanRepositoryForSecrets
} from "../security/secretScanner.ts";
import { redactRemoteUrl } from "../security/redaction.ts";
import type {
  DiagnosticsReport,
  FolderMappingSettings,
  RepoStatus,
  SecretFinding,
  WorkingTreeFile
} from "../types.ts";
import {
  FolderGitSyncError,
  toUserDetail,
  toUserMessage
} from "../utils/errors.ts";
import { PluginLogger } from "../utils/logger.ts";
import { AuthDetector } from "./authDetector.ts";
import { GitProcess } from "./gitProcess.ts";
import { validateRemoteUrl } from "./repoValidator.ts";
import { parseStatusPorcelainV2 } from "./statusParser.ts";

export interface FolderStatusSummary {
  folderPath: string;
  remoteUrl: string;
  repoExists: boolean;
  branch: string;
  clean: boolean;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  ahead?: number | undefined;
  behind?: number | undefined;
  lastSyncTime?: string | undefined;
  lastError?: string | undefined;
  authReadiness: string;
  inProgressState?: string | undefined;
}

export interface ReviewFile extends WorkingTreeFile {
  suspicious: boolean;
  blocked: boolean;
  warnings: string[];
}

export interface CommitReview {
  repoPath: string;
  status: RepoStatus;
  inProgressState?: string | undefined;
  files: ReviewFile[];
  suspicious: SecretFinding[];
  blocked: SecretFinding[];
  warnings: string[];
  defaultCommitMessage: string;
}

interface ResolvedMappingContext {
  repoPath: string;
  mapping: FolderMappingSettings;
}

interface RepoRootState {
  isRepoRoot: boolean;
  detectedRoot?: string | undefined;
}

export class GitService {
  private readonly app: App;
  private readonly gitProcess: GitProcess;
  private readonly authDetector: AuthDetector;
  private readonly logger: PluginLogger;

  public constructor(
    app: App,
    gitProcess: GitProcess,
    authDetector: AuthDetector,
    logger: PluginLogger
  ) {
    this.app = app;
    this.gitProcess = gitProcess;
    this.authDetector = authDetector;
    this.logger = logger;
  }

  public async getFolderStatus(
    mapping: FolderMappingSettings
  ): Promise<FolderStatusSummary> {
    const repoPath = await this.resolveRepoPath(mapping.folderPath);
    const repoState = await this.getRepoRootState(repoPath);
    const repoExists = repoState.isRepoRoot;
    const localReadiness = await this.authDetector.checkLocalReadiness();

    if (!repoExists) {
      return {
        folderPath: mapping.folderPath,
        remoteUrl: mapping.remoteUrl,
        repoExists: false,
        branch: mapping.branch,
        clean: true,
        stagedCount: 0,
        modifiedCount: 0,
        untrackedCount: 0,
        lastSyncTime: mapping.lastSyncTime,
        lastError: mapping.lastError,
        authReadiness: this.describeLocalAuthState(mapping, localReadiness)
      };
    }

    const status = await this.readStatus(repoPath);
    const inProgressState = await this.detectInProgressState(repoPath);

    return {
      folderPath: mapping.folderPath,
      remoteUrl: mapping.remoteUrl,
      repoExists: true,
      branch: status.branch,
      clean: status.clean && !inProgressState,
      stagedCount: status.stagedCount,
      modifiedCount: status.modifiedCount,
      untrackedCount: status.untrackedCount,
      ahead: status.ahead,
      behind: status.behind,
      lastSyncTime: mapping.lastSyncTime,
      lastError: mapping.lastError,
      authReadiness:
        mapping.lastAuthCheck?.summary ??
        this.describeLocalAuthState(mapping, localReadiness),
      inProgressState
    };
  }

  public async ensureInitialized(
    mapping: FolderMappingSettings
  ): Promise<ResolvedMappingContext> {
    const repoPath = await this.resolveRepoPath(mapping.folderPath);
    const readiness = await this.authDetector.checkLocalReadiness();

    if (!readiness.gitAvailable) {
      throw new FolderGitSyncError("git-missing", "Git was not found in PATH.");
    }

    const remoteValidation = validateRemoteUrl(mapping.remoteUrl);
    if (!remoteValidation.valid) {
      throw new FolderGitSyncError(
        "invalid-remote",
        remoteValidation.message ?? "Remote URL is not valid for v1."
      );
    }

    const repoState = await this.getRepoRootState(repoPath);
    const repoExists = repoState.isRepoRoot;
    if (!repoExists) {
      await this.gitProcess.runGit(repoPath, ["init"]);
      await this.gitProcess.runGit(repoPath, [
        "symbolic-ref",
        "HEAD",
        `refs/heads/${mapping.branch}`
      ]);
    }

    await this.assertRepoRoot(repoPath);
    await this.configureOrigin(repoPath, mapping.remoteUrl);
    await this.applyLocalAuthorConfig(repoPath, mapping);

    return { repoPath, mapping };
  }

  public async getCommitReview(
    mapping: FolderMappingSettings
  ): Promise<CommitReview> {
    const context = await this.ensureInitialized(mapping);
    const status = await this.readStatus(context.repoPath);
    const inProgressState = await this.detectInProgressState(context.repoPath);
    const scanResult = scanPathsForSecrets(
      status.files.map((file) => file.path),
      mapping.blockedFilePatterns
    );
    const suspiciousSet = new Set(scanResult.suspicious.map((item) => item.path));
    const blockedSet = new Set(scanResult.blocked.map((item) => item.path));

    const files: ReviewFile[] = status.files.map((file) => {
      const warnings: string[] = [];
      if (suspiciousSet.has(file.path)) {
        warnings.push("Secret-like filename detected.");
      }
      if (blockedSet.has(file.path)) {
        warnings.push("Matches a blocked file pattern.");
      }

      return {
        ...file,
        suspicious: suspiciousSet.has(file.path),
        blocked: blockedSet.has(file.path),
        warnings
      };
    });

    const warnings = buildReviewWarnings(
      scanResult.suspicious,
      scanResult.blocked,
      inProgressState
    );

    return {
      repoPath: context.repoPath,
      status,
      inProgressState,
      files,
      suspicious: scanResult.suspicious,
      blocked: scanResult.blocked,
      warnings,
      defaultCommitMessage: renderCommitMessageTemplate(
        mapping.commitMessageTemplate,
        mapping
      )
    };
  }

  public async stagePaths(
    mapping: FolderMappingSettings,
    candidatePaths: readonly string[],
    options: { allowSuspicious?: boolean } = {}
  ): Promise<void> {
    const context = await this.ensureInitialized(mapping);
    const safePaths = uniquePaths(candidatePaths);
    if (safePaths.length === 0) {
      return;
    }

    const scanResult = scanPathsForSecrets(
      safePaths,
      mapping.blockedFilePatterns
    );

    if (scanResult.blocked.length > 0) {
      throw new FolderGitSyncError(
        "blocked-files",
        "Commit blocked: blocked file patterns matched the selected files."
      );
    }

    if (scanResult.suspicious.length > 0 && !options.allowSuspicious) {
      throw new FolderGitSyncError(
        "suspicious-files",
        "Commit blocked: suspicious secret-like files detected."
      );
    }

    await this.gitProcess.runGit(context.repoPath, [
      "add",
      "-A",
      "--",
      ...safePaths
    ]);
  }

  public async unstagePaths(
    mapping: FolderMappingSettings,
    candidatePaths: readonly string[]
  ): Promise<void> {
    const context = await this.ensureInitialized(mapping);
    const safePaths = uniquePaths(candidatePaths);
    if (safePaths.length === 0) {
      return;
    }

    if (await this.hasHeadCommit(context.repoPath)) {
      await this.gitProcess.runGit(context.repoPath, [
        "restore",
        "--staged",
        "--source=HEAD",
        "--",
        ...safePaths
      ]);
      return;
    }

    await this.gitProcess.runGit(context.repoPath, [
      "rm",
      "--cached",
      "--ignore-unmatch",
      "--",
      ...safePaths
    ]);
  }

  public async commitSelectedPaths(
    mapping: FolderMappingSettings,
    selectedPaths: readonly string[],
    message: string,
    options: { allowSuspicious?: boolean } = {}
  ): Promise<void> {
    await this.stagePaths(mapping, selectedPaths, options);
    await this.commitStaged(mapping, message, options);
  }

  public async commitStaged(
    mapping: FolderMappingSettings,
    message: string,
    options: { allowSuspicious?: boolean } = {}
  ): Promise<void> {
    const context = await this.ensureInitialized(mapping);
    const status = await this.readStatus(context.repoPath);
    await this.assertRepoReadyForWrite(context.repoPath, status, mapping.branch);

    if (status.stagedCount === 0) {
      throw new FolderGitSyncError(
        "nothing-staged",
        "No staged changes are ready to commit."
      );
    }

    const scanResult = scanPathsForSecrets(
      status.files.filter((file) => file.staged).map((file) => file.path),
      mapping.blockedFilePatterns
    );

    if (scanResult.blocked.length > 0) {
      throw new FolderGitSyncError(
        "blocked-files",
        "Commit blocked: blocked file patterns matched staged files."
      );
    }

    if (scanResult.suspicious.length > 0 && !options.allowSuspicious) {
      throw new FolderGitSyncError(
        "suspicious-files",
        "Commit blocked: suspicious secret-like files detected."
      );
    }

    await this.applyLocalAuthorConfig(context.repoPath, mapping);
    await this.gitProcess.runGit(context.repoPath, ["commit", "-m", message]);
  }

  public async stageAllSafeChanges(
    mapping: FolderMappingSettings
  ): Promise<string[]> {
    const review = await this.getCommitReview(mapping);
    const allowedPaths = review.files
      .filter((file) => !file.blocked && !file.suspicious)
      .map((file) => file.path);

    await this.stagePaths(mapping, allowedPaths);
    return allowedPaths;
  }

  public async pull(mapping: FolderMappingSettings): Promise<void> {
    const context = await this.ensureInitialized(mapping);
    const status = await this.readStatus(context.repoPath);
    await this.assertRepoReadyForSync(context.repoPath, status, mapping.branch);
    await this.gitProcess.runGit(context.repoPath, [
      "pull",
      "--rebase",
      "origin",
      mapping.branch
    ]);
  }

  public async push(mapping: FolderMappingSettings): Promise<void> {
    const context = await this.ensureInitialized(mapping);
    const status = await this.readStatus(context.repoPath);
    await this.assertRepoReadyForNetwork(context.repoPath, status, mapping.branch);
    await this.gitProcess.runGit(context.repoPath, [
      "push",
      "-u",
      "origin",
      mapping.branch
    ]);
  }

  public async sync(mapping: FolderMappingSettings): Promise<void> {
    const context = await this.ensureInitialized(mapping);
    const status = await this.readStatus(context.repoPath);
    await this.assertRepoReadyForSync(context.repoPath, status, mapping.branch);
    await this.gitProcess.runGit(context.repoPath, [
      "pull",
      "--rebase",
      "origin",
      mapping.branch
    ]);
    await this.gitProcess.runGit(context.repoPath, [
      "push",
      "-u",
      "origin",
      mapping.branch
    ]);
  }

  public async buildDiagnosticsReport(
    mapping: FolderMappingSettings
  ): Promise<DiagnosticsReport> {
    const checks: DiagnosticsReport["checks"] = [];
    const localReadiness = await this.authDetector.checkLocalReadiness();

    checks.push({
      label: "Git installed",
      ok: localReadiness.gitAvailable,
      detail: localReadiness.gitVersion ?? "Git was not found in PATH."
    });

    checks.push({
      label: "SSH available",
      ok: localReadiness.sshAvailable,
      detail: localReadiness.sshVersion ?? "ssh was not found in PATH."
    });

    let repoPath = "";
    try {
      repoPath = await this.resolveRepoPath(mapping.folderPath);
      checks.push({
        label: "Folder path valid",
        ok: true,
        detail: repoPath
      });
    } catch (error) {
      checks.push({
        label: "Folder path valid",
        ok: false,
        detail: toUserMessage(error)
      });

      return {
        folderPath: mapping.folderPath,
        checks,
        guidance: this.authDetector.createFailureGuidance(mapping)
      };
    }

    const repoState = await this.getRepoRootState(repoPath);
    const repoExists = repoState.isRepoRoot;
    checks.push({
      label: "Folder is a Git repo",
      ok: repoExists,
      detail: repoExists
        ? "Repository detected."
        : repoState.detectedRoot
          ? "Configured folder is inside another Git repository but is not the Git repository root."
          : "Repository not initialized."
    });

    const remoteValidation = validateRemoteUrl(mapping.remoteUrl);
    checks.push({
      label: "Remote is present",
      ok: Boolean(mapping.remoteUrl.trim()),
      detail: mapping.remoteUrl.trim()
        ? redactRemoteUrl(mapping.remoteUrl)
        : "No remote configured."
    });
    checks.push({
      label: "Remote is SSH GitHub-style",
      ok: remoteValidation.valid,
      detail:
        remoteValidation.valid
          ? `${remoteValidation.protocol}://${remoteValidation.host ?? "host"}`
          : remoteValidation.message ?? "Remote URL is invalid."
    });

    let remoteCheckSummary = "Remote check skipped.";
    let remoteCheckOk = false;
    if (repoExists && remoteValidation.valid) {
      const remoteCheck = await this.authDetector.checkRemoteReadOnly(
        repoPath,
        mapping.remoteUrl
      );
      remoteCheckSummary = remoteCheck.detail
        ? `${remoteCheck.summary} ${remoteCheck.detail}`
        : remoteCheck.summary;
      remoteCheckOk = remoteCheck.ok;
    }

    checks.push({
      label: "Read-only remote check",
      ok: remoteCheckOk,
      detail: remoteCheckSummary
    });

    const secrets = await scanRepositoryForSecrets(
      repoPath,
      mapping.blockedFilePatterns
    );
    checks.push({
      label: "Obvious secret-risk files",
      ok: secrets.suspicious.length === 0 && secrets.blocked.length === 0,
      detail: formatSecretDiagnostics(secrets)
    });

    let inProgressState = "Repository not initialized.";
    let dirtyState = "Repository not initialized.";
    if (repoExists) {
      inProgressState =
        (await this.detectInProgressState(repoPath)) ?? "No merge/rebase state.";
      const status = await this.readStatus(repoPath);
      dirtyState = status.clean ? "Working tree clean." : "Working tree is dirty.";
      checks.push({
        label: "Working tree dirty",
        ok: status.clean,
        detail: dirtyState
      });
    } else {
      checks.push({
        label: "Working tree dirty",
        ok: false,
        detail: dirtyState
      });
    }

    checks.push({
      label: "Merge/rebase state",
      ok: inProgressState === "No merge/rebase state.",
      detail: inProgressState
    });

    return {
      folderPath: mapping.folderPath,
      checks,
      guidance: this.authDetector.createFailureGuidance(mapping)
    };
  }

  public formatDiagnosticsReport(report: DiagnosticsReport): string {
    const lines = [`Folder: ${report.folderPath}`, ""];

    for (const check of report.checks) {
      lines.push(`${check.ok ? "OK" : "FAIL"} ${check.label}`);
      lines.push(`  ${check.detail}`);
    }

    if (report.guidance.length > 0) {
      lines.push("");
      lines.push("Guidance:");
      for (const item of report.guidance) {
        lines.push(`- ${item}`);
      }
    }

    return lines.join("\n");
  }

  public async getCurrentStatus(mapping: FolderMappingSettings): Promise<RepoStatus> {
    const context = await this.ensureInitialized(mapping);
    return this.readStatus(context.repoPath);
  }

  private async resolveRepoPath(folderPath: string): Promise<string> {
    const vaultBasePath = this.getVaultBasePath();
    const resolved = await resolveCanonicalRepoPath(vaultBasePath, folderPath);
    return resolved.canonicalPath;
  }

  private getVaultBasePath(): string {
    const adapter = this.app.vault.adapter as FileSystemAdapter & {
      getBasePath?: () => string;
    };

    if (typeof adapter.getBasePath !== "function") {
      throw new FolderGitSyncError(
        "unsupported-adapter",
        "This plugin requires the desktop filesystem adapter."
      );
    }

    return adapter.getBasePath();
  }

  private async readStatus(repoPath: string): Promise<RepoStatus> {
    const result = await this.gitProcess.runGit(repoPath, [
      "status",
      "--porcelain=v2",
      "--branch",
      "-z"
    ]);

    return parseStatusPorcelainV2(result.stdout);
  }

  private async getRepoRootState(repoPath: string): Promise<RepoRootState> {
    try {
      const result = await this.gitProcess.runGit(
        repoPath,
        ["rev-parse", "--show-toplevel"],
        { allowNonZeroExit: true }
      );

      if (result.exitCode !== 0) {
        return { isRepoRoot: false };
      }

      const detectedRoot = path.resolve(result.stdout.trim());
      return {
        isRepoRoot: detectedRoot === path.resolve(repoPath),
        detectedRoot
      };
    } catch {
      return { isRepoRoot: false };
    }
  }

  private async assertRepoRoot(repoPath: string): Promise<void> {
    const result = await this.gitProcess.runGit(repoPath, [
      "rev-parse",
      "--show-toplevel"
    ]);

    if (path.resolve(result.stdout.trim()) !== path.resolve(repoPath)) {
      throw new FolderGitSyncError(
        "repo-root-mismatch",
        "Configured folder is not the Git repository root."
      );
    }
  }

  private async configureOrigin(
    repoPath: string,
    remoteUrl: string
  ): Promise<void> {
    const existing = await this.gitProcess.runGit(
      repoPath,
      ["remote", "get-url", "origin"],
      { allowNonZeroExit: true }
    );

    if (existing.exitCode === 0) {
      if (existing.stdout.trim() !== remoteUrl) {
        await this.gitProcess.runGit(repoPath, [
          "remote",
          "set-url",
          "origin",
          remoteUrl
        ]);
      }
      return;
    }

    await this.gitProcess.runGit(repoPath, ["remote", "add", "origin", remoteUrl]);
  }

  private async applyLocalAuthorConfig(
    repoPath: string,
    mapping: FolderMappingSettings
  ): Promise<void> {
    if (mapping.authorName && mapping.authorEmail) {
      await this.gitProcess.runGit(repoPath, [
        "config",
        "user.name",
        mapping.authorName
      ]);
      await this.gitProcess.runGit(repoPath, [
        "config",
        "user.email",
        mapping.authorEmail
      ]);
    }
  }

  private async assertRepoReadyForWrite(
    repoPath: string,
    status: RepoStatus,
    expectedBranch: string
  ): Promise<void> {
    await this.assertRepoReadyForNetwork(repoPath, status, expectedBranch);

    if (status.hasConflicts) {
      throw new FolderGitSyncError(
        "conflicts-present",
        "Commit blocked: repository has unresolved conflicts."
      );
    }
  }

  private async assertRepoReadyForNetwork(
    repoPath: string,
    status: RepoStatus,
    expectedBranch: string
  ): Promise<void> {
    const inProgressState = await this.detectInProgressState(repoPath);
    if (inProgressState) {
      throw new FolderGitSyncError(
        "repo-busy",
        `Sync blocked: ${inProgressState}`
      );
    }

    if (status.branch !== expectedBranch) {
      throw new FolderGitSyncError(
        "branch-mismatch",
        `Configured branch is ${expectedBranch}, but the repo is currently on ${status.branch}.`
      );
    }
  }

  private async assertRepoReadyForSync(
    repoPath: string,
    status: RepoStatus,
    expectedBranch: string
  ): Promise<void> {
    await this.assertRepoReadyForNetwork(repoPath, status, expectedBranch);

    if (!status.clean) {
      throw new FolderGitSyncError(
        "dirty-worktree",
        "Sync blocked: working tree is dirty. Commit, stash, or discard local changes first."
      );
    }
  }

  private async detectInProgressState(
    repoPath: string
  ): Promise<string | undefined> {
    const gitDir = await this.resolveGitDir(repoPath);
    const checks: Array<[string, string]> = [
      ["rebase-merge", "rebase in progress"],
      ["rebase-apply", "rebase in progress"],
      ["MERGE_HEAD", "merge in progress"],
      ["CHERRY_PICK_HEAD", "cherry-pick in progress"],
      ["REVERT_HEAD", "revert in progress"]
    ];

    for (const [relativePath, label] of checks) {
      if (await pathExists(path.join(gitDir, relativePath))) {
        return label;
      }
    }

    return undefined;
  }

  private async resolveGitDir(repoPath: string): Promise<string> {
    const result = await this.gitProcess.runGit(repoPath, [
      "rev-parse",
      "--git-dir"
    ]);

    return path.resolve(repoPath, result.stdout.trim());
  }

  private async hasHeadCommit(repoPath: string): Promise<boolean> {
    const result = await this.gitProcess.runGit(
      repoPath,
      ["rev-parse", "--verify", "HEAD"],
      { allowNonZeroExit: true }
    );

    return result.exitCode === 0;
  }

  private describeLocalAuthState(
    mapping: FolderMappingSettings,
    readiness: Awaited<ReturnType<AuthDetector["checkLocalReadiness"]>>
  ): string {
    if (!readiness.gitAvailable) {
      return "Git was not found in PATH.";
    }

    if (!readiness.sshAvailable) {
      return "SSH was not found in PATH.";
    }

    const remoteValidation = validateRemoteUrl(mapping.remoteUrl);
    if (!remoteValidation.valid) {
      return remoteValidation.message ?? "Remote URL needs attention.";
    }

    return "Local Git and SSH detected. Run diagnostics to verify the SSH remote.";
  }
}

function uniquePaths(candidatePaths: readonly string[]): string[] {
  return [...new Set(candidatePaths.map((value) => assertSafeRepoRelativePath(value)))];
}

function buildReviewWarnings(
  suspicious: readonly SecretFinding[],
  blocked: readonly SecretFinding[],
  inProgressState: string | undefined
): string[] {
  const warnings: string[] = [];

  if (inProgressState) {
    warnings.push(`Repository state warning: ${inProgressState}.`);
  }

  if (blocked.length > 0) {
    warnings.push("Blocked file patterns matched one or more changed files.");
  }

  if (suspicious.length > 0) {
    warnings.push("Suspicious secret-like files were detected in the working tree.");
  }

  return warnings;
}

function formatSecretDiagnostics(result: {
  suspicious: SecretFinding[];
  blocked: SecretFinding[];
  truncated?: boolean | undefined;
}): string {
  const segments: string[] = [];

  if (result.suspicious.length === 0 && result.blocked.length === 0) {
    return "No obvious risky files detected.";
  }

  if (result.suspicious.length > 0) {
    segments.push(
      `Suspicious: ${result.suspicious.map((item) => item.path).join(", ")}`
    );
  }

  if (result.blocked.length > 0) {
    segments.push(`Blocked: ${result.blocked.map((item) => item.path).join(", ")}`);
  }

  if (result.truncated) {
    segments.push("Scan truncated after the file limit.");
  }

  return segments.join(" | ");
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await access(candidatePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
