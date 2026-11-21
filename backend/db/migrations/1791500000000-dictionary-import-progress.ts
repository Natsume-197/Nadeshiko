import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Import progress for custom dictionaries (task 48): when an import started, its last
 * heartbeat, and how far it got. A heartbeat older than a couple of minutes means the import died, and the row is
 * failed instead of staying "processing" until the queue's 30-minute expiry. A null start means it is still queued.
 */
export class DictionaryImportProgress1791500000000 implements MigrationInterface {
  name = 'DictionaryImportProgress1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "UserDictionaryArtifact"
        ADD COLUMN "import_started_at" timestamptz,
        ADD COLUMN "import_heartbeat_at" timestamptz,
        ADD COLUMN "import_progress" smallint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "UserDictionaryArtifact"
        DROP COLUMN "import_progress",
        DROP COLUMN "import_heartbeat_at",
        DROP COLUMN "import_started_at"
    `);
  }
}
