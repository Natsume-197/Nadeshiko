import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anime tracker sync, Phase 2 (task 54): MyAnimeList ids as an external source, so `MediaExternalId` can match a
 * reader's MAL list to published anime and a content request filed with a MyAnimeList link carries a MAL identity.
 */
export class MalExternalSource1792100000000 implements MigrationInterface {
  name = 'MalExternalSource1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "external_source_type" ADD VALUE IF NOT EXISTS 'MAL'`);
    await queryRunner.query(`ALTER TYPE "ContentRequest_external_source_enum" ADD VALUE IF NOT EXISTS 'MAL'`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing values from an enum type
  }
}
