import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * JLPT level per JMdict word, from stephenmk/yomitan-jlpt-vocab (Jonathan Waller's lists, CC BY, mapped to JMdict
 * ids, CC BY-SA 4.0). There are no official JLPT vocabulary lists, so these levels are an estimate and the card
 * must label them unofficial. A word listed at several levels keeps the easiest one.
 */
export class DictionaryJlpt1790400000000 implements MigrationInterface {
  name = 'DictionaryJlpt1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.jlpt (
        word_id integer PRIMARY KEY REFERENCES dict.word (id) ON DELETE CASCADE,
        level smallint NOT NULL CHECK (level BETWEEN 1 AND 5)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.jlpt`);
  }
}
