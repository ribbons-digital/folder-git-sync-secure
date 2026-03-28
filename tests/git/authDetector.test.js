const test = require("node:test");
const assert = require("node:assert/strict");

const { AuthDetector } = require("../../src/git/authDetector.ts");

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

test("checkRemoteReadOnly uses the configured remote URL directly", async () => {
  const calls = [];
  const gitProcess = {
    async runGit(cwd, args) {
      calls.push({ cwd, args });
      return {
        command: "git",
        args,
        cwd,
        exitCode: 0,
        stdout: "",
        stderr: ""
      };
    },
    async runSsh() {
      throw new Error("runSsh should not be used in this test");
    }
  };

  const detector = new AuthDetector(gitProcess, createLogger());
  const remoteUrl = "git@github.com:owner/repo.git";
  const result = await detector.checkRemoteReadOnly("/repo/path", remoteUrl);

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      cwd: "/repo/path",
      args: ["ls-remote", "--heads", remoteUrl]
    }
  ]);
});
