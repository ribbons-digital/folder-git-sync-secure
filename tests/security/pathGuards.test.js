const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeVaultFolderPath,
  assertSafeVaultFolderPath,
  assertSafeRepoRelativePath,
  isPathInsideRoot
} = require("../../src/security/pathGuards.ts");

test("normalizeVaultFolderPath trims redundant separators and leading slashes", () => {
  assert.equal(normalizeVaultFolderPath("/Projects//Alpha/"), "Projects/Alpha");
  assert.equal(normalizeVaultFolderPath("Research/./Notes"), "Research/Notes");
});

test("assertSafeVaultFolderPath rejects traversal and absolute paths", () => {
  assert.throws(() => assertSafeVaultFolderPath("../Secrets"), /traversal/i);
  assert.throws(() => assertSafeVaultFolderPath("/absolute/path"), /vault-relative/i);
});

test("assertSafeRepoRelativePath rejects parent traversal", () => {
  assert.equal(assertSafeRepoRelativePath("docs/note.md"), "docs/note.md");
  assert.throws(() => assertSafeRepoRelativePath("../../.ssh/id_ed25519"), /traversal/i);
});

test("isPathInsideRoot only accepts descendants of the canonical root", () => {
  assert.equal(isPathInsideRoot("/vault/root", "/vault/root/Projects/Alpha"), true);
  assert.equal(isPathInsideRoot("/vault/root", "/vault/other"), false);
});
