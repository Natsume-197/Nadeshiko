import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corpus frequency per spelling (`dict.form.text`) of a JMdict word: how often a word is written in each of its
 * kanji or kana forms (e.g. 彼女 96% vs かのじょ 4%), plus that form's overall rank. Filled by the frequency job
 * (`npm run dictionary:frequency`) in the same pass as `dict.frequency`, and replaced whole on each run.
 */
export class DictionaryFrequencyForm1792500000000 implements MigrationInterface {
  name = 'DictionaryFrequencyForm1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.frequency_form (
        word_id integer NOT NULL REFERENCES dict.word (id) ON DELETE CASCADE,
        form_text text NOT NULL,
        count integer NOT NULL,
        share real NOT NULL,
        rank integer NOT NULL,
        PRIMARY KEY (word_id, form_text)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.frequency_form`);
  }
}
