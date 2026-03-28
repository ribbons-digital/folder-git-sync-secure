const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRemoteUrl } = require("../../src/git/repoValidator.ts");

test("validateRemoteUrl accepts GitHub-style SSH remotes", () => {
  const result = validateRemoteUrl("git@github.com:owner/repo.git");

  assert.equal(result.valid, true);
  assert.equal(result.protocol, "ssh");
  assert.equal(result.host, "github.com");
});

test("validateRemoteUrl accepts SSH URLs for github.com", () => {
  const result = validateRemoteUrl("ssh://git@github.com:2222/owner/repo.git");

  assert.equal(result.valid, true);
  assert.equal(result.host, "github.com");
  assert.equal(result.port, "2222");
});

test("validateRemoteUrl rejects HTTPS remotes with a v1-specific error", () => {
  const result = validateRemoteUrl("https://github.com/owner/repo.git");

  assert.equal(result.valid, false);
  assert.match(result.message ?? "", /HTTPS remotes are not supported in v1/i);
});

test("validateRemoteUrl rejects unsupported SSH hosts", () => {
  const result = validateRemoteUrl("git@attacker.example:owner/repo.git");

  assert.equal(result.valid, false);
  assert.match(result.message ?? "", /Only github\.com is supported in v1/i);
});
