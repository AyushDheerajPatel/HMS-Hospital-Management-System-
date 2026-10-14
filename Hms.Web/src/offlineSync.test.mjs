import assert from "node:assert/strict";
import test from "node:test";
import {
  getSyncRetryDelayMs,
  isRetryableSyncError,
  isRetryableSyncStatus,
  isOperationOwnedBySession,
  parseRetryAfterMs,
} from "./offlineSync.ts";

test("retries transient HTTP failures only", () => {
  assert.equal(isRetryableSyncStatus(408), true);
  assert.equal(isRetryableSyncStatus(429), true);
  assert.equal(isRetryableSyncStatus(500), true);
  assert.equal(isRetryableSyncStatus(503), true);
  assert.equal(isRetryableSyncStatus(600), false);
  assert.equal(isRetryableSyncStatus(400), false);
  assert.equal(isRetryableSyncStatus(401), false);
});

test("uses bounded exponential delay for repeated sync failures", () => {
  const medianJitter = () => 0.5;
  assert.equal(getSyncRetryDelayMs(0, medianJitter), 1000);
  assert.equal(getSyncRetryDelayMs(1, medianJitter), 2000);
  assert.equal(getSyncRetryDelayMs(8, medianJitter), 256000);
  assert.equal(getSyncRetryDelayMs(30, medianJitter), 256000);
  assert.equal(getSyncRetryDelayMs(-1, medianJitter), 1000);
  assert.equal(getSyncRetryDelayMs(8, () => 1), 300000);
  assert.equal(getSyncRetryDelayMs(0, () => 0, 5000), 5000);
  assert.equal(getSyncRetryDelayMs(0, () => 1, 0), 1500);
});

test("identifies recoverable network timeouts", () => {
  assert.equal(isRetryableSyncError(new TypeError("network failure")), true);
  assert.equal(isRetryableSyncError(new DOMException("timed out", "TimeoutError")), true);
  assert.equal(isRetryableSyncError(new Error("invalid appointment")), false);
});

test("honors numeric and HTTP-date Retry-After values", () => {
  assert.equal(parseRetryAfterMs("3", 0), 3000);
  assert.equal(
    parseRetryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 1000),
    4000,
  );
  assert.equal(parseRetryAfterMs("invalid", 0), undefined);
  assert.equal(parseRetryAfterMs(null, 0), undefined);
});

test("refuses to sync operations from another tenant or user", () => {
  const operation = { tenantId: "tenant-a", userId: "user-a" };
  assert.equal(isOperationOwnedBySession(operation, "tenant-a", "user-a"), true);
  assert.equal(isOperationOwnedBySession(operation, "tenant-b", "user-a"), false);
  assert.equal(isOperationOwnedBySession(operation, "tenant-a", "user-b"), false);
  assert.equal(
    isOperationOwnedBySession({ tenantId: "tenant-a" }, "tenant-a", "user-a"),
    false,
  );
});
