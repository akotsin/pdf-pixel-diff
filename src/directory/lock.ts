import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const LOCK_FILE_NAME = '.pdf-pixel-diff.lock';
const STALE_AFTER_MS = 30 * 60 * 1000;
// The holder writes the lock right after creating it; an empty/unparsable lock younger than this is treated as busy.
const UNREADABLE_GRACE_MS = 5 * 1000;

type LockInfo = {
  pid: number;
  hostname: string;
  createdAt: string;
};

/**
 * Guards a result dir against concurrent comparisons (other processes or other calls in this process).
 * A busy dir is reported as an error instead of waiting: callers often read the result files after
 * `compareFiles` returns, so serializing would only move the race to that read.
 */
export class ResultLock {
  static acquire (
    directory: string,
  ): () => void {
    const file = path.join(directory, LOCK_FILE_NAME);
    const info: LockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: new Date().toISOString(),
    };

    fse.ensureDirSync(directory);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fse.writeFileSync(file, JSON.stringify(info), { flag: 'wx' });
        return () => this.release(file, info);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }

      const holder = this.read(file);

      if (!this.isStale(file, holder)) {
        const owner = holder
          ? `pid ${holder.pid} on ${holder.hostname} since ${holder.createdAt}`
          : 'another comparison';

        throw new Error(
          `Result directory "${directory}" is in use by ${owner}. Use a separate resultDir for each concurrent comparison`,
        );
      }

      fse.removeSync(file);
    }

    throw new Error(`Failed to lock result directory "${directory}"`);
  }

  private static read (
    file: string,
  ): LockInfo | null {
    try {
      return JSON.parse(fse.readFileSync(file, 'utf8')) as LockInfo;
    } catch {
      return null;
    }
  }

  private static isStale (
    file: string,
    holder: LockInfo | null,
  ): boolean {
    if (!holder) {
      try {
        return Date.now() - fse.statSync(file).mtimeMs > UNREADABLE_GRACE_MS;
      } catch {
        return true;
      }
    }

    if (Date.now() - Date.parse(holder.createdAt) > STALE_AFTER_MS) {
      return true;
    }

    return holder.hostname === os.hostname() && !this.isAlive(holder.pid);
  }

  private static isAlive (
    pid: number,
  ): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  private static release (
    file: string,
    info: LockInfo,
  ): void {
    const holder = this.read(file);

    if (holder?.pid === info.pid && holder.createdAt === info.createdAt) {
      fse.removeSync(file);
    }
  }
}
