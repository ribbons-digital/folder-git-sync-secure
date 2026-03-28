import { redactSensitiveText } from "../security/redaction.ts";
import type { LogLevel } from "../types.ts";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

export class PluginLogger {
  private readonly scope: string;
  private readonly level: LogLevel;

  public constructor(
    scope: string,
    level: LogLevel
  ) {
    this.scope = scope;
    this.level = level;
  }

  public child(scope: string): PluginLogger {
    return new PluginLogger(`${this.scope}:${scope}`, this.level);
  }

  public error(message: string, detail?: unknown): void {
    this.write("error", message, detail);
  }

  public warn(message: string, detail?: unknown): void {
    this.write("warn", message, detail);
  }

  public info(message: string, detail?: unknown): void {
    this.write("info", message, detail);
  }

  public debug(message: string, detail?: unknown): void {
    this.write("debug", message, detail);
  }

  private write(level: LogLevel, message: string, detail?: unknown): void {
    if (LOG_LEVEL_ORDER[level] > LOG_LEVEL_ORDER[this.level]) {
      return;
    }

    const prefix = `[Folder Git Sync Secure][${this.scope}][${level}]`;
    const sanitizedMessage = redactSensitiveText(message);

    if (detail === undefined) {
      console[level](`${prefix} ${sanitizedMessage}`);
      return;
    }

    console[level](prefix, sanitizedMessage, sanitizeDetail(detail));
  }
}

function sanitizeDetail(detail: unknown): unknown {
  if (typeof detail === "string") {
    return redactSensitiveText(detail);
  }

  if (detail instanceof Error) {
    return {
      name: detail.name,
      message: redactSensitiveText(detail.message)
    };
  }

  return detail;
}
