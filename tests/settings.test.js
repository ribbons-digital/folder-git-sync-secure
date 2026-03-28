const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDefaultMapping,
  normalizeSettings
} = require("../src/settings.ts");

test("normalizeSettings clears invalid stored remotes instead of keeping plaintext secrets", () => {
  const settings = normalizeSettings({
    mappings: [
      {
        id: "mapping-1",
        folderPath: "Projects/Alpha",
        remoteUrl: "https://user:super-secret@github.com/owner/repo.git",
        branch: "main",
        commitMessageTemplate: "vault sync: {{folderName}} {{timestamp}}",
        autoSync: false,
        autoSyncDebounceMs: 15000,
        safeMode: true,
        blockedFilePatterns: []
      }
    ]
  });

  assert.equal(settings.mappings[0]?.remoteUrl, "");
  assert.match(
    settings.mappings[0]?.lastError ?? "",
    /Stored remote was cleared\./i
  );
});

test("createDefaultMapping still works when global crypto is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");

  try {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true
    });

    const mapping = createDefaultMapping("Projects/Alpha");

    assert.equal(mapping.folderPath, "Projects/Alpha");
    assert.equal(typeof mapping.id, "string");
    assert.ok(mapping.id.length > 0);
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "crypto", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "crypto");
    }
  }
});
