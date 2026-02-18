import fse from 'fs-extra';
import path from 'node:path';

const DEFAULT_RESULTS_DIR = path.resolve(
  process.cwd(),
  'pdf-pixel-diff',
);

export type ResultFolder =
  | 'baseline'
  | 'actual'
  | 'difference';

export class Directory {
  static validateFilePath (
    file: string | Buffer,
  ): void {
    if (!Buffer.isBuffer(file) && !fse.pathExistsSync(file)) {
      throw new Error(`File ${file} does not exist`);
    }
  }

  private static validateSpecificDirectory (
    resultsDir: string,
    folder: ResultFolder,
  ): string {
    const directoryPath = path.join(
      resultsDir,
      folder,
    );

    fse.ensureDirSync(directoryPath);
    fse.emptyDirSync(directoryPath);

    return directoryPath;
  }

  static createResultDirectories (
    resultsDir: string = DEFAULT_RESULTS_DIR,
  ): Record<ResultFolder, string> {
    return {
      baseline: this.validateSpecificDirectory(resultsDir, 'baseline'),
      actual: this.validateSpecificDirectory(resultsDir, 'actual'),
      difference: this.validateSpecificDirectory(resultsDir, 'difference'),
    };
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

  static showAllFilesInDirectory (
    directoryPath: string,
  ): string[] {
    return fse.readdirSync(directoryPath);
  }
}