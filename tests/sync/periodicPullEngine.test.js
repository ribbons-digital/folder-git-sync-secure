const test = require("node:test");
const assert = require("node:assert/strict");

const { PeriodicPullEngine } = require("../../src/sync/periodicPullEngine.ts");

test("applyConfig runs immediate cycle when enabled", async () => {
  const events = [];
  const timers = [];
  const engine = new PeriodicPullEngine({
    runCycle: async () => {
      events.push("cycle");
    },
    setIntervalFn: (handler, ms) => {
      timers.push({ handler, ms });
      return timers.length;
    },
    clearIntervalFn: () => {}
  });

  await engine.applyConfig(
    { enabled: true, intervalSeconds: 10 },
    { immediate: true }
  );

  assert.deepEqual(events, ["cycle"]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 10000);
});

test("interval zero disables schedule", async () => {
  let setCalls = 0;
  let clearCalls = 0;
  const engine = new PeriodicPullEngine({
    runCycle: async () => {},
    setIntervalFn: (handler, ms) => {
      setCalls += 1;
      return { handler, ms };
    },
    clearIntervalFn: () => {
      clearCalls += 1;
    }
  });

  await engine.applyConfig(
    { enabled: true, intervalSeconds: 15 },
    { immediate: false }
  );
  await engine.applyConfig(
    { enabled: true, intervalSeconds: 0 },
    { immediate: false }
  );

  assert.equal(setCalls, 1);
  assert.equal(clearCalls, 1);
});

test("timer-path error handling routes errors to onError without throwing", async () => {
  const errors = [];
  let timerHandler;
  const unhandled = [];
  const onUnhandledRejection = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    const engine = new PeriodicPullEngine({
      runCycle: async () => {
        throw new Error("boom");
      },
      onError: (error) => {
        errors.push(error);
      },
      setIntervalFn: (handler) => {
        timerHandler = handler;
        return 1;
      },
      clearIntervalFn: () => {}
    });

    await engine.applyConfig(
      { enabled: true, intervalSeconds: 1 },
      { immediate: false }
    );

    timerHandler();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, "boom");
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("applyConfig while run is in flight does not create a concurrent cycle", async () => {
  let release;
  let calls = 0;
  const engine = new PeriodicPullEngine({
    runCycle: async () => {
      calls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });

  const first = engine.runOnce();
  await Promise.resolve();

  const reconfigure = engine.applyConfig(
    { enabled: true, intervalSeconds: 10 },
    { immediate: true }
  );

  await Promise.resolve();

  assert.equal(calls, 1);

  release();
  await first;
  await reconfigure;
});

test("runOnce overlap guard prevents concurrent runCycle", async () => {
  let release;
  let calls = 0;
  const engine = new PeriodicPullEngine({
    runCycle: async () => {
      calls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });

  const first = engine.runOnce();
  await Promise.resolve();
  const second = engine.runOnce();

  await second;

  assert.equal(calls, 1);
  release();
  await first;
});
