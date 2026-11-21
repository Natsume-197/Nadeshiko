import { AppDataSource } from '@config/database';
import { reportFatalError } from '../reportFatal';

/** Run a CLI script's `main`, then close the database (if it was opened) and exit 0, or 1 with the error on stderr. */
export function runWithDatabase(name: string, main: () => Promise<void>): void {
  const finish = async (code: number) => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(code);
  };
  main().then(
    () => finish(0),
    (error: unknown) => {
      reportFatalError(`${name} failed`, error);
      return finish(1);
    },
  );
}
