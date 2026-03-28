import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { FolderGitSyncError } from "../utils/errors.ts";

export interface ResolvedRepoPath {
  vaultRootPath: string;
  folderPath: string;
  absolutePath: string;
  canonicalPath: string;
}

export function normalizeVaultFolderPath(input: string): string {
  const trimmed = input.trim().replaceAll("\\", "/");

  if (!trimmed || trimmed === ".") {
    return "";
  }

  const withoutLeadingSlash = trimmed.replace(/^\/+/, "");
  const normalized = path.posix.normalize(withoutLeadingSlash);

  return normalized === "." ? "" : normalized.replace(/\/$/, "");
}

export function assertSafeVaultFolderPath(input: string): string {
  const trimmed = input.trim();

  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/")) {
    throw new FolderGitSyncError(
      "unsafe-folder-path",
      "Folder path must be vault-relative."
    );
  }

  const normalized = normalizeVaultFolderPath(input);

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new FolderGitSyncError(
      "path-traversal",
      "Folder path contains blocked traversal segments."
    );
  }

  return normalized;
}

export function assertSafeRepoRelativePath(input: string): string {
  const normalized = normalizeRepoRelativePath(input);

  if (
    !normalized ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new FolderGitSyncError(
      "unsafe-repo-path",
      "Repository-relative path contains blocked traversal segments."
    );
  }

  return normalized;
}

export function normalizeRepoRelativePath(input: string): string {
  return input.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}

export function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(
    path.resolve(rootPath),
    path.resolve(candidatePath)
  );

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveCanonicalRepoPath(
  vaultRootPath: string,
  folderPath: string
): Promise<ResolvedRepoPath> {
  const safeFolderPath = assertSafeVaultFolderPath(folderPath);
  const lexicalVaultRoot = path.resolve(vaultRootPath);
  const lexicalRepoPath = path.resolve(lexicalVaultRoot, safeFolderPath || ".");
  const canonicalVaultRoot = await realpath(lexicalVaultRoot);

  if (!isPathInsideRoot(canonicalVaultRoot, lexicalRepoPath)) {
    throw new FolderGitSyncError(
      "repo-outside-vault",
      "Configured folder resolves outside the vault root."
    );
  }

  const stats = await lstat(lexicalRepoPath);

  if (!stats.isDirectory()) {
    throw new FolderGitSyncError(
      "not-a-directory",
      "Configured folder is not a directory."
    );
  }

  if (stats.isSymbolicLink()) {
    throw new FolderGitSyncError(
      "symlinked-root",
      "Symlinked repo roots are not supported in v1."
    );
  }

  const canonicalRepoPath = await realpath(lexicalRepoPath);

  if (!isPathInsideRoot(canonicalVaultRoot, canonicalRepoPath)) {
    throw new FolderGitSyncError(
      "symlink-escape",
      "Configured folder resolves outside the vault root."
    );
  }

  if (canonicalRepoPath !== lexicalRepoPath) {
    throw new FolderGitSyncError(
      "symlinked-root",
      "Configured repo roots must not traverse symlinks in v1."
    );
  }

  return {
    vaultRootPath: canonicalVaultRoot,
    folderPath: safeFolderPath,
    absolutePath: lexicalRepoPath,
    canonicalPath: canonicalRepoPath
  };
}
