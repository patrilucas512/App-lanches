import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../app/api/performance-management/worker/route.ts", import.meta.url), "utf8");

test("33 performance worker requires a server-side secret", () => {
  assert.match(worker, /PERFORMANCE_WORKER_SECRET/);
  assert.match(worker, /authorization/);
  assert.match(worker, /Unauthorized/);
});

test("34 performance worker materializes semantic snapshots", () => {
  assert.match(worker, /analytics_daily_orders/);
  assert.match(worker, /goal_progress_snapshots/);
  assert.match(worker, /calculation_trace/);
});

test("35 health notifications are transition based", () => {
  assert.match(worker, /previousResult\.data\?\.health !== progress\.health/);
  assert.match(worker, /notification_inbox_items/);
});
