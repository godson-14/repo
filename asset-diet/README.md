# Asset-Diet

A Node.js CLI that optimizes image assets and reports disk savings. It uses [Sharp](https://sharp.pixelplumbing.com/) and supports JPEG, PNG, WebP, and AVIF.

## Requirements

- Node.js 20+
- npm

## Install and test

```bash
cd asset-diet
npm install
npm test
```

Run directly from the project:

```bash
node src/cli.mjs ./public/images
```

## Usage

```bash
asset-diet ./public/images
asset-diet ./public/images --dry-run
asset-diet ./public/images --quality 82
asset-diet ./public/images --overwrite --backup
asset-diet ./public/images --json
```

- **Safe by default:** optimized copies go into a `.asset-diet` output folder; originals are not replaced.
- **Dry run:** estimates savings without writing output files.
- **Overwrite:** replaces originals only when the optimized result is smaller.
- **Backup:** with `--overwrite`, copies the original to `filename.asset-diet.bak` before replacement.
- **Quality:** integer from 1 to 100 for lossy formats. PNG uses palette and lossless compression settings.
- **Recursive scan:** walks subfolders and skips `.git`, `node_modules`, and generated `.asset-diet` folders.

If an optimized image is larger than the source, the original is kept and no copy is written. Use `--json` for machine-readable output. Review lossy outputs before production use.

## License

MIT
