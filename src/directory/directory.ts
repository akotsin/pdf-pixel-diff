import fse from 'fs-extra';
import path from 'node:path';

const DEFAULT_RESULTS_BASE_DIR = 'pdf-pixel-diff';

export type ResultFolder =
  | 'expected'
  | 'actual'
  | 'difference';

const RESULT_FOLDERS: ResultFolder[] = ['expected', 'actual', 'difference'];

export type ResultDirectory = {
  path: string;
  /** created by the package for this call (resultDir option not set) */
  generated: boolean;
};

export class Directory {
  static validateFilePath (
    file: string | Buffer,
  ): void {
    if (!Buffer.isBuffer(file) && !fse.pathExistsSync(file)) {
      throw new Error(`File ${file} does not exist`);
    }
  }

  /** Explicit dir is used as is; otherwise a unique `<cwd>/pdf-pixel-diff/<timestamp>-<random>` dir is created. */
  static resolveResultDirectory (
    resultDir?: string,
  ): ResultDirectory {
    if (resultDir !== undefined) {
      return { path: path.resolve(resultDir), generated: false };
    }

    const baseDir = path.resolve(DEFAULT_RESULTS_BASE_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    fse.ensureDirSync(baseDir);

    return {
      path: fse.mkdtempSync(path.join(baseDir, `${timestamp}-`)),
      generated: true,
    };
  }

  static createResultDirectories (
    resultsDir: string,
  ): Record<ResultFolder, string> {
    const entries = RESULT_FOLDERS.map((folder) => {
      const directoryPath = path.join(resultsDir, folder);

      fse.ensureDirSync(directoryPath);
      fse.emptyDirSync(directoryPath);

      return [folder, directoryPath];
    });

    return Object.fromEntries(entries) as Record<ResultFolder, string>;
  }

  /** A generated dir is removed entirely; in an explicit dir only the package's subfolders are removed. */
  static removeResults (
    directory: ResultDirectory,
  ): void {
    if (directory.generated) {
      fse.removeSync(directory.path);
      return;
    }

    for (const folder of RESULT_FOLDERS) {
      fse.removeSync(path.join(directory.path, folder));
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
