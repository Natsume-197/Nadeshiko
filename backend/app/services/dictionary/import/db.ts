import type { DataSource, QueryRunner } from 'typeorm';

/** Database helpers the dictionary importers share. */

/** Anything raw SQL can be run on: a query runner, an entity manager inside a transaction, or the data source. */
export interface Queryable {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

/** Run `work` on one connection: inside a transaction that commits, or rolls back for a dry run. */
export async function inTransaction<T>(
  dataSource: DataSource,
  rollback: boolean,
  work: (runner: QueryRunner) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const result = await work(runner);
    if (rollback) await runner.rollbackTransaction();
    else await runner.commitTransaction();
    return result;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

/**
 * Record an import in `dict.source`. `dict_date` and `tags` are written only when given (a key present with null or
 * `{}` still writes it); a source that never sets them leaves whatever the row has.
 */
export async function recordSource(
  runner: Queryable,
  name: string,
  version: string,
  options: { dictDate?: string | null; tags?: Record<string, string> } = {},
): Promise<void> {
  const columns = ['name', 'version'];
  const params: unknown[] = [name, version];
  const updates = ['version = EXCLUDED.version'];
  if (options.dictDate !== undefined) {
    columns.push('dict_date');
    params.push(options.dictDate);
    updates.push('dict_date = EXCLUDED.dict_date');
  }
  if (options.tags !== undefined) {
    columns.push('tags');
    params.push(JSON.stringify(options.tags));
    updates.push('tags = EXCLUDED.tags');
  }
  const placeholders = params.map((_, index) => `$${index + 1}`);
  await runner.query(
    `INSERT INTO dict.source (${columns.join(', ')}, imported_at) VALUES (${placeholders.join(', ')}, now())
     ON CONFLICT (name) DO UPDATE SET ${updates.join(', ')}, imported_at = now()`,
    params,
  );
}

/** Run `sql` once per `size` rows, the slice passed as `$1` (JSON, for `jsonb_to_recordset`) and `extraParams` as
 * `$2`... */
export async function insertChunks(
  q: Queryable,
  sql: string,
  rows: readonly unknown[],
  size: number,
  ...extraParams: unknown[]
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await q.query(sql, [JSON.stringify(rows.slice(i, i + size)), ...extraParams]);
  }
}
