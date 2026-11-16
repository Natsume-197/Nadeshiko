import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pitch accent per (spelling, reading), from UniDic's accent type (NINJAL, GPL/LGPL/BSD; we use it under BSD).
 * Keyed like `dict.furigana` rather than by JMdict id: UniDic knows spellings and readings, not JMdict entries, and
 * the word card looks both up by the headword and reading it shows. `downsteps` holds every accepted accent, 0
 * meaning flat (heiban), n the mora after which the pitch drops.
 */
export class DictionaryPitch1790500000000 implements MigrationInterface {
  name = 'DictionaryPitch1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.pitch (
        text varchar NOT NULL,
        reading varchar NOT NULL,
        downsteps smallint[] NOT NULL,
        PRIMARY KEY (text, reading)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.pitch`);
  }
}
