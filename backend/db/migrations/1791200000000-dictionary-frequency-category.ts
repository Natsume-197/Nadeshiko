import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Word frequency per kind of media (anime, drama, YouTube, audiobooks): the same count as `dict.frequency`, split by
 * the category of the media each sentence comes from, so the word card can say a word is #200 in anime but #3,000
 * in audiobooks. Filled by the frequency job (`npm run dictionary:frequency`) in the same pass; `per_million` is per
 * million words of that category, `rank` 1 for the most frequent word of that category. Replaced whole by each run.
 */
export class DictionaryFrequencyCategory1791200000000 implements MigrationInterface {
  name = 'DictionaryFrequencyCategory1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.frequency_category (
        word_id integer NOT NULL REFERENCES dict.word (id) ON DELETE CASCADE,
        category text NOT NULL,
        count integer NOT NULL,
        per_million real NOT NULL,
        rank integer NOT NULL,
        PRIMARY KEY (word_id, category)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.frequency_category`);
  }
}
