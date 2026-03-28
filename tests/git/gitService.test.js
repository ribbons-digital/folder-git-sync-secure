const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const { GitService } = require("../../src/git/gitService.ts");

function createLogger() {
  return {
    warn() {},
    info() {},
    debug() {},
    error() {},
    child() {
      return this;
    }
  };
}

function createMapping(folderPath) {
  return {
    id: "mapping-1",
    folderPath,
    remoteUrl: "git@github.com:owner/repo.git",
    branch: "main",
    commitMessageTemplate: "vault sync: {{folderName}} {{timestamp}}",
    autoSync: false,
    autoSyncDebounceMs: 15000,
    safeMode: true,
    blockedFilePatterns: []
  };
}

function createApp(vaultPath) {
  return {
    vault: {
      adapter: {
        getBasePath() {
          return vaultPath;
        }
      }
    }
  };
}

test("getFolderStatus treats ancestor repositories as not initialized for the mapping", async () => {
  const vaultPath = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "fgss-status-"))
  );
  const folderPath = path.join(vaultPath, "Projects", "Alpha");
  await fs.mkdir(folderPath, { recursive: true });

  const gitProcess = {
    async runGit(cwd, args) {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return {
          command: "git",
          args,
          cwd,
          exitCode: 0,
          stdout: `${vaultPath}\n`,
          stderr: ""
        };
      }

      throw new Error(`Unexpected git invocation: ${args.join(" ")}`);
    }
  };

  const authDetector = {
    async checkLocalReadiness() {
      return {
        gitAvailable: true,
        gitVersion: "git version 2.48.0",
        sshAvailable: true,
        sshVersion: "OpenSSH_9.0"
      };
    },
    createFailureGuidance() {
      return [];
    }
  };

  const service = new GitService(
    createApp(vaultPath),
    gitProcess,
    authDetector,
    createLogger()
  );

  const status = await service.getFolderStatus(createMapping("Projects/Alpha"));

  assert.equal(status.repoExists, false);
  assert.equal(status.branch, "main");
  assert.equal(status.clean, true);
});

test("buildDiagnosticsReport skips the remote check when only an ancestor repo exists", async () => {
  const vaultPath = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "fgss-diagnostics-"))
  );
  const folderPath = path.join(vaultPath, "Projects", "Alpha");
  await fs.mkdir(folderPath, { recursive: true });

  let remoteChecks = 0;
  const gitProcess = {
    async runGit(cwd, args) {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return {
          command: "git",
          args,
          cwd,
          exitCode: 0,
          stdout: `${vaultPath}\n`,
          stderr: ""
        };
      }

      throw new Error(`Unexpected git invocation: ${args.join(" ")}`);
    }
  };

  const authDetector = {
    async checkLocalReadiness() {
      return {
        gitAvailable: true,
        gitVersion: "git version 2.48.0",
        sshAvailable: true,
        sshVersion: "OpenSSH_9.0"
      };
    },
    async checkRemoteReadOnly() {
      remoteChecks += 1;
      return {
        ok: true,
        summary: "SSH remote check succeeded."
      };
    },
    createFailureGuidance() {
      return [];
    }
  };

  const service = new GitService(
    createApp(vaultPath),
    gitProcess,
    authDetector,
    createLogger()
  );

  const report = await service.buildDiagnosticsReport(createMapping("Projects/Alpha"));
  const repoCheck = report.checks.find((check) => check.label === "Folder is a Git repo");
  const remoteCheck = report.checks.find(
    (check) => check.label === "Read-only remote check"
  );

  assert.equal(repoCheck?.ok, false);
  assert.match(repoCheck?.detail ?? "", /not the Git repository root/i);
  assert.equal(remoteCheck?.ok, false);
  assert.equal(remoteCheck?.detail, "Remote check skipped.");
  assert.equal(remoteChecks, 0);
});

test("ensureInitialized creates a repo when the folder only inherits an ancestor repo", async () => {
  const vaultPath = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "fgss-init-"))
  );
  const repoPath = path.join(vaultPath, "Projects", "Alpha");
  await fs.mkdir(repoPath, { recursive: true });

  let initialized = false;
  const calls = [];
  const gitProcess = {
    async runGit(cwd, args, options = {}) {
      calls.push({ cwd, args });

      if (args[0] === "init") {
        initialized = true;
        return {
          command: "git",
          args,
          cwd,
          exitCode: 0,
          stdout: "Initialized empty Git repository\n",
          stderr: ""
        };
      }

      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return {
          command: "git",
          args,
          cwd,
          exitCode: 0,
          stdout: `${initialized ? repoPath : vaultPath}\n`,
          stderr: ""
        };
      }

      if (args[0] === "symbolic-ref") {
        return {
          command: "git",
          args,
          cwd,
          exitCode: 0,
          stdout: "",
          stderr: ""
        };
      }

      if (args[0] === "remote" && args[1] === "get-url") {
        return {
          command: "git",
          args,
          cwd,
          exitCode: 2,
          stdout: "",
          stderr: ""
        };
      }

      if (args[0] === "remote" && args[1] === "add") {
        return {
          command: "git",
          args,
          cwd,
          exitCode: 0,
          stdout: "",
          stderr: ""
        };
      }

      throw new Error(`Unexpected git invocation: ${args.join(" ")}`);
    }
  };

  const authDetector = {
    async checkLocalReadiness() {
      return {
        gitAvailable: true,
        gitVersion: "git version 2.48.0",
        sshAvailable: true,
        sshVersion: "OpenSSH_9.0"
      };
    },
    createFailureGuidance() {
      return [];
    }
  };

  const service = new GitService(
    createApp(vaultPath),
    gitProcess,
    authDetector,
    createLogger()
  );

  const result = await service.ensureInitialized(createMapping("Projects/Alpha"));

  assert.equal(result.repoPath, repoPath);
  assert.ok(
    calls.some(
      (call) => call.cwd === repoPath && call.args[0] === "init"
    )
  );
});
