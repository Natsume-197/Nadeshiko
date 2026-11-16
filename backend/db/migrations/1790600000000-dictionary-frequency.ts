import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How often each JMdict word occurs in our own corpus (task 40), computed by `bin/computeFrequency.ts` from Sudachi's
 * analysis of every served sentence. `rank` is 1 for the most frequent word and is what the word card shows as "#N";
 * `per_million` keeps the ranking bonus comparable between a small dev corpus and production.
 */
export class DictionaryFrequency1790600000000 implements MigrationInterface {
  name = 'DictionaryFrequency1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.frequency (
        word_id integer PRIMARY KEY REFERENCES dict.word (id) ON DELETE CASCADE,
        count integer NOT NULL CHECK (count > 0),
        per_million real NOT NULL,
        rank integer NOT NULL
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.frequency`);
  }
}
