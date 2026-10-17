import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanImages, SUPPORTED_EXTENSIONS } from "../src/scanner.mjs";

test("recognizes supported extensions case-insensitively", async () => {
  assert.equal(SUPPORTED_EXTENSIONS.has(".jpg"), true);
  const root = await mkdtemp(path.join(os.tmpdir(), "asset-diet-ext-"));
  try {
    const file = path.join(root, "IMAGE.PNG");
    await writeFile(file, "placeholder");
    assert.deepEqual(await scanImages(file), [file]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scans nested folders and skips unsupported files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asset-diet-scan-"));
  try {
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "one.JPG"), "fake");
    await writeFile(path.join(root, "notes.txt"), "ignore");
    await writeFile(path.join(root, "nested", "two.webp"), "fake");
    const found = await scanImages(root);
    assert.equal(found.length, 2);
    assert.ok(found.some((file) => file.endsWith("one.JPG")));
    assert.ok(found.some((file) => file.endsWith("two.webp")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reports missing input clearly", async () => {
  await assert.rejects(scanImages("/this/path/should/not/exist/asset-diet"), /Path does not exist/);
});
