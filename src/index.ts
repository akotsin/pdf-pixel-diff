import {
  Directory,
  ResultDirectory,
} from './directory/directory';
import { ResultLock } from './directory/lock';
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
  render?: RenderOptions,
  compare?: CompareOptions,
};

export type CompareFilesResult = CompareResult & {
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
  let directory: ResultDirectory | undefined;
  let release: (() => void) | undefined;
  let keepResults: KeepResults = 'all';

  try {
    try {
      Directory.validateFilePath(expectedFile);
      Directory.validateFilePath(actualFile);
      Compare.validateOptions(options.compare);
      validateKeepResults(options.keepResults);

      directory = Directory.resolveResultDirectory(options.resultDir);
      keepResults = options.keepResults ?? (directory.generated ? 'failed' : 'all');
      release = ResultLock.acquire(directory.path);

      const [expectedTotalPages, actualTotalPages] = await Promise.all([
        Render.getTotalPages(expectedFile, 'expected'),
        Render.getTotalPages(actualFile, 'actual'),
      ]);

      const { expected, actual, difference } = Directory.createResultDirectories(directory.path);

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

      if (shouldKeep(keepResults, result.passed)) {
        return { ...result, resultDir: directory.path };
      }

      Directory.removeResults(directory);

      return {
        ...result,
        pages: result.pages.map(({ diffImagePath: _removed, ...page }) => page),
        resultDir: directory.path,
      };
    } catch (error) {
      if (directory && release && !shouldKeep(keepResults, false)) {
        Directory.removeResults(directory);
      }

      return {
        passed: false,
        message: 'Failed to compare the files',
        differentPages: [],
        pages: [],
        excludedPages: options.compare?.excludedPages ?? [],
        resultDir: directory?.path,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  } finally {
    release?.();
  }
}
