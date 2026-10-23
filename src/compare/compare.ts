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
const DEFAULT_COMBINE_LAYOUT: CombineLayout = 'auto';
const SEPARATOR_SIZE = 10;

const DEFAULT_LABELS: Required<CombineLabelTexts> = {
  expected: 'Expected',
  actual: 'Actual',
  difference: 'Difference',
};

const LABEL = {
  font: 'sans-serif 18',
  maxLength: 100,
  margin: 10,
  paddingX: 8,
  paddingY: 6,
  ellipsis: '…',
};

export type Orientation = 'portrait' | 'landscape';

export type Mask = {
  pageNumber: number;
  orientation?: Orientation;
  color?: 'black' | 'transparent';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type CombineLayout = 'auto' | 'horizontal' | 'vertical';

export type CombineLabelTexts = {
  expected?: string;
  actual?: string;
  difference?: string;
};

export type CombineLabels = false | CombineLabelTexts;

export type CompareOptions = {
  threshold?: number;
  includeAA?: boolean;
  combineImages?: boolean;
  combineLayout?: CombineLayout;
  combineLabels?: CombineLabels;
  excludedPages?: number[];
  masks?: Mask[];
};

export type Size = {
  width: number;
  height: number;
};

export type PageStatus =
  | 'equal'
  | 'different'
  | 'size-mismatch'
  | 'excluded'
  | 'missing';

export type PageResult = {
  page: number;
  status: PageStatus;
  diffPixels: number;
  diffRatio: number;
  expectedSize?: Size;
  actualSize?: Size;
  diffImagePath?: string;
};

export type CompareResult = {
  passed: boolean;
  message: string;
  excludedPages: number[];
  differentPages: number[];
  pages: PageResult[];
};

type RawImage = Size & {
  data: Buffer;
};

type Label = Size & {
  input: Buffer;
};

export class Compare {
  private static labelCache = new Map<string, Promise<Label | null>>();

  static validateOptions (
    options: CompareOptions = {},
  ): void {
    this.validateRange('threshold', options.threshold, 0, 1);
    this.validateExcludedPages(options.excludedPages);
    this.validateMasks(options.masks);
    this.validateLabels(options.combineLabels);
  }

  private static validateRange (
    name: string,
    value: number | undefined,
    min: number,
    max: number,
  ): void {
    if (value === undefined) {
      return;
    }

    if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
      throw new Error(`Invalid ${name}: ${String(value)}. Expected a number from ${min} to ${max}`);
    }
  }

  private static validateExcludedPages (
    pages: number[] | undefined,
  ): void {
    if (pages === undefined) {
      return;
    }

    if (!Array.isArray(pages) || pages.some((p) => !Number.isInteger(p) || p < 1)) {
      throw new Error(`Invalid excludedPages: ${JSON.stringify(pages)}. Expected an array of 1-based page numbers`);
    }
  }

  private static validateLabels (
    labels: CombineLabels | undefined,
  ): void {
    if (labels === undefined || labels === false) {
      return;
    }

    if (typeof labels !== 'object' || labels === null) {
      throw new Error('Invalid combineLabels: expected false or an object');
    }

    for (const [key, text] of Object.entries(labels)) {
      if (!(key in DEFAULT_LABELS)) {
        throw new Error(`Invalid combineLabels.${key}: expected one of ${Object.keys(DEFAULT_LABELS).join(', ')}`);
      }

      if (text === undefined) {
        continue;
      }

      if (typeof text !== 'string' || text.length > LABEL.maxLength) {
        throw new Error(`Invalid combineLabels.${key}: expected a string of at most ${LABEL.maxLength} characters`);
      }
    }
  }

  private static validateMasks (
    masks: Mask[] = [],
  ): void {
    masks.forEach((m, i) => {
      const coordinates = [m.pageNumber, m.x0, m.y0, m.x1, m.y1];

      if (
        coordinates.some((v) => !Number.isFinite(v)) ||
        !Number.isInteger(m.pageNumber) ||
        m.pageNumber < 0 ||
        m.x1 <= m.x0 ||
        m.y1 <= m.y0
      ) {
        throw new Error(
          `Invalid mask #${i}: ${JSON.stringify(m)}. Expected an integer pageNumber >= 0, x1 > x0 and y1 > y0`,
        );
      }
    });
  }

  static getOrientation (
    size: Size,
  ): Orientation {
    return size.width > size.height
      ? 'landscape'
      : 'portrait';
  }

  private static chooseMaskAlpha (
    color: Mask['color'],
  ): number {
    return color === 'transparent'
      ? 0
      : 255;
  }

  private static clamp (
    v: number,
    min: number,
    max: number,
  ): number {
    return Math.max(min, Math.min(max, v));
  }

  private static fillRect (
    image: RawImage,
    mask: Mask,
  ): void {
    const { data, width, height } = image;
    const x0 = this.clamp(Math.floor(mask.x0), 0, width);
    const y0 = this.clamp(Math.floor(mask.y0), 0, height);
    const x1 = this.clamp(Math.ceil(mask.x1), 0, width);
    const y1 = this.clamp(Math.ceil(mask.y1), 0, height);
    const alpha = this.chooseMaskAlpha(mask.color);

    for (let y = y0; y < y1; y++) {
      for (let idx = (y * width + x0) * 4, end = (y * width + x1) * 4; idx < end; idx += 4) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = alpha;
      }
    }
  }

  // Masks are matched against each image's own orientation, so a page that changed orientation is masked consistently per side.
  private static applyMasks (
    page: number,
    image: RawImage,
    masks: Mask[],
  ): void {
    const orientation = this.getOrientation(image);

    for (const m of masks) {
      if (m.pageNumber !== 0 && m.pageNumber !== page) {
        continue;
      }

      if (m.orientation && m.orientation !== orientation) {
        continue;
      }

      this.fillRect(image, m);
    }
  }

  private static async loadImage (
    file: string,
  ): Promise<RawImage> {
    const { data, info } = await sharp(file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { data, width: info.width, height: info.height };
  }

  // Extends the image to the target canvas with transparent pixels (anchored top-left).
  private static pad (
    image: RawImage,
    width: number,
    height: number,
  ): RawImage {
    if (image.width === width && image.height === height) {
      return image;
    }

    const data = Buffer.alloc(width * height * 4);
    const rowLength = image.width * 4;

    for (let y = 0; y < image.height; y++) {
      image.data.copy(data, y * width * 4, y * rowLength, (y + 1) * rowLength);
    }

    return { data, width, height };
  }

  private static async comparePage (
    page: number,
    expectedPath: string,
    actualPath: string,
    diffImagePath: string,
    options: CompareOptions,
  ): Promise<PageResult> {
    const pixelmatch = await getPixelmatch();

    const [expectedRaw, actualRaw] = await Promise.all([
      this.loadImage(expectedPath),
      this.loadImage(actualPath),
    ]);

    if (options.masks?.length) {
      this.applyMasks(page, expectedRaw, options.masks);
      this.applyMasks(page, actualRaw, options.masks);
    }

    const expectedSize = { width: expectedRaw.width, height: expectedRaw.height };
    const actualSize = { width: actualRaw.width, height: actualRaw.height };
    const sizeMismatch = expectedSize.width !== actualSize.width || expectedSize.height !== actualSize.height;

    const width = Math.max(expectedSize.width, actualSize.width);
    const height = Math.max(expectedSize.height, actualSize.height);
    const expected = this.pad(expectedRaw, width, height);
    const actual = this.pad(actualRaw, width, height);

    const diff = Buffer.alloc(width * height * 4);

    const diffPixels = pixelmatch(expected.data, actual.data, diff, width, height, {
      threshold: options.threshold ?? DEFAULT_THRESHOLD,
      includeAA: options.includeAA ?? DEFAULT_INCLUDE_AA,
    });

    const diffRatio = diffPixels / (width * height);

    const result: PageResult = {
      page,
      status: 'equal',
      diffPixels,
      diffRatio,
      expectedSize,
      actualSize,
    };

    if (!sizeMismatch && diffPixels === 0) {
      return result;
    }

    const diffImage = { data: diff, width, height };

    const image = options.combineImages
      ? await this.combineImages(expected, actual, diffImage, options.combineLayout ?? DEFAULT_COMBINE_LAYOUT, options.combineLabels)
      : sharp(diff, { raw: { width, height, channels: 4 } }).png();

    await image.toFile(diffImagePath);

    return {
      ...result,
      status: sizeMismatch
        ? 'size-mismatch'
        : 'different',
      diffImagePath,
    };
  }

  private static async combineImages (
    expected: RawImage,
    actual: RawImage,
    diff: RawImage,
    layout: CombineLayout,
    labels: CombineLabels = {},
  ): Promise<sharp.Sharp> {
    const { width, height } = expected;

    const vertical = layout === 'vertical' ||
      (layout === 'auto' && this.getOrientation(expected) === 'landscape');

    const texts = labels === false
      ? null
      : { ...DEFAULT_LABELS, ...labels };

    const cells: Array<[RawImage, string | undefined]> = [
      [expected, texts?.expected],
      [actual, texts?.actual],
      [diff, texts?.difference],
    ];

    const composites: sharp.OverlayOptions[] = [];

    for (const [i, [image, text]] of cells.entries()) {
      const left = vertical ? 0 : i * (width + SEPARATOR_SIZE);
      const top = vertical ? i * (height + SEPARATOR_SIZE) : 0;

      composites.push({ input: image.data, raw: { width, height, channels: 4 }, left, top });

      const label = text
        ? await this.getLabel(text, width - LABEL.margin * 2)
        : null;

      if (label && label.height + LABEL.margin * 2 <= height) {
        composites.push({
          input: label.input,
          left: left + width - label.width - LABEL.margin,
          top: top + LABEL.margin,
        });
      }
    }

    return sharp({
      create: {
        width: vertical ? width : width * 3 + SEPARATOR_SIZE * 2,
        height: vertical ? height * 3 + SEPARATOR_SIZE * 2 : height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .composite(composites)
      .png();
  }

  private static escapeMarkup (
    text: string,
  ): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private static async renderText (
    text: string,
  ): Promise<Label> {
    const { data, info } = await sharp({
      text: {
        text: `<span foreground="black">${this.escapeMarkup(text)}</span>`,
        font: LABEL.font,
        rgba: true,
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });

    return { input: data, width: info.width, height: info.height };
  }

  private static getLabel (
    text: string,
    maxWidth: number,
  ): Promise<Label | null> {
    const key = `${maxWidth}:${text}`;
    let label = this.labelCache.get(key);

    if (!label) {
      label = this.createLabel(text, maxWidth).catch(() => null);
      this.labelCache.set(key, label);
    }

    return label;
  }

  // Pango crops output to the ink extents, so the box height is derived from a reference string to keep all labels the same height.
  private static async createLabel (
    text: string,
    maxWidth: number,
  ): Promise<Label | null> {
    const available = maxWidth - LABEL.paddingX * 2;
    const reference = await this.renderText('ÁÉgjpqy|');
    const fitted = await this.fitText(text, available);

    if (!fitted) {
      return null;
    }

    const width = fitted.width + LABEL.paddingX * 2;
    const height = reference.height + LABEL.paddingY * 2;

    const input = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 235, g: 235, b: 235, alpha: 0.9 },
      },
    })
      .composite([{
        input: fitted.input,
        left: LABEL.paddingX,
        top: Math.round((height - fitted.height) / 2),
      }])
      .png()
      .toBuffer();

    return { input, width, height };
  }

  // Truncates with an ellipsis (binary search over code points) until the rendered text fits.
  private static async fitText (
    text: string,
    maxWidth: number,
  ): Promise<Label | null> {
    const full = await this.renderText(text);

    if (full.width <= maxWidth) {
      return full;
    }

    const chars = Array.from(text);
    let low = 1;
    let high = chars.length - 1;
    let best: Label | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = await this.renderText(chars.slice(0, mid).join('').trimEnd() + LABEL.ellipsis);

      if (candidate.width <= maxWidth) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  // Same wording as 1.0.x so existing assertions on `message` keep working; details are in `pages`.
  private static buildMessage (
    differentPages: number[],
    expectedTotalPages: number,
    actualTotalPages: number,
  ): string {
    if (expectedTotalPages !== actualTotalPages) {
      return `Documents are different: expected ${expectedTotalPages} pages, actual ${actualTotalPages} pages`;
    }

    return differentPages.length > 0
      ? 'Documents are different'
      : 'Documents are the same';
  }

  static async compareAllPageImages (
    expectedTotalPages: number,
    actualTotalPages: number,
    expectedDirectory: string,
    actualDirectory: string,
    differenceDirectory: string,
    options: CompareOptions = {},
  ): Promise<CompareResult> {
    const excludedPages = options.excludedPages ?? [];
    const comparablePages = Math.min(expectedTotalPages, actualTotalPages);
    const totalPages = Math.max(expectedTotalPages, actualTotalPages);
    const digits = String(comparablePages).length;

    const expectedImages = Directory.mapPageImages(expectedDirectory);
    const actualImages = Directory.mapPageImages(actualDirectory);

    const pages: PageResult[] = [];

    for (let page = 1; page <= totalPages; page++) {
      if (excludedPages.includes(page)) {
        pages.push({ page, status: 'excluded', diffPixels: 0, diffRatio: 0 });
        continue;
      }

      if (page > comparablePages) {
        pages.push({ page, status: 'missing', diffPixels: 0, diffRatio: 0 });
        continue;
      }

      const expectedImage = expectedImages.get(page);
      const actualImage = actualImages.get(page);

      if (!expectedImage || !actualImage) {
        throw new Error(`Rendered image for page ${page} not found in expected or actual directory`);
      }

      pages.push(await this.comparePage(
        page,
        path.join(expectedDirectory, expectedImage),
        path.join(actualDirectory, actualImage),
        path.join(differenceDirectory, `difference-${String(page).padStart(digits, '0')}.png`),
        options,
      ));
    }

    const differentPages = pages
      .filter((p) => p.status === 'different' || p.status === 'size-mismatch')
      .map((p) => p.page);

    const message = this.buildMessage(differentPages, expectedTotalPages, actualTotalPages);

    return {
      passed: differentPages.length === 0 && expectedTotalPages === actualTotalPages,
      message,
      excludedPages,
      differentPages,
      pages,
    };
  }
};
