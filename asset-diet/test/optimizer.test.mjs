import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { formatFromPath, optimizeBuffer, optimizeImage } from "../src/optimizer.mjs";

async function makeJpeg(filePath) {
  const data = Buffer.alloc(240 * 240 * 3);
  let seed = 7;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 16807) % 2147483647;
    data[i] = seed % 256;
  }
  await sharp(data, { raw: { width: 240, height: 240, channels: 3 } }).jpeg({ quality: 100 }).toFile(filePath);
}

test("normalizes jpg extension and rejects unsupported formats", () => {
  assert.equal(formatFromPath("photo.JPG"), "jpeg");
  assert.throws(() => formatFromPath("document.pdf"), /Unsupported image format/);
});

test("validates quality", async () => {
  await assert.rejects(optimizeBuffer(Buffer.from("x"), "image.jpg", 0), /Quality must be/);
});

test("creates optimized copy without changing original", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asset-diet-opt-"));
  try {
    const input = path.join(root, "photo.jpg");
    await makeJpeg(input);
    const original = await readFile(input);
    const result = await optimizeImage(input, { outputDir: path.join(root, "out") });
    assert.ok(result.improved);
    assert.deepEqual(await readFile(input), original);
    assert.ok((await stat(result.outputPath)).size < original.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dry-run writes no output file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asset-diet-dry-"));
  try {
    const input = path.join(root, "photo.jpg");
    await makeJpeg(input);
    const outputDir = path.join(root, "out");
    const result = await optimizeImage(input, { dryRun: true, outputDir });
    assert.equal(result.status, "dry-run");
    await assert.rejects(access(outputDir));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("overwrite with backup keeps the original copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asset-diet-backup-"));
  try {
    const input = path.join(root, "photo.jpg");
    await makeJpeg(input);
    const original = await readFile(input);
    await optimizeImage(input, { overwrite: true, backup: true });
    assert.deepEqual(await readFile(`${input}.asset-diet.bak`), original);
    assert.ok((await stat(input)).size < original.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});
