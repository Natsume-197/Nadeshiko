import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Noun + particle + verb collocations mined from our own corpus (task 45) by the frequency job
 * (`npm run dictionary:frequency`), in the same pass as word frequency. Each row says which verb our sentences write
 * in kanji after this noun and particle when the verb is read `verb_kana` (ピアノ, を, ひく → 弾く), so the parser can
 * name the verb when a sentence writes it in kana. `count` is the sentences with that verb, `total` the sentences with
 * any kanji verb read `verb_kana` there. Replaced whole by each run.
 */
export class DictionaryCollocation1791100000000 implements MigrationInterface {
  name = 'DictionaryCollocation1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.collocation (
        noun text NOT NULL,
        particle text NOT NULL,
        verb_kana text NOT NULL,
        verb text NOT NULL,
        count integer NOT NULL,
        total integer NOT NULL,
        PRIMARY KEY (noun, particle, verb_kana)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.collocation`);
  }
}
