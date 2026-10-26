import fse from 'fs-extra';
import path from 'node:path';

const DEFAULT_RESULTS_BASE_DIR = 'pdf-pixel-diff';

export type ResultFolder =
  | 'expected'
  | 'actual'
  | 'difference';

const RESULT_FOLDERS: ResultFolder[] = ['expected', 'actual', 'difference'];

export class Directory {
  static validateFilePath (
    file: string | Buffer,
  ): void {
    if (!Buffer.isBuffer(file) && !fse.pathExistsSync(file)) {
      throw new Error(`File ${file} does not exist`);
    }
  }

  /** Every call gets its own `<resultDir>/<timestamp>-<random>` dir, so comparisons never share files. */
  static createRunDirectory (
    resultDir: string = DEFAULT_RESULTS_BASE_DIR,
  ): string {
    const baseDir = path.resolve(resultDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    fse.ensureDirSync(baseDir);

    return fse.mkdtempSync(path.join(baseDir, `${timestamp}-`));
  }

  static createResultDirectories (
    runDir: string,
  ): Record<ResultFolder, string> {
    const entries = RESULT_FOLDERS.map((folder) => {
      const directoryPath = path.join(runDir, folder);

      fse.ensureDirSync(directoryPath);

      return [folder, directoryPath];
    });

    return Object.fromEntries(entries) as Record<ResultFolder, string>;
  }

  // Best effort: a cleanup failure must not turn a finished comparison into an exception.
  static removeRunDirectory (
    runDir: string,
  ): void {
    try {
      fse.removeSync(runDir);
    } catch {
      // ignore
    }
  }

  static addPrefixToPath (
    filePath: string,
  ): string {
    const prefix = path.basename(filePath);

    return path.join(
      filePath,
      prefix,
    );
  }

  /** Maps 1-based page numbers to file names produced by pdftocairo (`<prefix>-<page>.png`). */
  static mapPageImages (
    directoryPath: string,
  ): Map<number, string> {
    const images = new Map<number, string>();

    for (const file of fse.readdirSync(directoryPath)) {
      const match = /-(\d+)\.png$/.exec(file);

      if (match?.[1]) {
        images.set(Number(match[1]), file);
      }
    }

    return images;
  }
}
