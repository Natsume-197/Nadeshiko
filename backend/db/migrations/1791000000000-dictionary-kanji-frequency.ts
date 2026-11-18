import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How often each kanji is written in our own corpus (task 44), counted by the frequency job
 * (`npm run dictionary:frequency`) in the same pass as word frequency, over every served sentence of every kind
 * (anime, drama, audiobooks, YouTube). `count` is every time the kanji is written, `sentences` the sentences it is in,
 * `rank` 1 for the most written. Replaced whole by each run.
 */
export class DictionaryKanjiFrequency1791000000000 implements MigrationInterface {
  name = 'DictionaryKanjiFrequency1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.kanji_frequency (
        character text PRIMARY KEY,
        count integer NOT NULL,
        sentences integer NOT NULL,
        rank integer NOT NULL
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.kanji_frequency`);
  }
}
