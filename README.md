# pdf-pixel-diff

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![Module](https://img.shields.io/badge/Module-ESM%20%2B%20CJS-purple.svg)](https://nodejs.org/api/packages.html#conditional-exports)
[![node-poppler](https://img.shields.io/badge/node--poppler-11.0.0-brightgreen.svg)](https://www.npmjs.com/package/node-poppler)
[![sharp](https://img.shields.io/badge/sharp-0.35.5-brightgreen.svg)](https://www.npmjs.com/package/sharp)
[![pixelmatch](https://img.shields.io/badge/pixelmatch-8.0.0-brightgreen.svg)](https://www.npmjs.com/package/pixelmatch)

Pixel-by-pixel PDF comparison for Node.js. Renders PDFs to PNGs (Poppler) and compares page images with `pixelmatch`, producing per-page diff images.

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

Fonts: Poppler substitutes fonts that are **not embedded** in the PDF using the system fonts (fontconfig).
On a machine without fonts (e.g. slim Docker images) such text is not rendered at all, so text changes are **not detected**.
Install a basic font package in CI, e.g. `apt-get install -y fonts-dejavu-core` (check with `pdffonts file.pdf`, column `emb`).

## Install

```bash
npm install pdf-pixel-diff
```

## Definitions

```ts
declare function compareFiles (
  /** `string` is treated as a file path, `Buffer` is passed directly to Poppler */
  expectedFile: string | Buffer,
  /** `string` is treated as a file path, `Buffer` is passed directly to Poppler */
  actualFile: string | Buffer,
  options?: {
    /**
     * base output directory; relative paths are resolved against `cwd` (default: `<cwd>/pdf-pixel-diff`).
     * every call writes into its own new subfolder `<resultDir>/<ISO timestamp>-<random>`
     */
    resultDir?: string;

    /**
     * what to keep on disk after the comparison
     * - 'failed': keep the run subfolder only when the comparison failed (default)
     * - 'all': always keep
     * - 'none': always remove
     * only the run subfolder is removed, never `resultDir` itself or other files in it
     */
    keepResults?: 'failed' | 'all' | 'none';

    /** when true, the result includes `pages` with per-page details (default: false) */
    detailedResult?: boolean;

    /** render options */
    render?: RenderOptions;

    /** compare options */
    compare?: CompareOptions;
  },
): Promise<CompareFilesResult>;

type RenderOptions = {
  /** render DPI (default: 150) */
  dpi?: number;

  /** render using the crop box instead of the media box (default: false) */
  useCropBox?: boolean;
};

type CompareOptions = {
  /**
   * pixelmatch color threshold: any number from 0 to 1, decimals allowed (e.g. 0.05, 0.15)
   * lower is stricter: 0 = any color change counts, 1 = almost nothing counts (default: 0.1)
   */
  threshold?: number;

  /** include anti-aliased pixels (default: false) */
  includeAA?: boolean;

  /**
   * when true, writes a combined image (Expected | Actual | Difference)
   * for each differing page (default: false)
   */
  combineImages?: boolean;

  /**
   * layout of the combined image (default: 'auto')
   * - 'auto': vertical for landscape pages, horizontal for portrait pages
   * - 'horizontal' | 'vertical': forced
   */
  combineLayout?: 'auto' | 'horizontal' | 'vertical';

  /**
   * labels drawn in the top-right corner of each part of the combined image
   * (default: { expected: 'Expected', actual: 'Actual', difference: 'Difference' })
   * - false: no labels
   * - partial object: overrides only the given labels, '' hides a single label
   * up to 100 characters; text wider than the page is truncated with an ellipsis
   */
  combineLabels?: false | {
    expected?: string;
    actual?: string;
    difference?: string;
  };

  /** 1-based page numbers to skip (default: []) */
  excludedPages?: number[];

  /**
   * coordinates are in pixel space of the rendered PNG, so they depend on `render.dpi`
   * (at 150 DPI a US Letter portrait page is 1275 x 1650 px, landscape 1650 x 1275 px)
   * pageNumber: 0 => apply to all pages, otherwise 1-based page number
   * orientation: apply only to pages of this orientation (default: any)
   */
  masks?: {
    pageNumber: number;
    orientation?: 'portrait' | 'landscape';
    x0: number;
    y0: number;
    x1: number;
    y1: number;

    /**
     * controls how the masked rectangle is filled in both images (default: 'black')
     * - 'black': R=0, G=0, B=0, A=255
     * - 'transparent': R=0, G=0, B=0, A=0
     */
    color?: 'black' | 'transparent';
  }[];
};

type CompareFilesResult = {
  passed: boolean;
  /**
   * 'Documents are the same' | 'Documents are different'
   * | 'Documents are different: expected N pages, actual M pages' | 'Failed to compare the files'
   */
  message: string;
  excludedPages: number[];
  /** pages with status 'different' or 'size-mismatch' */
  differentPages: number[];
  /** one entry per page of the longer document; empty when `error` is set */
  /** only with `detailedResult: true`: one entry per page of the longer document; empty when `error` is set */
  pages?: PageResult[];
  /** absolute path of this call's run subfolder, e.g. '/repo/pdf-pixel-diff/2026-10-23T14-31-59-309Z-FTgPX6'; set only when the folder is kept on disk (see `keepResults`) */
  resultDir?: string;
  error?: Error;
}

type PageResult = {
  page: number;
  /**
   * - 'size-mismatch': rendered pages have different dimensions (e.g. orientation changed)
   * - 'missing': page exists only in one of the documents
   */
  status: 'equal' | 'different' | 'size-mismatch' | 'excluded' | 'missing';
  diffPixels: number;
  diffRatio: number;
  expectedSize?: { width: number; height: number };
  actualSize?: { width: number; height: number };
  /** absolute path, set only for failed pages whose results are kept on disk */
  diffImagePath?: string;
}
```

`compareFiles()` does **not** throw: it catches errors and returns `{ passed: false, message: 'Failed to compare the files', error }`.

Options are validated before rendering. Invalid values produce an `error` instead of being silently ignored:
`threshold` outside 0–1 or `NaN`, `excludedPages` that are not positive integers,
masks with a non-integer `pageNumber` or `x1 <= x0` / `y1 <= y0`, unknown `combineLabels` keys or labels longer than 100 characters,
`render.dpi` that is not a positive number, an empty `resultDir`.

## Usage

```ts
import path from 'node:path';
import { compareFiles } from 'pdf-pixel-diff';

const filesPath = path.join(
  process.cwd(),
  'files',
);

const expectedFilePath = path.join(
  filesPath,
  'expected.pdf',
);

const actualFilePath = path.join(
  filesPath,
  'actual.pdf',
);

const result = await compareFiles(expectedFilePath, actualFilePath, {
  resultDir: filesPath,
  render: {
    dpi: 150,
  },
  compare: {
    threshold: 0.1,
    includeAA: false,
    combineImages: true,
    combineLabels: {
      expected: 'prod',
      actual: 'staging',
    },
    excludedPages: [2],
    masks: [
      {
        pageNumber: 1,
        color: 'black',
        x0: 100,
        y0: 1580,
        x1: 690,
        y1: 1610,
      },
    ],
  },
});

console.log(result);
```

### Parallel test runs

Every call writes into its own new subfolder of `resultDir`, created atomically (`mkdtemp`),
so concurrent calls never share files, even with the same `resultDir` and from different processes.
Diff images of a call are in `path.join(result.resultDir, 'difference')` (with `detailedResult: true` also in `result.pages[].diffImagePath`).

A readable `resultDir` per test still helps to find results later. With Playwright:

```ts
test('budget book PDF', async ({}, testInfo) => {
  const result = await compareFiles(expectedPath, actualPath, {
    resultDir: testInfo.outputPath('pdf-diff'),
    compare: { combineImages: true },
  });

  if (!result.passed && result.resultDir) {
    const differenceDir = path.join(result.resultDir, 'difference');

    for (const file of fs.readdirSync(differenceDir)) {
      await testInfo.attach(file, { path: path.join(differenceDir, file), contentType: 'image/png' });
    }
  }

  expect(result.error).toBeUndefined();
  expect(result.passed, result.message).toBe(true);
});
```

## Output

Each call creates a run subfolder in `resultDir` (default `<cwd>/pdf-pixel-diff`). Existing files in `resultDir`
are never touched. With the default `keepResults: 'failed'` the run subfolder is removed when the documents are the same.

```
resultDir/
  2026-10-23T13-35-40-027Z-kVfTd2/   # one run = result.resultDir (absolute path)
    expected/    # every rendered expected page: expected-1.png ... (expected-01.png for 10-99 pages)
    actual/      # every rendered actual page: actual-1.png ...
    difference/  # only failed pages: difference-3.png ... (combined image when combineImages is true)
```

Run subfolders sort by time. Failed runs accumulate until you delete them (e.g. clean `resultDir` before a test run).

Page numbers in file names are zero-padded: rendered pages to the page count of their own document (Poppler naming),
diff images to the number of compared pages, i.e. `min(expectedPages, actualPages)`.
`result.resultDir` is the absolute path of the run folder, so a call's diff images are `path.join(result.resultDir, 'difference')`.
For short log output use `path.relative(process.cwd(), result.resultDir)` or `path.basename(result.resultDir)`.

Notes:

- Only pages up to `min(expectedPages, actualPages)` are compared; the rest are reported as `missing`.
- If page counts differ, the result is marked as failed.
- Documents with mixed orientation are supported: each page is rendered at its own size.

## Upgrading from 1.x

| 1.x | 2.0 |
| --- | --- |
| Node.js >= 20, `node-poppler` 9 | Node.js >= 22, `node-poppler` 11 (rendering output is identical) |
| `pixelmatch` 7 (YIQ color distance), `sharp` 0.34 | `pixelmatch` 8 (OKLab color distance, closer to human perception), `sharp` 0.35. `threshold` keeps its 0–1 scale and 0.1 default, but per-page diff pixel counts can differ slightly; on the tested documents the same pages pass and fail |
| Pages with different sizes (e.g. changed orientation) returned `error: Images must have the same dimensions` | The page gets status `size-mismatch` and is listed in `differentPages`; no `error` |
| Results were written directly into `resultDir` (`resultDir/difference/...`) and overwritten by the next call | Every call writes into a new subfolder `resultDir/<timestamp>-<random>/difference/...`; read them from `path.join(result.resultDir, 'difference')` |
| Concurrent calls with the same `resultDir` silently overwrote each other | Impossible: each call has its own subfolder |
| Results were always kept | Removed when the documents are the same (`keepResults: 'failed'`; `'all'` keeps everything) |
| Invalid options (masks with `x1 <= x0`, non-integer `pageNumber`, `threshold` outside 0–1, ...) were ignored | Returned as `error` before rendering |
| Combined image of a landscape page was horizontal | Vertical by default (`combineLayout: 'horizontal'` restores 1.x) |
| `CompareFilesResult` had no per-page data | Optional `pages: PageResult[]` with `detailedResult: true` |
| "baseline" naming | "expected": folder `expected/` (was `baseline/`), files `expected-N.png`, combined image label `Expected`, `combineLabels.expected`, `PageResult.expectedSize`, first parameter `expectedFile` |
| `message: 'Documents are different: baseline N pages, actual M pages'` | `'Documents are different: expected N pages, actual M pages'` |

Unchanged: other `message` texts, `passed`, `differentPages`, `actual/` and `difference/` file names inside a run folder.

## Performance and memory

Memory use stays low and does not grow with the document size: pages are rendered to PNG files on disk
and compared one page at a time, so only the current page is held in memory
(expected, actual and diff bitmaps, about 25 MB for a US Letter page at 150 DPI).

Measured peak memory of the Node process (Linux arm64, Node 22; ~100 MB of it is the baseline of the Node process and the TypeScript loader used for the measurement):

| Comparison | Time | Peak RSS |
| --- | --- | --- |
| 60 + 60 pages, 150 DPI | ~5 s | ~270 MB |
| 60 + 60 pages, 300 DPI | ~18 s | ~340 MB |
| 220 + 293 pages (real budget document), 150 DPI, combined images | ~100 s | ~340 MB (+ ~86 MB for Poppler processes while rendering) |
| 8 comparisons in a row in one process | — | stable ~247 MB, no growth |

Memory grows with the number of comparisons running **at the same time in one process**
(about +40 MB each: ~400 MB for 4, ~530 MB for 8), not with the number of pages.
Limit concurrency if you start many comparisons with `Promise.all`.

Disk: every rendered page is stored as PNG (~70 KB per page at 150 DPI); a 513-page run takes ~160 MB.
Run folders of passed comparisons are removed by default (`keepResults: 'failed'`).

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

### Page reported as `size-mismatch`

Rendered page images differ in width/height. The page fails, but the rest of the document is still compared.
Both images are padded to a common canvas, so the diff / combined image shows where they differ
(on the combined image the padding and the separators between panels are gray). Typical causes:

- Changed page orientation or page size
- Different crop boxes (try `render.useCropBox: true`)

### I expected a diff image but none was produced

Diff images are only written for pages with status `different` or `size-mismatch`. Check:

- `result.pages` with `detailedResult: true` (status and `diffPixels` per page)
- `compare.excludedPages`
- `result.error`

## Key Features

- PDF to PNG rendering via Poppler
- Page-by-page pixel comparison with configurable threshold and AA handling
- Mixed portrait / landscape documents, including pages whose orientation changed
- Per-page results with diff pixel counts and diff image paths
- Rectangular masks to ignore dynamic regions, optionally per orientation
- Optional combined output image (Expected | Actual | Difference), vertical for landscape pages

## License

This project is licensed under the ISC License.

