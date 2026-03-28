import { redactSensitiveText } from "../security/redaction.ts";

export class FolderGitSyncError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly details: string | undefined;

  public constructor(
    code: string,
    userMessage: string,
    details?: string,
    cause?: unknown
  ) {
    super(userMessage, cause ? { cause } : undefined);
    this.name = "FolderGitSyncError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}

export function sanitizeErrorDetail(detail: string | undefined): string {
  return redactSensitiveText((detail ?? "").trim());
}

export function toUserMessage(
  error: unknown,
  fallback = "An unexpected error occurred."
): string {
  if (error instanceof FolderGitSyncError) {
    return error.userMessage;
  }

  if (error instanceof Error && error.message.trim()) {
    return sanitizeErrorDetail(error.message);
  }

  return fallback;
}

export function toUserDetail(error: unknown): string | undefined {
  if (error instanceof FolderGitSyncError) {
    return sanitizeErrorDetail(error.details);
  }

  if (error instanceof Error) {
    return sanitizeErrorDetail(error.stack ?? error.message);
  }

  return undefined;
}
