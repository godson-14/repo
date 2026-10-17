import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const cli = new URL("../src/cli.mjs", import.meta.url);

test("shows help text", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /MockServer-Quick/);
  assert.match(result.stdout, /--file=PATH/);
});

test("reports a missing JSON file clearly", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "--file=does-not-exist.json"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not load JSON file/);
});
