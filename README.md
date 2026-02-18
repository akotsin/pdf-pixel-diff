# pdf-pixel-diff

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![Module](https://img.shields.io/badge/Module-ESM%20%2B%20CJS-purple.svg)](https://nodejs.org/api/packages.html#conditional-exports)
[![node-poppler](https://img.shields.io/badge/node--poppler-9.1.1-brightgreen.svg)](https://www.npmjs.com/package/node-poppler)
[![sharp](https://img.shields.io/badge/sharp-0.34.5-brightgreen.svg)](https://www.npmjs.com/package/sharp)
[![pixelmatch](https://img.shields.io/badge/pixelmatch-7.1.0-brightgreen.svg)](https://www.npmjs.com/package/pixelmatch)

Pixel-by-pixel PDF comparison for Node.js. Renders PDFs to PNGs (Poppler) and compares page images with `pixelmatch`, producing per-page diff images.

## Project Structure

```
├── src/
│  ├── compare/            # image diff logic (pixelmatch)
│  ├── directory/          # output folders + cleanup
│  └── render/             # pdf -> png (Poppler)
├── dist/                  # build output (published)
├── tsup.config.ts
└── package.json
```

## Prerequisites

Poppler is required by `node-poppler`. Install it and ensure binaries are available on your `PATH`.

- **macOS (Homebrew)**:

```bash
brew install poppler
```

- **Ubuntu/Debian**:

```bash
sudo apt-get update && sudo apt-get install -y poppler-utils
```

## Install

```bash
npm install pdf-pixel-diff
```

## Usage

```js
import path from 'node:path';
import { compareFiles } from 'pdf-pixel-diff';

const baselineFilePath = path.join(process.cwd(), 'baseline.pdf');
const actualFilePath = path.join(process.cwd(), 'actual.pdf');

const result = await compareFiles(baselineFilePath, actualFilePath, {
  resultDir: path.resolve(process.cwd(), 'results'),
  render: { dpi: 150 },
  compare: {
    threshold: 0.1,
    includeAA: false,
    combineImages: true,
    excludedPages: [2], // 1-based page numbers
    masks: [
      // pageNumber: 0 => apply to all pages
      { pageNumber: 0, x0: 100, y0: 1580, x1: 690, y1: 1610, color: 'transparent' },
    ],
  },
});

console.log(result);
```

## API

### `compareFiles(baselineFile, actualFile, options?)`

- **baselineFile / actualFile**: `string | Buffer`
  - `string` is treated as a file path
  - `Buffer` is passed directly to Poppler
- **options**:
  - `resultDir?: string` – output directory (default: `<cwd>/pdf-pixel-diff`)
  - `render?: { dpi?: number }` – render DPI (default: `150`)
  - `compare?: CompareOptions`

`CompareOptions`:

- `threshold?: number` – pixelmatch threshold (default: `0.1`)
- `includeAA?: boolean` – include anti-aliased pixels (default: `false`)
- `combineImages?: boolean` – when `true`, writes a combined image (Baseline | Actual | Difference) for each differing page
- `excludedPages?: number[]` – **1-based** page numbers to skip
- `masks?: Array<{ pageNumber: number; x0: number; y0: number; x1: number; y1: number; color?: 'black' | 'transparent' }>`
  - Coordinates are in **pixel space of the rendered PNG**
  - `pageNumber: 0` means “apply to all pages”; otherwise it must match the **1-based** page number
  - `color` controls how the masked rectangle is filled in both images:
    - `'black'` (default): opaque black (`rgba(0,0,0,1)`)
    - `'transparent'`: fully transparent (`rgba(0,0,0,0)`)

Return value:

```ts
type CompareFilesResult = {
  passed: boolean;
  message: string;
  excludedPages: number[];
  differentPages: number[];
  error?: Error;
}
```

`compareFiles()` does **not** throw: it catches errors and returns `{ passed: false, message: "...", error }`.

## Output

The `resultDir` folder contains (and is **emptied on each run**):

```
resultDir/
  baseline/    # rendered baseline pages (baseline-01.png, ...)
  actual/      # rendered actual pages (actual-01.png, ...)
  difference/  # diff images (difference-01.png, ...)
```

Notes:

- Only pages up to `min(baselinePages, actualPages)` are compared.
- If page counts differ, the result is marked as failed.

## Troubleshooting

### Poppler not found / “Failed to find Poppler binaries”

Install Poppler and make sure its binaries are on your `PATH` (see [Prerequisites](#prerequisites)).

### ESM / CommonJS usage

This package supports both ESM and CommonJS.

ESM:

```js
import { compareFiles } from 'pdf-pixel-diff';
```

CommonJS:

```js
const { compareFiles } = require('pdf-pixel-diff');
```

### “Images must have the same dimensions”

Rendered page images must match in width/height. Typical causes:

- Different PDF page sizes
- Different DPI (ensure you pass the same `render.dpi`)
- Rotations / crop boxes

### I expected a diff image but none was produced

Diff images are only written when a page differs. Check:

- `result.differentPages`
- `compare.excludedPages`
- `result.error`

## Key Features

- PDF to PNG rendering via Poppler
- Page-by-page pixel comparison with configurable threshold and AA handling
- Rectangular masks to ignore dynamic regions
- Optional combined output image (Baseline | Actual | Difference)

## License

This project is licensed under the ISC License.

