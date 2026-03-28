const test = require("node:test");
const assert = require("node:assert/strict");

const {
  redactRemoteUrl,
  redactSensitiveText
} = require("../../src/security/redaction.ts");

test("redactRemoteUrl preserves safe SSH remotes and masks HTTPS credentials", () => {
  assert.equal(
    redactRemoteUrl("git@github.com:owner/repo.git"),
    "git@github.com:owner/repo.git"
  );
  assert.equal(
    redactRemoteUrl("https://user:super-secret@github.com/owner/repo.git"),
    "https://***@github.com/owner/repo.git"
  );
});

test("redactSensitiveText removes likely bearer and PAT values", () => {
  const redacted = redactSensitiveText(
    "Authorization: Bearer ghp_1234567890abcdefghijklmnop and github_pat_abcdefghijk123456789"
  );

  assert.doesNotMatch(redacted, /ghp_1234567890abcdefghijklmnop/);
  assert.doesNotMatch(redacted, /github_pat_abcdefghijk123456789/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("redactSensitiveText redacts credential URLs embedded inside git errors", () => {
  const redacted = redactSensitiveText(
    "fatal: repository 'https://user:super-secret@github.com/owner/repo.git' not found"
  );

  assert.doesNotMatch(redacted, /super-secret/);
  assert.match(redacted, /https:\/\/\*\*\*@github\.com\/owner\/repo\.git/);
});
