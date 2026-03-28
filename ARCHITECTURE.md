# Folder Git Sync Secure Architecture

## Overview

Folder Git Sync Secure is a desktop-only Obsidian plugin that scopes Git operations to explicitly configured vault folders. Each configured folder is treated as the repository root for a separate SSH remote. The plugin intentionally avoids GitHub APIs, credential storage, HTTPS auth, and hidden network calls.

## Module Layout

- `main.ts`
  Plugin bootstrap, command registration, settings persistence, and view lifecycle.
- `src/types.ts`
  Shared data types for mappings, status, diagnostics, and secret findings.
- `src/settings.ts`
  Default settings, mapping normalization, and commit-template rendering.
- `src/settingsTab.ts`
  Obsidian settings UI for global defaults and per-folder mapping management.
- `src/git/gitProcess.ts`
  Single audited subprocess wrapper. Uses argument arrays only, explicit `cwd`, `shell: false`, and `GIT_TERMINAL_PROMPT=0`.
- `src/git/gitService.ts`
  High-level Git workflows: repo initialization, remote configuration, status, staging, commit, pull, push, sync, and diagnostics.
- `src/git/repoValidator.ts`
  SSH-only remote validation and HTTPS rejection.
- `src/git/authDetector.ts`
  Local Git/SSH readiness checks and read-only remote checks through `git ls-remote`.
- `src/git/statusParser.ts`
  Pure porcelain-v2 parser for branch metadata and working tree counts.
- `src/sync/syncManager.ts`
  Per-repo queue and exponential backoff.
- `src/sync/autoSync.ts`
  Debounced auto-sync coordinator. Safe mode disables unattended commit behavior.
- `src/security/pathGuards.ts`
  Vault-relative path normalization, traversal rejection, canonical path checks, and symlink rejection for configured repo roots.
- `src/security/secretScanner.ts`
  Secret-like filename heuristics, blocked-pattern matching, and recommended `.gitignore` helpers.
- `src/security/redaction.ts`
  Redaction helpers for logs and user-visible errors.
- `src/ui/statusView.ts`
  Status panel with per-folder actions and high-level health indicators.
- `src/ui/modals.ts`
  Folder selection, mapping creation, removal confirmation, and staged review/commit modal flows.
- `src/ui/diagnosticsView.ts`
  Human-readable diagnostics report view.
- `src/utils/errors.ts`
  User-facing error wrappers and sanitization helpers.
- `src/utils/logger.ts`
  Minimal sanitized logger.

## Safety Boundaries

### Subprocess Safety

- All Git and SSH subprocesses go through `src/git/gitProcess.ts`.
- Commands are built from argument arrays only.
- `shell: false` is always used.
- `cwd` is explicit for every subprocess.
- `GIT_TERMINAL_PROMPT=0` prevents hidden interactive credential prompts.

### Path Safety

- Configured folders are normalized as vault-relative paths.
- Parent traversal and absolute paths are rejected.
- Configured repo roots are resolved to canonical paths before use.
- Canonical paths must remain inside the canonical vault root.
- Symlinked configured repo roots are rejected in v1.
- Git commands are only run from the configured folder root.

### Secret Safety

- Suspicious filenames are detected before commit.
- Mapping-specific blocked patterns are enforced.
- Plugin config is included in the default blocked-pattern and `.gitignore` guidance.
- The plugin never stores tokens, passwords, or custom secrets.

## Command Flow

1. User selects or configures a mapping.
2. Plugin resolves the canonical repo path and validates the SSH remote.
3. Git availability and repo-root safety are checked.
4. High-level Git service methods run through the subprocess wrapper.
5. Results are surfaced in the status panel, diagnostics view, notices, and persisted mapping state.

## Auto-Sync Policy

- Auto-sync is opt-in.
- Each repo gets its own queue and backoff window.
- File change events are debounced per mapping.
- Safe mode blocks unattended commit behavior.
- Suspicious or blocked files stop auto-sync instead of being auto-staged.
- Auto-sync never resolves conflicts automatically.

## Known Architectural Limits in v1

- Conflict resolution is intentionally out of scope.
- Branch switching is not automated. The plugin expects the repo to already be on the configured branch.
- Review modal staging is conservative and focused on safety, not full Git UI parity.
