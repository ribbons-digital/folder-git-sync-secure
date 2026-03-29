import { randomBytes, randomUUID as nodeRandomUUID } from "node:crypto";
import { normalizeVaultFolderPath } from "./security/pathGuards.ts";
import {
  DEFAULT_BLOCKED_FILE_PATTERNS,
  RECOMMENDED_GITIGNORE_TEMPLATE
} from "./security/secretScanner.ts";
import { validateRemoteUrl } from "./git/repoValidator.ts";
import type {
  FolderMappingPatch,
  FolderGitSyncSettings,
  FolderMappingSettings
} from "./types.ts";

export const DEFAULT_BRANCH = "main";
export const DEFAULT_COMMIT_MESSAGE_TEMPLATE =
  "vault sync: {{folderName}} {{timestamp}}";

function normalizePeriodicPullIntervalSeconds(
  value: unknown
): number {
  const fallback = DEFAULT_SETTINGS.periodicPullIntervalSeconds;
  const normalized =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return Math.max(0, Math.floor(normalized));
}

function generateMappingId(): string {
  const browserCrypto = globalThis.crypto;
  if (browserCrypto && typeof browserCrypto.randomUUID === "function") {
    try {
      return browserCrypto.randomUUID();
    } catch {
      // Fall back to Node generation when the runtime exposes a partial crypto API.
    }
  }

  try {
    return nodeRandomUUID();
  } catch {
    return randomBytes(16).toString("hex");
  }
}

export const DEFAULT_SETTINGS: FolderGitSyncSettings = {
  mappings: [],
  defaultSafeMode: true,
  defaultAutoSync: false,
  defaultAutoSyncDebounceMs: 15000,
  defaultBlockedFilePatterns: [...DEFAULT_BLOCKED_FILE_PATTERNS],
  defaultGitIgnoreTemplate: RECOMMENDED_GITIGNORE_TEMPLATE,
  periodicPullEnabled: false,
  periodicPullIntervalSeconds: 86400,
  logLevel: "warn"
};

export function createDefaultMapping(
  folderPath: string
): FolderMappingSettings {
  return {
    id: generateMappingId(),
    folderPath: normalizeVaultFolderPath(folderPath),
    remoteUrl: "",
    branch: DEFAULT_BRANCH,
    commitMessageTemplate: DEFAULT_COMMIT_MESSAGE_TEMPLATE,
    autoSync: DEFAULT_SETTINGS.defaultAutoSync,
    autoSyncDebounceMs: DEFAULT_SETTINGS.defaultAutoSyncDebounceMs,
    safeMode: DEFAULT_SETTINGS.defaultSafeMode,
    blockedFilePatterns: [...DEFAULT_SETTINGS.defaultBlockedFilePatterns]
  };
}

export function normalizeSettings(
  input: Partial<FolderGitSyncSettings> | null | undefined
): FolderGitSyncSettings {
  const mappings = Array.isArray(input?.mappings) ? input.mappings : [];

  return {
    mappings: mappings.map((mapping) => normalizeMapping(mapping)),
    defaultSafeMode: input?.defaultSafeMode ?? DEFAULT_SETTINGS.defaultSafeMode,
    defaultAutoSync:
      input?.defaultAutoSync ?? DEFAULT_SETTINGS.defaultAutoSync,
    defaultAutoSyncDebounceMs:
      input?.defaultAutoSyncDebounceMs ??
      DEFAULT_SETTINGS.defaultAutoSyncDebounceMs,
    defaultBlockedFilePatterns:
      input?.defaultBlockedFilePatterns?.length
        ? [...input.defaultBlockedFilePatterns]
        : [...DEFAULT_SETTINGS.defaultBlockedFilePatterns],
    defaultGitIgnoreTemplate:
      input?.defaultGitIgnoreTemplate ??
      DEFAULT_SETTINGS.defaultGitIgnoreTemplate,
    periodicPullEnabled: input?.periodicPullEnabled === true,
    periodicPullIntervalSeconds: normalizePeriodicPullIntervalSeconds(
      input?.periodicPullIntervalSeconds
    ),
    logLevel: input?.logLevel ?? DEFAULT_SETTINGS.logLevel
  };
}

export function normalizeMapping(
  mapping: FolderMappingPatch | null | undefined
): FolderMappingSettings {
  const defaults = createDefaultMapping(mapping?.folderPath ?? "");
  const remoteUrl = (mapping?.remoteUrl ?? "").trim();
  const remoteValidation = remoteUrl ? validateRemoteUrl(remoteUrl) : null;
  const sanitizedRemoteUrl = remoteValidation?.valid ? remoteUrl : "";
  const remoteClearMessage =
    remoteUrl && remoteValidation && !remoteValidation.valid
      ? `Stored remote was cleared. ${remoteValidation.message ?? "Remote URL is invalid for v1."}`
      : undefined;

  return {
    ...defaults,
    ...mapping,
    id: mapping?.id ?? defaults.id,
    folderPath: normalizeVaultFolderPath(mapping?.folderPath ?? ""),
    remoteUrl: sanitizedRemoteUrl,
    branch: (mapping?.branch ?? defaults.branch).trim() || DEFAULT_BRANCH,
    commitMessageTemplate:
      mapping?.commitMessageTemplate?.trim() ||
      DEFAULT_COMMIT_MESSAGE_TEMPLATE,
    autoSync: mapping?.autoSync ?? defaults.autoSync,
    safeMode: mapping?.safeMode ?? defaults.safeMode,
    autoSyncDebounceMs: Math.max(
      1000,
      mapping?.autoSyncDebounceMs ?? defaults.autoSyncDebounceMs
    ),
    blockedFilePatterns:
      mapping?.blockedFilePatterns?.filter(Boolean) ??
      defaults.blockedFilePatterns,
    authorName: mapping?.authorName?.trim() || undefined,
    authorEmail: mapping?.authorEmail?.trim() || undefined,
    lastSyncTime: mapping?.lastSyncTime,
    lastError: remoteClearMessage ?? mapping?.lastError,
    lastAuthCheck: mapping?.lastAuthCheck
  };
}

export function renderCommitMessageTemplate(
  template: string,
  mapping: Pick<FolderMappingSettings, "folderPath" | "branch">,
  currentTime = new Date()
): string {
  const folderName =
    mapping.folderPath.split("/").filter(Boolean).at(-1) || "vault-root";
  const isoTimestamp = currentTime.toISOString();
  const date = isoTimestamp.slice(0, 10);

  return template
    .replaceAll("{{folderName}}", folderName)
    .replaceAll("{{branch}}", mapping.branch)
    .replaceAll("{{timestamp}}", isoTimestamp)
    .replaceAll("{{date}}", date);
}
