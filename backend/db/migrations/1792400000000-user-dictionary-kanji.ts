import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kanji dictionaries for custom dictionaries (task 48): what an artifact holds for the kanji card. `has_kanji` for
 * `kanji_bank` rows, `has_kanji_frequency` for `kanji_meta_bank` frequencies, and `has_kanji_terms` for a 漢和辞典
 * shipped as a term dictionary, whose single-kanji entries answer the kanji card too. Rows indexed before importer
 * version 4 keep false until they are uploaded again.
 */
export class UserDictionaryKanji1792400000000 implements MigrationInterface {
  name = 'UserDictionaryKanji1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "UserDictionaryArtifact"
        ADD COLUMN "has_kanji" boolean NOT NULL DEFAULT false,
        ADD COLUMN "has_kanji_frequency" boolean NOT NULL DEFAULT false,
        ADD COLUMN "has_kanji_terms" boolean NOT NULL DEFAULT false,
        ADD COLUMN "kanji_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "kanji_frequency_count" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "UserDictionaryArtifact"
        DROP COLUMN "kanji_frequency_count",
        DROP COLUMN "kanji_count",
        DROP COLUMN "has_kanji_terms",
        DROP COLUMN "has_kanji_frequency",
        DROP COLUMN "has_kanji"
    `);
  }
}
