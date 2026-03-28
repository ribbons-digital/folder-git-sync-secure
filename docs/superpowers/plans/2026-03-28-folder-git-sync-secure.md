# Folder Git Sync Secure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-quality Obsidian desktop plugin that safely maps vault folders to SSH Git remotes and exposes audited Git workflows.

**Architecture:** Pure validation/parsing modules sit underneath a single subprocess wrapper and Git service. Obsidian UI layers call those services through explicit commands, views, and queued sync orchestration.

**Tech Stack:** TypeScript, Obsidian plugin API, Node built-ins, esbuild, Node test runner with experimental type stripping

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.config.mjs`
- Create: `manifest.json`
- Create: `versions.json`
- Create: `.gitignore`

- [ ] Add minimal package metadata, build scripts, and strict TypeScript configuration.
- [ ] Add plugin manifest metadata with `isDesktopOnly: true`.
- [ ] Add versions manifest keyed by plugin version.

### Task 2: Security and Parsing Tests

**Files:**
- Create: `tests/security/pathGuards.test.js`
- Create: `tests/security/secretScanner.test.js`
- Create: `tests/security/redaction.test.js`
- Create: `tests/git/repoValidator.test.js`
- Create: `tests/git/statusParser.test.js`

- [ ] Write failing unit tests for vault-relative path validation, secret detection, redaction, remote validation, and porcelain parsing.
- [ ] Run `npm test` after implementations exist to verify the red-green cycle.

### Task 3: Pure Security and Parsing Modules

**Files:**
- Create: `src/types.ts`
- Create: `src/settings.ts`
- Create: `src/security/pathGuards.ts`
- Create: `src/security/secretScanner.ts`
- Create: `src/security/redaction.ts`
- Create: `src/git/repoValidator.ts`
- Create: `src/git/statusParser.ts`
- Create: `src/utils/errors.ts`
- Create: `src/utils/logger.ts`

- [ ] Implement canonical path guards and repo-relative path validation.
- [ ] Implement suspicious-file and blocked-pattern scanning.
- [ ] Implement redaction helpers for logs and user-facing error text.
- [ ] Implement SSH-only remote validation and porcelain status parsing.

### Task 4: Git Execution and Sync Core

**Files:**
- Create: `src/git/gitProcess.ts`
- Create: `src/git/authDetector.ts`
- Create: `src/git/gitService.ts`
- Create: `src/sync/syncManager.ts`
- Create: `src/sync/autoSync.ts`

- [ ] Implement one audited subprocess wrapper with explicit cwd and argument arrays only.
- [ ] Build diagnostics, repo initialization, commit, pull, push, sync, staging, and local author-config flows.
- [ ] Add one queue and exponential backoff policy per repo for manual and auto-sync jobs.

### Task 5: Obsidian UI Integration

**Files:**
- Create: `main.ts`
- Create: `src/settingsTab.ts`
- Create: `src/ui/statusView.ts`
- Create: `src/ui/modals.ts`
- Create: `src/ui/diagnosticsView.ts`
- Create: `styles.css`

- [ ] Implement settings management and per-folder commands.
- [ ] Add status and diagnostics views.
- [ ] Add review/commit and add/remove mapping modals.
- [ ] Wire conservative auto-sync lifecycle and view refreshes into the plugin entrypoint.

### Task 6: Documentation and Verification

**Files:**
- Create: `README.md`
- Create: `SECURITY.md`
- Create: `ARCHITECTURE.md`

- [ ] Document setup, security boundaries, supported and unsupported cases, and troubleshooting.
- [ ] Document the threat model, non-goals, subprocess safety, path safety, and redaction policy.
- [ ] Run available verification commands and report any commands that cannot run in this environment.
