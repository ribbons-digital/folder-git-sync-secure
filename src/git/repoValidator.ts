import type { RemoteValidationResult } from "../types.ts";

const HTTPS_REMOTE_PATTERN = /^(https?:\/\/|git:\/\/)/i;
const SSH_SCP_PATTERN =
  /^git@(?<host>[A-Za-z0-9.-]+):(?<owner>[A-Za-z0-9._-]+)\/(?<repository>[A-Za-z0-9._-]+?)(?:\.git)?$/;
const SSH_URL_PATTERN =
  /^ssh:\/\/git@(?<host>[A-Za-z0-9.-]+)(?::(?<port>\d+))?\/(?<owner>[A-Za-z0-9._-]+)\/(?<repository>[A-Za-z0-9._-]+?)(?:\.git)?$/i;
const ALLOWED_SSH_HOSTS = new Set(["github.com"]);

function validateSupportedHost(
  host: string,
  owner: string,
  repository: string,
  port?: string
): RemoteValidationResult {
  if (!ALLOWED_SSH_HOSTS.has(host.toLowerCase())) {
    return {
      valid: false,
      protocol: "ssh",
      host,
      owner,
      repository,
      port,
      message: "Only github.com is supported in v1. Use a github.com SSH remote."
    };
  }

  return {
    valid: true,
    protocol: "ssh",
    host,
    owner,
    repository,
    port
  };
}

export function validateRemoteUrl(remoteUrl: string): RemoteValidationResult {
  const trimmed = remoteUrl.trim();

  if (!trimmed) {
    return {
      valid: false,
      protocol: "unknown",
      message: "Remote URL is required."
    };
  }

  if (HTTPS_REMOTE_PATTERN.test(trimmed)) {
    return {
      valid: false,
      protocol: "https",
      message: "HTTPS remotes are not supported in v1. Use an SSH remote."
    };
  }

  const scpMatch = trimmed.match(SSH_SCP_PATTERN);

  if (scpMatch?.groups) {
    const host = scpMatch.groups.host;
    const owner = scpMatch.groups.owner;
    const repository = scpMatch.groups.repository;
    if (!host || !owner || !repository) {
      return {
        valid: false,
        protocol: "unknown",
        message:
          "Unsupported remote format. Use an SSH remote such as git@github.com:owner/repo.git."
      };
    }

    return validateSupportedHost(
      host,
      owner,
      repository
    );
  }

  const sshUrlMatch = trimmed.match(SSH_URL_PATTERN);

  if (sshUrlMatch?.groups) {
    const host = sshUrlMatch.groups.host;
    const owner = sshUrlMatch.groups.owner;
    const repository = sshUrlMatch.groups.repository;
    if (!host || !owner || !repository) {
      return {
        valid: false,
        protocol: "unknown",
        message:
          "Unsupported remote format. Use an SSH remote such as git@github.com:owner/repo.git."
      };
    }

    return validateSupportedHost(
      host,
      owner,
      repository,
      sshUrlMatch.groups.port
    );
  }

  return {
    valid: false,
    protocol: "unknown",
    message:
      "Unsupported remote format. Use an SSH remote such as git@github.com:owner/repo.git."
  };
}

export function isSupportedSshRemote(remoteUrl: string): boolean {
  return validateRemoteUrl(remoteUrl).valid;
}
