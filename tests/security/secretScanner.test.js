const test = require("node:test");
const assert = require("node:assert/strict");

const {
  scanPathsForSecrets,
  matchesBlockedPattern,
  RECOMMENDED_GITIGNORE_TEMPLATE
} = require("../../src/security/secretScanner.ts");

test("scanPathsForSecrets flags suspicious filenames and blocked patterns", () => {
  const result = scanPathsForSecrets(
    [
      "notes/meeting.md",
      ".env",
      "keys/id_ed25519",
      "exports/auth-dump.txt",
      ".obsidian/plugins/folder-git-sync-secure/data.json"
    ],
    [".obsidian/plugins/folder-git-sync-secure/**"]
  );

  assert.equal(result.suspicious.length, 3);
  assert.equal(result.blocked.length, 1);
  assert.deepEqual(
    result.suspicious.map((entry) => entry.path).sort(),
    [".env", "exports/auth-dump.txt", "keys/id_ed25519"]
  );
});

test("matchesBlockedPattern supports recursive glob segments", () => {
  assert.equal(matchesBlockedPattern(".obsidian/plugins/folder-git-sync-secure/data.json", [".obsidian/plugins/folder-git-sync-secure/**"]), true);
  assert.equal(matchesBlockedPattern("Projects/Alpha/note.md", ["Projects/**/note.md"]), true);
  assert.equal(matchesBlockedPattern("Projects/Alpha/todo.md", ["Projects/**/note.md"]), false);
});

test("recommended gitignore template includes plugin config and secret defaults", () => {
  assert.match(RECOMMENDED_GITIGNORE_TEMPLATE, /\.env/);
  assert.match(RECOMMENDED_GITIGNORE_TEMPLATE, /\.obsidian\/plugins\/folder-git-sync-secure\/data\.json/);
});
