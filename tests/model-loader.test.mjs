import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_SIZE, retry, validateModelSize } from "../web/model-loader.js";

test("validateModelSize accepts only the pinned model size", () => {
  const model = new ArrayBuffer(MODEL_SIZE);
  assert.equal(validateModelSize(model), model);
  assert.throws(() => validateModelSize(new ArrayBuffer(12)), /incomplete/);
  assert.throws(() => validateModelSize("not binary"), /binary data/);
});

test("retry succeeds after transient failures", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("temporary");
    return "ready";
  }, async () => {});
  assert.equal(value, "ready");
  assert.equal(calls, 3);
});

test("retry does not repeat an aborted download", async () => {
  let calls = 0;
  const aborted = Object.assign(new Error("cancelled"), { name: "AbortError" });
  await assert.rejects(() => retry(async () => {
    calls += 1;
    throw aborted;
  }, async () => {}), /cancelled/);
  assert.equal(calls, 1);
});
