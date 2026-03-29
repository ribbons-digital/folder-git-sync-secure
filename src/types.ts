export type LogLevel = "error" | "warn" | "info" | "debug";

export interface AuthReadinessSummary {
  checkedAt: string;
  ok: boolean;
  summary: string;
}

export interface FolderMappingSettings {
  id: string;
  folderPath: string;
  remoteUrl: string;
  branch: string;
  commitMessageTemplate: string;
  autoSync: boolean;
  autoSyncDebounceMs: number;
  safeMode: boolean;
  blockedFilePatterns: string[];
  authorName?: string | undefined;
  authorEmail?: string | undefined;
  lastSyncTime?: string | undefined;
  lastError?: string | undefined;
  lastAuthCheck?: AuthReadinessSummary | undefined;
}

export interface FolderGitSyncSettings {
  mappings: FolderMappingSettings[];
  defaultSafeMode: boolean;
  defaultAutoSync: boolean;
  defaultAutoSyncDebounceMs: number;
  defaultBlockedFilePatterns: string[];
  defaultGitIgnoreTemplate: string;
  periodicPullEnabled: boolean;
  periodicPullIntervalSeconds: number;
  logLevel: LogLevel;
}

export type FolderMappingPatch = {
  [K in keyof FolderMappingSettings]?: FolderMappingSettings[K] | undefined;
};

export interface GitProcessResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RemoteValidationResult {
  valid: boolean;
  protocol: "ssh" | "https" | "unknown";
  host?: string | undefined;
  owner?: string | undefined;
  repository?: string | undefined;
  port?: string | undefined;
  message?: string | undefined;
}

export type WorkingTreeFileKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "unmerged";

export interface WorkingTreeFile {
  path: string;
  originalPath?: string | undefined;
  indexStatus: string;
  workTreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  kind: WorkingTreeFileKind;
}

export interface RepoStatus {
  branch: string;
  upstream?: string | undefined;
  ahead: number;
  behind: number;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  clean: boolean;
  hasConflicts: boolean;
  files: WorkingTreeFile[];
}

export interface SecretFinding {
  path: string;
  kind: "suspicious" | "blocked";
  rule: string;
  reason: string;
}

export interface SecretScanResult {
  suspicious: SecretFinding[];
  blocked: SecretFinding[];
  truncated?: boolean | undefined;
}

export interface DiagnosticsCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface DiagnosticsReport {
  folderPath: string;
  checks: DiagnosticsCheck[];
  guidance: string[];
}
