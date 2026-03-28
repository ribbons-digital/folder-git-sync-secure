const test = require("node:test");
const assert = require("node:assert/strict");

const { parseStatusPorcelainV2 } = require("../../src/git/statusParser.ts");

test("parseStatusPorcelainV2 counts staged, modified, and untracked files", () => {
  const output = [
    "# branch.oid abcdef1234567890",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 abcdef1 abcdef1 src/main.ts",
    "1 .M N... 100644 100644 100644 abcdef1 abcdef1 README.md",
    "? drafts/todo.md"
  ].join("\0");

  const result = parseStatusPorcelainV2(output);

  assert.equal(result.branch, "main");
  assert.equal(result.ahead, 2);
  assert.equal(result.behind, 1);
  assert.equal(result.stagedCount, 1);
  assert.equal(result.modifiedCount, 1);
  assert.equal(result.untrackedCount, 1);
  assert.equal(result.clean, false);
  assert.equal(result.files.length, 3);
});

test("parseStatusPorcelainV2 tracks renamed files and merge conflicts", () => {
  const output = [
    "# branch.oid abcdef1234567890",
    "# branch.head feature/test",
    "2 R. N... 100644 100644 100644 abcdef1 abcdef1 R100 src/new.ts",
    "src/old.ts",
    "u UU N... 100644 100644 100644 100644 abcdef1 abcdef1 abcdef1 conflicted.md"
  ].join("\0");

  const result = parseStatusPorcelainV2(output);

  assert.equal(result.files[0].kind, "renamed");
  assert.equal(result.files[0].originalPath, "src/old.ts");
  assert.equal(result.hasConflicts, true);
  assert.equal(result.clean, false);
});
