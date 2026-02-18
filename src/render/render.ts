
import { Poppler } from 'node-poppler';

const DEFAULT_DPI = 150;

export type RenderOptions = {
  dpi?: number;
};

export class Render {
  private static poppler: Poppler | null = null;

  static init () {
    if (this.poppler) {
      return this.poppler;
    }

    try {
      this.poppler = new Poppler();
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : String(err);

      if (msg.includes('binaries')) {
        throw new Error(
          'Failed to find Poppler binaries. Please double check the documentation for installation instructions.',
        );
      }

      throw new Error(`Failed to initialize Poppler: ${msg}`);
    }

    return this.poppler;
  }

  static async getTotalPages (
    pdf: string | Buffer,
    fileName: string,
  ): Promise<number> {
    const info = await this.init().pdfInfo(pdf, {
      printAsJson: true,
    });

    if (typeof info === 'string') {
      throw new Error(`Failed to get info for ${fileName} PDF file`);
    }

    const totalPages = Number(info.pages);

    if (!Number.isFinite(totalPages) || totalPages <= 0) {
      throw new Error(`Unable to determine PDF page count for ${fileName} PDF file`);
    }

    return totalPages;
  }

  static async pdfToImages (
    pdf: string | Buffer,
    outPrefix: string,
    options: RenderOptions = {},
  ): Promise<void> {
    await this.init().pdfToCairo(pdf, outPrefix, {
      pngFile: true,
      resolutionXYAxis: options.dpi || DEFAULT_DPI,
    });
  }
}