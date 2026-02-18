import { Directory } from './directory/directory.js';
import {
  Render,
  RenderOptions,
} from './render/render';
import {
  Compare,
  CompareResult,
  CompareOptions,
} from './compare/compare';

export type Options = {
  resultDir?: string;
  render?: RenderOptions,
  compare?: CompareOptions,
};

export type CompareFilesResult = CompareResult & {
  error?: Error;
};

export async function compareFiles (
  baselineFile: string | Buffer,
  actualFile: string | Buffer,
  options?: Options,
): Promise<CompareFilesResult> {
  try {
    // Check if the files exist
    Directory.validateFilePath(baselineFile);
    Directory.validateFilePath(actualFile);

    // Get the total pages of the expected and actual files
    const [baselineTotalPages, actualTotalPages] = await Promise.all([
      Render.getTotalPages(baselineFile, 'baseline'),
      Render.getTotalPages(actualFile, 'actual'),
    ]);

    // Create the result directories
    const { baseline, actual, difference } = Directory.createResultDirectories(options?.resultDir);

    // Add the prefix to the baseline and actual directories
    const baselineFilePrefix = Directory.addPrefixToPath(baseline);
    const actualFilePrefix = Directory.addPrefixToPath(actual);

    // Render the expected and actual files to images
    await Promise.all([
      Render.pdfToImages(baselineFile, baselineFilePrefix, options?.render),
      Render.pdfToImages(actualFile, actualFilePrefix, options?.render),
    ]);

    // Compare the all pages of the expected and actual files
    return await Compare.compareAllPageImages(
      baselineTotalPages,
      actualTotalPages,
      baseline,
      actual,
      difference,
      options?.compare,
    );
  } catch (error) {
    return {
      passed: false,
      message: 'Failed to compare the files',
      differentPages: [],
      excludedPages: options?.compare?.excludedPages ?? [],
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}