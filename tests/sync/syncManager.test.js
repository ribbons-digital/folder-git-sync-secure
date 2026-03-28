const test = require("node:test");
const assert = require("node:assert/strict");

const { SyncManager } = require("../../src/sync/syncManager.ts");

test("review jobs serialize without inheriting sync backoff", async () => {
  const manager = new SyncManager();
  const mapping = {
    id: "mapping-1",
    folderPath: "Projects/Alpha"
  };

  await assert.rejects(
    manager.enqueue(mapping, "sync", async () => {
      throw new Error("network failure");
    })
  );

  const order = [];
  const first = manager.enqueue(
    mapping,
    "review",
    async () => {
      order.push("start-1");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("end-1");
    },
    {
      respectBackoff: false,
      recordFailures: false
    }
  );
  const second = manager.enqueue(
    mapping,
    "review",
    async () => {
      order.push("start-2");
      order.push("end-2");
    },
    {
      respectBackoff: false,
      recordFailures: false
    }
  );

  await Promise.all([first, second]);

  assert.deepEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
});
