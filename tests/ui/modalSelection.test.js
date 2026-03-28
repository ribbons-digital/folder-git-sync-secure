const test = require("node:test");
const assert = require("node:assert/strict");

const { createDeferredSelection } = require("../../src/ui/modalSelection.ts");

test("deferred selection resolves the chosen value immediately", () => {
  const picked = [];
  const selection = createDeferredSelection((item) => {
    picked.push(item);
  });

  selection.choose("Projects/Alpha");
  assert.deepEqual(picked, ["Projects/Alpha"]);
});

test("deferred selection resolves null when finalized without a choice", async () => {
  const picked = [];
  const selection = createDeferredSelection((item) => {
    picked.push(item);
  });

  selection.finalize();
  await Promise.resolve();
  selection.finalize();

  assert.deepEqual(picked, [null]);
});

test("deferred selection does not emit null after a choice was made", async () => {
  const picked = [];
  const selection = createDeferredSelection((item) => {
    picked.push(item);
  });

  selection.choose("Projects/Alpha");
  selection.finalize();
  await Promise.resolve();

  assert.deepEqual(picked, ["Projects/Alpha"]);
});

test("deferred selection keeps chosen value when close fires before choose", async () => {
  const picked = [];
  const selection = createDeferredSelection((item) => {
    picked.push(item);
  });

  selection.finalize();
  selection.choose("Projects/Alpha");
  await Promise.resolve();

  assert.deepEqual(picked, ["Projects/Alpha"]);
});

test("deferred selection can finalize without timer APIs", () => {
  const picked = [];
  const selection = createDeferredSelection((item) => {
    picked.push(item);
  });

  const originalQueueMicrotask = globalThis.queueMicrotask;
  const originalSetTimeout = globalThis.setTimeout;

  try {
    Object.defineProperty(globalThis, "queueMicrotask", {
      value: undefined,
      configurable: true
    });
    Object.defineProperty(globalThis, "setTimeout", {
      value: undefined,
      configurable: true
    });

    selection.finalize();
    assert.deepEqual(picked, [null]);
  } finally {
    Object.defineProperty(globalThis, "queueMicrotask", {
      value: originalQueueMicrotask,
      configurable: true
    });
    Object.defineProperty(globalThis, "setTimeout", {
      value: originalSetTimeout,
      configurable: true
    });
  }
});
