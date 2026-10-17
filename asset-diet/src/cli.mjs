#!/usr/bin/env node
import path from "node:path";
import { stat } from "node:fs/promises";
import { scanImages } from "./scanner.mjs";
import { optimizeImage } from "./optimizer.mjs";
import { renderReport, summarize } from "./report.mjs";

export function parseArgs(args) {
  const options = { quality: 80, dryRun: false, overwrite: false, backup: false, json: false };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--overwrite") options.overwrite = true;
    else if (arg === "--backup") options.backup = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--quality") {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error("--quality must be an integer from 1 to 100.");
      options.quality = value;
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (options.backup && !options.overwrite) throw new Error("--backup can only be used with --overwrite.");
  if (!options.help && positional.length !== 1) throw new Error("Provide exactly one image file or directory. Use --help for usage.");
  return { ...options, target: positional[0] };
}

const HELP = `Asset-Diet — optimize images safely

Usage:
  asset-diet <file-or-folder> [options]

Options:
  --quality <1-100>  Quality for lossy formats (default: 80)
  --dry-run          Analyze savings without writing files
  --overwrite        Replace originals only when the result is smaller
  --backup           With --overwrite, save originals as *.asset-diet.bak
  --json             Print a machine-readable summary
  --help, -h         Show this help

By default, optimized copies go into a .asset-diet folder beside the input.
Supported formats: JPEG, PNG, WebP, AVIF.
`;

export async function run(args = process.argv.slice(2), io = console) {
  const options = parseArgs(args);
  if (options.help) { io.log(HELP); return; }
  const target = path.resolve(options.target);
  const targetInfo = await stat(target);
  const images = await scanImages(target);
  const outputRoot = path.join(path.dirname(target), ".asset-diet", path.basename(target));
  const results = [];
  for (const imagePath of images) {
    const relativePath = targetInfo.isDirectory() ? path.relative(target, imagePath) : path.basename(imagePath);
    results.push(await optimizeImage(imagePath, {
      quality: options.quality,
      dryRun: options.dryRun,
      overwrite: options.overwrite,
      backup: options.backup,
      outputDir: outputRoot,
      relativePath
    }));
  }
  if (options.json) io.log(JSON.stringify({ summary: summarize(results), results }, null, 2));
  else io.log(renderReport(results, { dryRun: options.dryRun }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  run().catch((error) => {
    console.error(`asset-diet: ${error.message}`);
    process.exitCode = 1;
  });
}
