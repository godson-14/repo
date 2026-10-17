import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export async function scanImages(inputPath) {
  const absolute = path.resolve(inputPath);
  const info = await stat(absolute).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`Path does not exist: ${absolute}`);
    throw error;
  });
  if (info.isFile()) return SUPPORTED_EXTENSIONS.has(path.extname(absolute).toLowerCase()) ? [absolute] : [];
  if (!info.isDirectory()) throw new Error(`Path is not a file or directory: ${absolute}`);

  const results = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (["node_modules", ".git", ".asset-diet"].includes(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) results.push(fullPath);
    }
  }
  await visit(absolute);
  return results;
}
