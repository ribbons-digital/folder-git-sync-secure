const BEARER_TOKEN_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._-]+)\b/gi;
const GITHUB_PAT_PATTERN = /\bgh[pousr]_[A-Za-z0-9_]+\b/g;
const GITHUB_FINE_GRAINED_PATTERN = /\bgithub_pat_[A-Za-z0-9_]+\b/g;
const URL_CREDENTIAL_PATTERN =
  /(https?:\/\/)([^/@\s]+(?::[^@\s]*)?@)([^'"\s)]+)/gi;

export function redactRemoteUrl(remoteUrl: string): string {
  return remoteUrl.trim().replace(URL_CREDENTIAL_PATTERN, "$1***@$3");
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(URL_CREDENTIAL_PATTERN, "$1***@$3")
    .replace(BEARER_TOKEN_PATTERN, "$1[REDACTED]")
    .replace(GITHUB_FINE_GRAINED_PATTERN, "[REDACTED]")
    .replace(GITHUB_PAT_PATTERN, "[REDACTED]");
}
