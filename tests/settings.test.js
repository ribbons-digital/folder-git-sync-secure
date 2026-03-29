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

test("normalizeSettings applies periodic pull defaults", () => {
  const settings = normalizeSettings({});

  assert.equal(settings.periodicPullEnabled, false);
  assert.equal(settings.periodicPullIntervalSeconds, 86400);
});

test("normalizeSettings treats malformed periodicPullEnabled values as false", () => {
  const settings = normalizeSettings({
    periodicPullEnabled: "true"
  });

  assert.equal(settings.periodicPullEnabled, false);
});

test("normalizeSettings clamps periodic pull interval to a non-negative integer", () => {
  const settings = normalizeSettings({
    periodicPullEnabled: true,
    periodicPullIntervalSeconds: -25.9
  });

  assert.equal(settings.periodicPullEnabled, true);
  assert.equal(settings.periodicPullIntervalSeconds, 0);
});

test("normalizeSettings floors positive fractional periodic pull intervals", () => {
  const settings = normalizeSettings({
    periodicPullIntervalSeconds: 12.9
  });

  assert.equal(settings.periodicPullIntervalSeconds, 12);
});

test("normalizeSettings falls back to the default for non-finite periodic pull intervals", () => {
  const settings = normalizeSettings({
    periodicPullIntervalSeconds: Infinity
  });

  assert.equal(settings.periodicPullIntervalSeconds, 86400);
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
