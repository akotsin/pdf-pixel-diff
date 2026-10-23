# pdf-pixel-diff

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-blue.svg)](https://www.typescriptlang.org/)
[![Module](https://img.shields.io/badge/Module-ESM%20%2B%20CJS-purple.svg)](https://nodejs.org/api/packages.html#conditional-exports)
[![node-poppler](https://img.shields.io/badge/node--poppler-9.1.1-brightgreen.svg)](https://www.npmjs.com/package/node-poppler)
[![sharp](https://img.shields.io/badge/sharp-0.34.5-brightgreen.svg)](https://www.npmjs.com/package/sharp)
[![pixelmatch](https://img.shields.io/badge/pixelmatch-7.1.0-brightgreen.svg)](https://www.npmjs.com/package/pixelmatch)

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
     * output directory; relative paths are resolved against `cwd`.
     * default: a new unique directory per call, `<cwd>/pdf-pixel-diff/<ISO timestamp>-<random>`
     */
    resultDir?: string;

    /**
     * what to keep on disk after the comparison
     * - 'failed': keep results only when the comparison failed (default when `resultDir` is not set)
     * - 'all': always keep (default when `resultDir` is set)
     * - 'none': always remove
     * removing deletes the generated directory, or only the `expected/`, `actual/`, `difference/` subfolders of an explicit `resultDir`
     */
    keepResults?: 'failed' | 'all' | 'none';

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
  pages: PageResult[];
  /** absolute path of the directory used for this call (set unless validation failed before it was chosen) */
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
masks with a non-integer `pageNumber` or `x1 <= x0` / `y1 <= y0`, unknown `combineLabels` keys or labels longer than 100 characters.

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

Without `resultDir` every call gets its own directory, so parallel calls never collide.

An explicit `resultDir` is locked for the duration of the call (`<resultDir>/.pdf-pixel-diff.lock`).
A concurrent call with the same `resultDir` (from any process on the machine or the same process) does not wait:
it returns `error: Result directory "..." is in use by pid N on <host> since <time>`.
Waiting would not help, because callers usually read the result files after `compareFiles` returns.
A lock left by a killed process is taken over when its pid is no longer alive on the same host, or after 30 minutes.

Use a separate `resultDir` for each concurrent comparison. With Playwright:

```ts
test('budget book PDF', async ({}, testInfo) => {
  const result = await compareFiles(expectedPath, actualPath, {
    resultDir: testInfo.outputPath('pdf-diff'),
    compare: { combineImages: true },
  });

  for (const page of result.pages.filter((p) => p.diffImagePath)) {
    await testInfo.attach(`page ${page.page} (${page.status})`, { path: page.diffImagePath!, contentType: 'image/png' });
  }

  expect(result.error).toBeUndefined();
  expect(result.passed, result.message).toBe(true);
});
```

## Output

`resultDir` gets three subfolders. They are created if missing and **emptied on each run**;
other files in `resultDir` are not touched. Without `resultDir` a new `<cwd>/pdf-pixel-diff/<ISO timestamp>-<random>`
directory is created per call and, with the default `keepResults: 'failed'`, removed when the documents are the same.

```
resultDir/
  expected/    # every rendered expected page: expected-1.png ... (expected-01.png for 10-99 pages)
  actual/      # every rendered actual page: actual-1.png ...
  difference/  # only failed pages: difference-3.png ... (combined image when combineImages is true)
```

Page numbers in file names are zero-padded: rendered pages to the page count of their own document (Poppler naming),
diff images to the number of compared pages, i.e. `min(expectedPages, actualPages)`.
Use `result.pages[].diffImagePath` (absolute) instead of building paths by hand.

Notes:

- Only pages up to `min(expectedPages, actualPages)` are compared; the rest are reported as `missing`.
- If page counts differ, the result is marked as failed.
- Documents with mixed orientation are supported: each page is rendered at its own size.
- Parallel comparisons must use different `resultDir` values (see [Parallel test runs](#parallel-test-runs)).

## Upgrading from 1.x

| 1.x | 2.0 |
| --- | --- |
| Pages with different sizes (e.g. changed orientation) returned `error: Images must have the same dimensions` | The page gets status `size-mismatch` and is listed in `differentPages`; no `error` |
| Without `resultDir` all calls shared `<cwd>/pdf-pixel-diff` | Unique directory per call; returned in `result.resultDir`, removed on pass (`keepResults`) |
| Concurrent calls with the same `resultDir` silently overwrote each other | The second call returns a lock `error` |
| Invalid options (masks with `x1 <= x0`, non-integer `pageNumber`, `threshold` outside 0–1, ...) were ignored | Returned as `error` before rendering |
| Combined image of a landscape page was horizontal | Vertical by default (`combineLayout: 'horizontal'` restores 1.x) |
| `CompareFilesResult` had no per-page data | Required `pages: PageResult[]` (add `pages: []` to hand-written mocks) |
| "baseline" naming | "expected": folder `expected/` (was `baseline/`), files `expected-N.png`, combined image label `Expected`, `combineLabels.expected`, `PageResult.expectedSize`, first parameter `expectedFile` |
| `message: 'Documents are different: baseline N pages, actual M pages'` | `'Documents are different: expected N pages, actual M pages'` |

Unchanged: other `message` texts, `passed`, `differentPages`, `actual/` and `difference/` file names.

## Troubleshooting

### “Result directory ... is in use”

Two comparisons ran with the same `resultDir` at the same time. Give each one its own `resultDir`
(e.g. include the test name or id), or omit `resultDir` to get a unique directory per call.

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
Both images are padded to a common canvas, so the diff / combined image shows where they differ. Typical causes:

- Changed page orientation or page size
- Different crop boxes (try `render.useCropBox: true`)

### I expected a diff image but none was produced

Diff images are only written for pages with status `different` or `size-mismatch`. Check:

- `result.pages` (status and `diffPixels` per page)
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

