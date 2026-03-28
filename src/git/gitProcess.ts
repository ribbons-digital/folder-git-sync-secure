import { spawn } from "node:child_process";
import process from "node:process";
import { redactSensitiveText } from "../security/redaction.ts";
import type { GitProcessResult } from "../types.ts";
import { FolderGitSyncError } from "../utils/errors.ts";
import { PluginLogger } from "../utils/logger.ts";

export interface RunCommandOptions {
  binary: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  allowNonZeroExit?: boolean;
  env?: NodeJS.ProcessEnv;
  stdinText?: string;
}

export class GitProcess {
  private readonly logger: PluginLogger;

  public constructor(logger: PluginLogger) {
    this.logger = logger;
  }

  public async runGit(
    cwd: string,
    args: string[],
    options: Omit<RunCommandOptions, "binary" | "args" | "cwd"> = {}
  ): Promise<GitProcessResult> {
    return this.run({
      binary: "git",
      args,
      cwd,
      ...options,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        ...options.env
      }
    });
  }

  public async runSsh(
    args: string[],
    cwd = process.cwd(),
    options: Omit<RunCommandOptions, "binary" | "args" | "cwd"> = {}
  ): Promise<GitProcessResult> {
    return this.run({
      binary: "ssh",
      args,
      cwd,
      ...options
    });
  }

  public run(options: RunCommandOptions): Promise<GitProcessResult> {
    if (!options.cwd.trim()) {
      throw new FolderGitSyncError(
        "missing-cwd",
        "Internal error: subprocess cwd was not set."
      );
    }

    this.logger.debug(
      `Running ${options.binary} ${options.args.map((value) => redactSensitiveText(value)).join(" ")}`
    );

    return new Promise((resolve, reject) => {
      const subprocess = spawn(options.binary, options.args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeoutMs = options.timeoutMs ?? 30000;
      const timer = setTimeout(() => {
        timedOut = true;
        subprocess.kill("SIGTERM");
      }, timeoutMs);

      subprocess.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      subprocess.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      subprocess.once("error", (error) => {
        clearTimeout(timer);
        reject(
          new FolderGitSyncError(
            "subprocess-failed",
            `${options.binary} could not be started.`,
            redactSensitiveText(error.message),
            error
          )
        );
      });

      subprocess.once("close", (exitCode) => {
        clearTimeout(timer);

        if (timedOut) {
          reject(
            new FolderGitSyncError(
              "subprocess-timeout",
              `${options.binary} timed out after ${timeoutMs}ms.`,
              redactSensitiveText(stderr || stdout)
            )
          );
          return;
        }

        const result: GitProcessResult = {
          command: options.binary,
          args: [...options.args],
          cwd: options.cwd,
          exitCode: exitCode ?? 0,
          stdout,
          stderr
        };

        if (result.exitCode !== 0 && !options.allowNonZeroExit) {
          reject(
            new FolderGitSyncError(
              "subprocess-exit",
              `${options.binary} exited with code ${result.exitCode}.`,
              redactSensitiveText(stderr || stdout)
            )
          );
          return;
        }

        resolve(result);
      });

      if (options.stdinText !== undefined) {
        subprocess.stdin.write(options.stdinText);
      }

      subprocess.stdin.end();
    });
  }
}
