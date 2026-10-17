import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, summarize, renderReport } from "../src/report.mjs";

test("formats byte counts", () => {
  assert.equal(formatBytes(100), "100 B");
  assert.equal(formatBytes(1024), "1.00 KB");
});

test("summarizes savings accurately", () => {
  const summary = summarize([
    { originalBytes: 1000, optimizedBytes: 600, savedBytes: 400, improved: true },
    { originalBytes: 500, optimizedBytes: 500, savedBytes: 0, improved: false }
  ]);
  assert.equal(summary.filesScanned, 2);
  assert.equal(summary.filesImproved, 1);
  assert.equal(summary.totalSaved, 400);
  assert.equal(summary.savingsPercent, 26.7);
});

test("report includes dry-run warning", () => {
  const report = renderReport([], { dryRun: true });
  assert.match(report, /No supported images found/);
  assert.match(report, /no files were written/);
});
