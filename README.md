# Folder Git Sync Secure

Folder Git Sync Secure is a desktop-only Obsidian plugin that syncs one or more selected vault folders to separate Git repositories over SSH.

## What v1 is

- Desktop-only
- SSH-only
- Local Git wrapper, not a Git hosting client
- Manual-first and audit-friendly
- No telemetry

## What v1 is not

- No GitHub API usage
- No repo creation through the plugin
- No PAT or password support
- No HTTPS auth flows
- No plaintext secret storage
- No mobile support

## Security Summary

- This plugin does not store credentials.
- This plugin does not use the GitHub API.
- Git and SSH must already be configured on the machine outside the plugin.
- Only `github.com` SSH remotes are supported in v1.

Supported remote examples:

- `git@github.com:owner/repo.git`
- `ssh://git@github.com/owner/repo.git`

Unsupported examples:

- `https://github.com/owner/repo.git`
- `https://user:token@github.com/owner/repo.git`
- `git@other-host.example:owner/repo.git`
- Any remote that embeds secrets

## Folder-Scoped Repository Model

Each configured folder is treated as its own repository root.

Example:

- `/Projects/Alpha` -> `git@github.com:owner/alpha.git`
- `/Research/Notes` -> `git@github.com:owner/research-notes.git`

The plugin never runs Git from the vault root unless the configured mapping is the root itself. It also rejects path traversal and symlinked configured repo roots in v1.

## Features

- Add and remove secure Git folder mappings
- Initialize a folder as a Git repo if needed
- Set or update `origin`
- Show branch, clean/dirty state, and ahead/behind when available
- Show untracked, staged, and modified counts
- Pull, push, commit, and sync
- Run human-readable diagnostics
- Review staged and unstaged files before committing
- Detect suspicious secret-like filenames before commit
- Optional per-folder local Git author override through normal Git config
- Opt-in auto-sync with debounce, per-repo queueing, and backoff

## Build Instructions

1. Install dependencies:

```bash
npm install
```

2. Build the plugin:

```bash
npm run build
```

3. Copy these files into your Obsidian plugin folder:

- `manifest.json`
- `main.js`
- `styles.css`

During development you can use:

```bash
npm run dev
```

## Setup Example

Initialize and configure a repo outside Obsidian first if you prefer:

```bash
cd "/path/to/YourVault/Projects/Alpha"
git init
git branch -M main
git remote add origin git@github.com:owner/alpha.git
ssh -T git@github.com
```

Then in Obsidian:

1. Open `Add folder to secure Git sync`
2. Pick `Projects/Alpha`
3. Enter `git@github.com:owner/alpha.git`
4. Review branch, commit template, safe mode, and blocked patterns
5. Open the status panel and use `Commit`, `Pull`, `Push`, or `Sync`

## Commands

- `Add folder to secure Git sync`
- `Remove folder from secure Git sync`
- `Open sync status panel`
- `Commit folder`
- `Pull folder`
- `Push folder`
- `Sync folder`
- `Run diagnostics`
- `Open staged file review`

## Diagnostics

`Run diagnostics` reports, for each configured folder:

- whether Git is installed
- Git version
- whether the folder path is valid
- whether the folder is already a Git repo
- whether the remote is present
- whether the remote is SSH GitHub-style
- whether SSH appears available
- whether a read-only remote check succeeds
- whether obvious secret-risk files are present
- whether merge or rebase state is active
- whether the working tree is dirty

## Troubleshooting

### “HTTPS remotes are not supported in v1. Use an SSH remote.”

Update the mapping to use an SSH remote such as `git@github.com:owner/repo.git`.

### “Git was not found in PATH.”

Install Git and make sure Obsidian inherits a shell environment where `git --version` works.

### “SSH remote check failed. Verify your SSH key and GitHub SSH setup.”

This plugin does not manage GitHub credentials. Test SSH outside Obsidian first:

```bash
ssh -T git@github.com
git ls-remote git@github.com:owner/repo.git
```

### “Sync blocked: repository has unresolved conflicts.”

Resolve the conflict outside the plugin, complete or abort the merge/rebase, then retry.

### “Commit blocked: suspicious secret-like files detected.”

Review the flagged files, update `.gitignore` or blocked patterns, and only proceed if you explicitly intend to commit them.

## Known Limitations

- Desktop only
- SSH only
- No GitHub API integrations
- No automated conflict resolution
- No branch switching UI
- Safe mode blocks unattended auto-commit behavior
- Symlinked configured repo roots are rejected in v1

## Minimal Test Plan

Automated:

- Run `npm test`

Manual:

1. Add a folder mapping with a valid SSH remote.
2. Confirm repo initialization occurs inside the mapped folder only.
3. Modify files and review the staged file modal in safe mode.
4. Verify `.env` or `id_ed25519` filenames trigger warnings.
5. Run `Pull`, `Push`, and `Sync` on a clean repo.
6. Start a rebase or merge outside the plugin and confirm the plugin blocks sync.
7. Enable auto-sync with safe mode off and confirm debounced commits and syncs occur one repo at a time.
