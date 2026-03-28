# Security Policy

## Threat Model

Folder Git Sync Secure assumes:

- The user controls the local machine and Obsidian vault.
- Git and SSH are already installed and configured by the user.
- The plugin may encounter risky files, invalid paths, unsupported remotes, or broken local Git state.
- The plugin must not widen the machine’s credential exposure or silently move data to unexpected destinations.

## Security Goals

- Never store or manage secrets on behalf of the user.
- Restrict network behavior to normal Git-over-SSH operations initiated by the user against supported `github.com` remotes.
- Prevent Git commands from escaping the configured folder root.
- Make commit and sync behavior explicit, inspectable, and conservative.

## Explicit Non-Goals

- Managing GitHub accounts or authentication
- Creating repositories through the GitHub API
- Supporting HTTPS and token-based flows
- Supporting arbitrary SSH Git hosts in this v1 build
- Resolving merge conflicts automatically
- Acting as a full Git client replacement

## Why HTTPS and Token Auth Are Omitted in v1

HTTPS Git flows usually imply credential prompts, credential helpers, PAT handling, or embedded secrets in remote URLs. Those paths materially increase the secret-handling surface. v1 intentionally excludes them so the plugin can remain audit-friendly and avoid introducing a custom credential-management subsystem.

## Why Plaintext Token Storage Is Rejected

Plaintext token storage in plugin settings, local config files, or custom vaults would create long-lived secret material inside the vault or Obsidian plugin directory. That is explicitly out of scope for this plugin. The plugin does not store PATs, passwords, or `.git-credentials`.

## Subprocess Safety Policy

- All Git and SSH subprocesses must flow through the single wrapper in `src/git/gitProcess.ts`.
- Commands are constructed with argument arrays only.
- `shell: false` is always used.
- `cwd` is explicit for every subprocess.
- `GIT_TERMINAL_PROMPT=0` is set for Git operations to avoid hidden interactive auth prompts.
- Errors are sanitized before being shown or logged.

## Path Safety Policy

- Folder mappings are vault-relative.
- Absolute paths and parent traversal are rejected.
- Configured repo roots are resolved to canonical paths before use.
- Canonical repo roots must stay inside the canonical vault root.
- The plugin never runs Git from a parent directory of the configured folder.
- Symlinked configured repo roots are rejected in v1 as the safer policy.

## Logging and Redaction Policy

- Logging is minimal and sanitized.
- Remote URLs are redacted if they include userinfo or secret-like material.
- Bearer tokens and GitHub PAT-like strings are redacted from text before logging or display.
- The plugin avoids logging full secrets, passwords, or credential-bearing URLs.

## Secret and Risky File Protection

The plugin warns or blocks when it sees obvious secret-risk filenames such as:

- `.env`
- `.env.*`
- `*.pem`
- `*.key`
- `id_rsa`
- `id_ed25519`
- `.git-credentials`
- `auth-dump` style files
- token export style files

Per-mapping blocked file patterns provide an additional denylist that prevents plugin commits from staging or committing those files.

## Vulnerability Disclosure

If you find a security issue:

1. Do not publish working exploit details immediately.
2. Report the issue privately to the maintainers.
3. Include reproduction steps, affected versions, and impact.
4. Allow time for triage and a fix before public disclosure.
