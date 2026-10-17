import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initGuard, GuardrailLimitError } from "../dist/index.js";

async function fixture(options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "guardrail-test-"));
  const guard = await initGuard({
    maxDailySpend: 1, alertThreshold: 0.8, apiKeyProvider: "generic",
    exitOnLimit: false, cachePath: path.join(dir, ".guardrail-cache.json"),
    pricing: { inputPerMillion: 1, outputPerMillion: 2 }, onAlert: () => {}, ...options
  });
  return { guard, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
test("records token usage and estimates cost", async () => {
  const f = await fixture();
  try {
    await f.guard.recordUsage({ inputTokens: 1000, outputTokens: 1000 });
    const u = await f.guard.getUsage();
    assert.equal(u.inputTokens, 1000);
    assert.equal(u.estimatedSpendUsd, 0.003);
  } finally { await f.cleanup(); }
});
test("uses provider-reported cost", async () => {
  const f = await fixture();
  try {
    await f.guard.recordUsage({ actualCostUsd: 0.25 });
    assert.equal((await f.guard.getUsage()).estimatedSpendUsd, 0.25);
  } finally { await f.cleanup(); }
});
test("blocks when the hard limit is reached", async () => {
  const f = await fixture();
  try { await assert.rejects(() => f.guard.recordUsage({ actualCostUsd: 1 }), GuardrailLimitError); }
  finally { await f.cleanup(); }
});
test("enforces request frequency", async () => {
  const f = await fixture({ maxRequestsPerMinute: 1 });
  try {
    await f.guard.beforeRequest();
    await assert.rejects(() => f.guard.beforeRequest(), GuardrailLimitError);
    assert.equal((await f.guard.getUsage()).requests, 1, "blocked requests must not be counted");
  } finally { await f.cleanup(); }
});
test("wrapFetch blocks before calling network", async () => {
  const f = await fixture();
  try {
    await f.guard.recordUsage({ actualCostUsd: 0.9999 });
    let called = false;
    await assert.rejects(() => f.guard.wrapFetch(async () => { called = true; return new Response("no"); })("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "hello" }], max_tokens: 1024 }) }), GuardrailLimitError);
    assert.equal(called, false);
  } finally { await f.cleanup(); }
});
test("rejects invalid configuration", async () => {
  await assert.rejects(() => initGuard({ maxDailySpend: 0, alertThreshold: 0.8, apiKeyProvider: "generic" }), /maxDailySpend/);
  await assert.rejects(() => initGuard({ maxDailySpend: 1, alertThreshold: 2, apiKeyProvider: "generic" }), /alertThreshold/);
  await assert.rejects(() => initGuard({ maxDailySpend: 1, alertThreshold: 0.8, apiKeyProvider: "generic", maxRequestsPerMinute: 0 }), /maxRequestsPerMinute/);
  await assert.rejects(() => initGuard({ maxDailySpend: 1, alertThreshold: 0.8, apiKeyProvider: "generic", maxOutputTokensPerRequest: -1 }), /maxOutputTokensPerRequest/);
});
