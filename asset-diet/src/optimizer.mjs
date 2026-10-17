import { copyFile, mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const FORMATS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);

export function formatFromPath(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!FORMATS.has(extension)) throw new Error(`Unsupported image format: .${extension || "(none)"}`);
  return extension === "jpg" ? "jpeg" : extension;
}

export async function optimizeBuffer(input, filePath, quality = 80) {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error("Quality must be an integer between 1 and 100.");
  const format = formatFromPath(filePath);
  let pipeline = sharp(input, { failOn: "error" }).rotate();
  if (format === "jpeg") pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  else if (format === "png") pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true });
  else if (format === "webp") pipeline = pipeline.webp({ quality, effort: 5 });
  else pipeline = pipeline.avif({ quality, effort: 5 });
  return pipeline.toBuffer();
}

export async function optimizeImage(filePath, options = {}) {
  const { quality = 80, dryRun = false, overwrite = false, backup = false, outputDir, relativePath = path.basename(filePath) } = options;
  const absolute = path.resolve(filePath);
  const original = await readFile(absolute);
  const optimized = await optimizeBuffer(original, absolute, quality);
  const originalBytes = original.length;
  const optimizedBytes = optimized.length;
  const improved = optimizedBytes < originalBytes;
  const result = { inputPath: absolute, outputPath: null, originalBytes, optimizedBytes, savedBytes: improved ? originalBytes - optimizedBytes : 0, improved, status: improved ? "optimized" : "unchanged" };

  if (dryRun) return { ...result, status: "dry-run" };
  if (!improved) return result;

  if (overwrite) {
    if (backup) await copyFile(absolute, `${absolute}.asset-diet.bak`);
    const tempPath = `${absolute}.asset-diet-tmp`;
    try {
      await writeFile(tempPath, optimized, { flag: "wx" });
      await rename(tempPath, absolute);
      result.outputPath = absolute;
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      throw error;
    }
  } else {
    const destinationRoot = path.resolve(outputDir ?? path.join(path.dirname(absolute), ".asset-diet"));
    const destination = path.join(destinationRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, optimized);
    result.outputPath = destination;
  }
  return result;
}
