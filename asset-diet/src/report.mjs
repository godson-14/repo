export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(2)} ${units[index]}`;
}

export function summarize(results) {
  const totalOriginal = results.reduce((sum, item) => sum + item.originalBytes, 0);
  const totalOptimized = results.reduce((sum, item) => sum + item.optimizedBytes, 0);
  const totalSaved = results.reduce((sum, item) => sum + item.savedBytes, 0);
  return {
    filesScanned: results.length,
    filesImproved: results.filter((item) => item.improved).length,
    totalOriginal,
    totalOptimized,
    totalSaved,
    savingsPercent: totalOriginal ? Number(((totalSaved / totalOriginal) * 100).toFixed(1)) : 0
  };
}

export function renderReport(results, { dryRun = false } = {}) {
  const summary = summarize(results);
  const lines = [`Asset-Diet ${dryRun ? "dry-run " : ""}report`, "─".repeat(48)];
  if (!results.length) lines.push("No supported images found.");
  for (const item of results) {
    const label = item.inputPath.split(/[\\/]/).at(-1);
    const outcome = item.improved ? `${formatBytes(item.originalBytes)} → ${formatBytes(item.optimizedBytes)} (saved ${formatBytes(item.savedBytes)})` : `no size reduction (${formatBytes(item.originalBytes)})`;
    lines.push(`${item.improved ? "✓" : "–"} ${label}: ${outcome}`);
  }
  lines.push("─".repeat(48), `Images scanned: ${summary.filesScanned}`, `Images reduced: ${summary.filesImproved}`, `Space saved: ${formatBytes(summary.totalSaved)} (${summary.savingsPercent}%)`);
  if (dryRun) lines.push("Dry run only: no files were written.");
  return lines.join("\n");
}
