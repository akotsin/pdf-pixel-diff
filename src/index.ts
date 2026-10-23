import path from 'node:path';
import { Directory } from './directory/directory';
import {
  Render,
  RenderOptions,
} from './render/render';
import {
  Compare,
  CompareResult,
  CompareOptions,
  CombineLabels,
  CombineLabelTexts,
  CombineLayout,
  Mask,
  Orientation,
  PageResult,
  PageStatus,
  Size,
} from './compare/compare';

export type {
  RenderOptions,
  CompareOptions,
  CombineLabels,
  CombineLabelTexts,
  CombineLayout,
  Mask,
  Orientation,
  PageResult,
  PageStatus,
  Size,
};

export type KeepResults = 'failed' | 'all' | 'none';

const KEEP_RESULTS: KeepResults[] = ['failed', 'all', 'none'];

export type Options = {
  resultDir?: string;
  keepResults?: KeepResults;
  detailedResult?: boolean;
  render?: RenderOptions,
  compare?: CompareOptions,
};

export type CompareFilesResult = Omit<CompareResult, 'pages'> & {
  /** per-page details, only with `detailedResult: true` */
  pages?: PageResult[];
  resultDir?: string;
  error?: Error;
};

function validateKeepResults (
  keepResults: KeepResults | undefined,
): void {
  if (keepResults !== undefined && !KEEP_RESULTS.includes(keepResults)) {
    throw new Error(`Invalid keepResults: ${String(keepResults)}. Expected one of ${KEEP_RESULTS.join(', ')}`);
  }
}

function validateDetailedResult (
  detailedResult: boolean | undefined,
): void {
  if (detailedResult !== undefined && typeof detailedResult !== 'boolean') {
    throw new Error(`Invalid detailedResult: ${String(detailedResult)}. Expected true or false`);
  }
}

function withPages (
  result: CompareResult,
  detailedResult: boolean | undefined,
  removed: boolean,
): CompareFilesResult {
  const { pages, ...summary } = result;

  if (!detailedResult) {
    return summary;
  }

  return {
    ...summary,
    pages: removed
      ? pages.map(({ diffImagePath: _removed, ...page }) => page)
      : pages,
  };
}

function shouldKeep (
  keepResults: KeepResults,
  passed: boolean,
): boolean {
  return keepResults === 'all' || (keepResults === 'failed' && !passed);
}

export async function compareFiles (
  expectedFile: string | Buffer,
  actualFile: string | Buffer,
  options: Options = {},
): Promise<CompareFilesResult> {
  let runDir: string | undefined;
  const keepResults = options.keepResults ?? 'failed';

  try {
    Directory.validateFilePath(expectedFile);
    Directory.validateFilePath(actualFile);
    Compare.validateOptions(options.compare);
    validateKeepResults(options.keepResults);
    validateDetailedResult(options.detailedResult);

    runDir = Directory.createRunDirectory(options.resultDir);

    const [expectedTotalPages, actualTotalPages] = await Promise.all([
      Render.getTotalPages(expectedFile, 'expected'),
      Render.getTotalPages(actualFile, 'actual'),
    ]);

    const { expected, actual, difference } = Directory.createResultDirectories(runDir);

    await Promise.all([
      Render.pdfToImages(expectedFile, Directory.addPrefixToPath(expected), options.render),
      Render.pdfToImages(actualFile, Directory.addPrefixToPath(actual), options.render),
    ]);

    const result = await Compare.compareAllPageImages(
      expectedTotalPages,
      actualTotalPages,
      expected,
      actual,
      difference,
      options.compare,
    );

    const keep = shouldKeep(keepResults, result.passed);

    if (!keep) {
      Directory.removeRunDirectory(runDir);
    }

    return {
      ...withPages(result, options.detailedResult, !keep),
      resultDir: path.basename(runDir),
    };
  } catch (error) {
    if (runDir && !shouldKeep(keepResults, false)) {
      Directory.removeRunDirectory(runDir);
    }

    return {
      passed: false,
      message: 'Failed to compare the files',
      differentPages: [],
      ...(options.detailedResult ? { pages: [] } : {}),
      excludedPages: options.compare?.excludedPages ?? [],
      resultDir: runDir && path.basename(runDir),
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
