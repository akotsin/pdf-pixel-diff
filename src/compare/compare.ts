import path from 'node:path';
import sharp from 'sharp';
import { Directory } from '../directory/directory';

/**
 * `pixelmatch` is ESM-only, so it can't be loaded via `require()` from CommonJS.
 * To keep this package dual (ESM + CJS), we load `pixelmatch` via dynamic `import()`.
 */
type PixelmatchModule = typeof import('pixelmatch');

let pixelmatchModulePromise: Promise<PixelmatchModule> | undefined;

async function getPixelmatch (): Promise<PixelmatchModule['default']> {
  if (!pixelmatchModulePromise) {
    pixelmatchModulePromise = import('pixelmatch');
  }

  const m = await pixelmatchModulePromise;
  return m.default;
}

const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_INCLUDE_AA = false;

type Mask = {
  pageNumber: number;
  color?: 'black' | 'transparent';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type CompareOptions = {
  threshold?: number;
  includeAA?: boolean;
  combineImages?: boolean;
  excludedPages?: number[];
  masks?: Mask[];
};

export type CompareResult = {
  passed: boolean;
  message: string;
  excludedPages: number[];
  differentPages: number[];
};

export class Compare {
  private static chooseMaskColor (
    color: Mask['color'],
  ): number {
    switch (color) {
    case 'transparent':
      return 0;
    case 'black':
      return 255;
    default:
      return 255;
    };
  }

  private static clamp (
    v: number,
    min: number,
    max: number,
  ): number {
    return Math.max(min, Math.min(max, v));
  }

  private static applyRectMaskCopyBaseline (
    baseline: Buffer,
    actual: Buffer,
    width: number,
    height: number,
    rect: { x0: number; y0: number; x1: number; y1: number },
    color: Mask['color'],
  ): void {
    const x0 = this.clamp(Math.floor(rect.x0), 0, width);
    const y0 = this.clamp(Math.floor(rect.y0), 0, height);
    const x1 = this.clamp(Math.ceil(rect.x1), 0, width);
    const y1 = this.clamp(Math.ceil(rect.y1), 0, height);

    for (let y = y0; y < y1; y++) {
      let idx = (y * width + x0) * 4;
      const end = (y * width + x1) * 4;
      while (idx < end) {
        actual[idx] = baseline[idx] = 0;
        actual[idx + 1] = baseline[idx + 1] = 0;
        actual[idx + 2] = baseline[idx + 2] = 0;
        actual[idx + 3] = baseline[idx + 3] = this.chooseMaskColor(color);
        idx += 4;
      }
    }
  }

  private static applyMasksForPage (
    pageIndex: number,
    baseline: Buffer,
    actual: Buffer,
    width: number,
    height: number,
    masks: Mask[],
  ): void {
    for (const m of masks) {
      if (
        m.pageNumber !== 0 &&
        m.pageNumber !== pageIndex
      ) {
        continue;
      }

      this.applyRectMaskCopyBaseline(baseline, actual, width, height, {
        x0: m.x0,
        y0: m.y0,
        x1: m.x1,
        y1: m.y1,
      }, m.color);
    }
  }

  private static async compareOnePageImages (
    pageIndex: number,
    baseline: string,
    actual: string,
    diffImagePath: string,
    options?: CompareOptions,
  ): Promise<boolean> {
    const pixelmatch = await getPixelmatch();

    const baselineRaw = await sharp(baseline)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const actualRaw = await sharp(actual)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (
      baselineRaw.info.width !== actualRaw.info.width ||
      baselineRaw.info.height !== actualRaw.info.height
    ) {
      throw new Error(
        'Images must have the same dimensions: ' + '/n' +
        `  baseline=${baselineRaw.info.width}x${baselineRaw.info.height}` + '/n' +
        `  actual=${actualRaw.info.width}x${actualRaw.info.height}`,
      );
    }

    const { width, height } = baselineRaw.info;

    if (options?.masks && options.masks.length > 0) {
      this.applyMasksForPage(
        pageIndex,
        baselineRaw.data,
        actualRaw.data,
        width,
        height,
        options.masks,
      );
    }

    const diffBuffer = Buffer.alloc(width * height * 4);

    const diffPixels = pixelmatch(
      baselineRaw.data,
      actualRaw.data,
      diffBuffer,
      width,
      height,
      {
        threshold: options?.threshold ?? DEFAULT_THRESHOLD,
        includeAA: options?.includeAA ?? DEFAULT_INCLUDE_AA,
      },
    );

    if (diffPixels > 0) {

      const baseImage = sharp(diffBuffer, { raw: { width, height, channels: 4 } })
        .png();

      if (options?.combineImages) {
        const diffBuffer = await baseImage.toBuffer();

        const combinedImage = await this.combineImages(
          baselineRaw.data,
          actualRaw.data,
          diffBuffer,
          width,
          height,
        );

        await combinedImage.toFile(diffImagePath);
      } else {
        await baseImage.toFile(diffImagePath);
      }

      return false;
    }

    return true;
  }

  private static async combineImages (
    baselineBuffer: Buffer,
    actualBuffer: Buffer,
    diffBuffer: Buffer,
    width: number,
    height: number,
  ): Promise<sharp.Sharp> {
    try {
      const [watermark1, watermark2, watermark3] = await Promise.all([
        sharp(this.addWatermark('Baseline')).toBuffer(),
        sharp(this.addWatermark('Actual')).toBuffer(),
        sharp(this.addWatermark('Difference')).toBuffer(),
      ]);

      const lineWidth = 10;

      const combinedWidth = width * 3 + lineWidth * 2;
      const combinedHeight = height;

      return sharp({
        create: {
          width: combinedWidth,
          height: combinedHeight,
          channels: 3,
          background: { r: 0, g: 0, b: 0 },
        },
      })
        .composite([
          { input: baselineBuffer, raw: { width, height, channels: 4 }, left: 0, top: 0 },
          { input: watermark1, left: width - 130, top: 10 },
          { input: actualBuffer, raw: { width, height, channels: 4 }, left: (width + lineWidth), top: 0 },
          { input: watermark2, left: 2 * (width + lineWidth) - 130, top: 10 },
          { input: diffBuffer, left: 2 * (width + lineWidth), top: 0 },
          { input: watermark3, left: 3 * (width + lineWidth) - 130, top: 10 },
        ])
        .png();
    } catch {
      throw new Error('Failed to create the combined image!');
    }
  }

  private static addWatermark (
    text: string,
  ): Buffer {
    const watermarkSvg = Buffer.from(
      `<svg width="120" height="30" viewBox="0 0 100 30">
        <text x="0" y="20" font-size="20" fill="black" font-family="Arial" text-anchor="start">${text}</text>
      </svg>`,
    );

    return watermarkSvg;
  }

  static async compareAllPageImages (
    baselineTotalPages: number,
    actualTotalPages: number,
    baselineDirectory: string,
    actualDirectory: string,
    differenceDirectory: string,
    options: CompareOptions = {},
  ): Promise<CompareResult> {
    // Result data to return
    const result: CompareResult = {
      passed: true,
      message: 'Documents are the same',
      differentPages: [],
      excludedPages: options?.excludedPages ?? [],
    };

    const pagesToCheck = Math.min(baselineTotalPages, actualTotalPages);
    const digits = Math.abs(pagesToCheck).toString().length;

    const baselineImages = Directory.showAllFilesInDirectory(baselineDirectory);
    const actualImages = Directory.showAllFilesInDirectory(actualDirectory);

    for (let i = 1; i <= pagesToCheck; i++) {
      if (result.excludedPages.includes(i)) {
        continue;
      }

      const diffImageName = `difference-${String(i).padStart(digits, '0')}.png`;

      const baselineImage = baselineImages[i - 1];
      const actualImage = actualImages[i - 1];

      if (!baselineImage || !actualImage) {
        throw new Error(`Image ${i} not found in baseline or actual directory`);
      }

      const isEqual = await this.compareOnePageImages(
        i,
        path.join(baselineDirectory, baselineImage),
        path.join(actualDirectory, actualImage),
        path.join(differenceDirectory, diffImageName),
        options,
      );

      if (!isEqual) {
        result.differentPages.push(i);
      }
    }

    if (result.differentPages.length > 0) {
      result.passed = false;
      result.message = 'Documents are different';
    }

    if (baselineTotalPages !== actualTotalPages) {
      result.passed = false;
      result.message = 'Documents are different: baseline ' + baselineTotalPages + ' pages, actual ' + actualTotalPages + ' pages';
    }

    return result;
  }
};