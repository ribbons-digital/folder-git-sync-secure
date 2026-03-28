import path from "node:path";
import { readdir } from "node:fs/promises";
import type { SecretFinding, SecretScanResult } from "../types.ts";

interface SuspiciousRule {
  rule: string;
  reason: string;
  matches: (normalizedPath: string) => boolean;
}

export const DEFAULT_BLOCKED_FILE_PATTERNS = [
  ".obsidian/plugins/folder-git-sync-secure/**"
];

export const RECOMMENDED_GITIGNORE_TEMPLATE = `# Folder Git Sync Secure
.obsidian/plugins/folder-git-sync-secure/data.json
.obsidian/workspace*.json

# Secrets and auth material
.env
.env.*
*.pem
*.key
id_rsa
id_ed25519
.git-credentials
`;

const SUSPICIOUS_RULES: SuspiciousRule[] = [
  {
    rule: ".env",
    reason: "Environment files often contain secrets.",
    matches: (value) => {
      const base = path.posix.basename(value);
      return base === ".env" || base.startsWith(".env.");
    }
  },
  {
    rule: "*.pem",
    reason: "PEM files often contain private keys or certificates.",
    matches: (value) => value.endsWith(".pem")
  },
  {
    rule: "*.key",
    reason: "Key files can contain private credentials.",
    matches: (value) => value.endsWith(".key")
  },
  {
    rule: "id_rsa",
    reason: "Likely private SSH key.",
    matches: (value) => path.posix.basename(value) === "id_rsa"
  },
  {
    rule: "id_ed25519",
    reason: "Likely private SSH key.",
    matches: (value) => path.posix.basename(value) === "id_ed25519"
  },
  {
    rule: ".git-credentials",
    reason: "Git credential store file detected.",
    matches: (value) => path.posix.basename(value) === ".git-credentials"
  },
  {
    rule: "auth-dump",
    reason: "Auth dump naming pattern detected.",
    matches: (value) =>
      /(^|\/)auth[-_. ]?dump/i.test(value) || /token[-_. ]?export/i.test(value)
  }
];

export function matchesBlockedPattern(
  candidatePath: string,
  blockedPatterns: readonly string[]
): boolean {
  const normalizedPath = normalizeRelativePath(candidatePath);

  return blockedPatterns.some((pattern) =>
    globToRegExp(normalizeRelativePath(pattern)).test(normalizedPath)
  );
}

export function scanPathsForSecrets(
  candidatePaths: readonly string[],
  blockedPatterns: readonly string[] = []
): SecretScanResult {
  const suspicious: SecretFinding[] = [];
  const blocked: SecretFinding[] = [];

  for (const candidatePath of candidatePaths) {
    const normalizedPath = normalizeRelativePath(candidatePath);

    if (!normalizedPath || normalizedPath.startsWith(".git/")) {
      continue;
    }

    const suspiciousRule = SUSPICIOUS_RULES.find((rule) =>
      rule.matches(normalizedPath)
    );

    if (suspiciousRule) {
      suspicious.push({
        path: normalizedPath,
        kind: "suspicious",
        rule: suspiciousRule.rule,
        reason: suspiciousRule.reason
      });
    }

    if (matchesBlockedPattern(normalizedPath, blockedPatterns)) {
      blocked.push({
        path: normalizedPath,
        kind: "blocked",
        rule: "blocked-pattern",
        reason: "Path matches a blocked pattern for this mapping."
      });
    }
  }

  return { suspicious, blocked };
}

export async function scanRepositoryForSecrets(
  repoRootPath: string,
  blockedPatterns: readonly string[] = [],
  limit = 2000
): Promise<SecretScanResult> {
  const queue = [""];
  const files: string[] = [];
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    const absolute = path.join(repoRootPath, current);
    const entries = await readdir(absolute, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }

      const relativePath = normalizeRelativePath(
        current ? path.posix.join(current, entry.name) : entry.name
      );

      if (entry.isDirectory()) {
        queue.push(relativePath);
        continue;
      }

      files.push(relativePath);

      if (files.length >= limit) {
        truncated = true;
        queue.length = 0;
        break;
      }
    }
  }

  return {
    ...scanPathsForSecrets(files, blockedPatterns),
    truncated
  };
}

function normalizeRelativePath(input: string): string {
  return input.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/");
  let expression = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (character === "*") {
      if (normalized[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
      continue;
    }

    expression += escapeRegexCharacter(character ?? "");
  }

  expression += "$";
  return new RegExp(expression);
}

function escapeRegexCharacter(character: string): string {
  return /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character;
}
