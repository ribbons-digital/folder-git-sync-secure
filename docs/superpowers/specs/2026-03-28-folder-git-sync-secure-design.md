# Folder Git Sync Secure Design

## Goal

Build a desktop-only Obsidian plugin that lets a user bind one or more vault-relative folders to separate SSH Git remotes and run transparent, local Git operations without storing credentials or calling the GitHub API.

## Constraints

- SSH remotes only. HTTPS remotes are rejected with a clear user-facing error.
- No secret storage, token flows, GitHub API calls, telemetry, or hidden network traffic.
- Git subprocesses must be centralized, shell-free, and path-validated before every call.
- Repository scope is always the configured folder root, never a parent folder or implicit vault root.
- v1 favors manual review and conservative failure over automation.

## Recommended Approach

Use a small service-oriented plugin with three boundaries:

1. Security and parsing modules: canonical path guards, remote validation, secret scanning, redaction, status parsing.
2. Git orchestration: one audited subprocess wrapper plus a Git service that exposes safe repo actions and diagnostics.
3. Obsidian integration: settings, modals, status/diagnostics views, commands, and a queued auto-sync coordinator.

This keeps risky behavior concentrated in a small surface and leaves most logic unit-testable.

## Key Tradeoffs

- Auto-sync is opt-in and remains conservative. If safe mode is enabled, unattended auto-commit is skipped instead of bypassing manual review.
- Staging review is supported in-plugin, but conflict resolution remains external to keep v1 narrow and auditable.
- Symlinked configured repo roots are rejected in v1. This is stricter, but it prevents path confusion and parent-directory escape risks.

## Data Model

Each folder mapping stores:

- Stable mapping id
- Vault-relative folder path
- SSH remote URL
- Branch name
- Commit message template
- Auto-sync enabled flag
- Auto-sync debounce milliseconds
- Safe mode flag
- Blocked file patterns
- Optional local Git `user.name` / `user.email` override
- Last sync timestamp
- Last error summary
- Last auth-readiness summary

## UI Shape

- Settings tab manages global defaults and per-folder mappings.
- Status view shows one card per folder with counts, branch, remote, last sync, last error, and auth state.
- Diagnostics view renders a human-readable report for every configured folder.
- Review/commit modal shows changed files, suspicious-file warnings, manual staging controls, and commit confirmation.

## Testing Scope

Unit-test the pure modules first:

- Path normalization and traversal rejection
- Remote validation and HTTPS rejection
- Secret scanner heuristics and blocked-pattern matching
- Redaction helpers
- Git status porcelain parsing

The Obsidian UI and subprocess wiring are verified through manual test steps documented in the repo.
