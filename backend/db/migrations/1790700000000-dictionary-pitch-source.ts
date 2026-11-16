import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A second pitch source next to UniDic (task 40): Kanjium's accents.txt (Uros O., CC BY-SA 4.0), which has the
 * compounds UniDic does not (心臓麻痺, 捜査本部). Each row says where it came from, each import replaces only its own
 * rows, and the word card prefers UniDic where both have a spelling and reading.
 */
export class DictionaryPitchSource1790700000000 implements MigrationInterface {
  name = 'DictionaryPitchSource1790700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dict.pitch ADD COLUMN source varchar(16) NOT NULL DEFAULT 'unidic'`);
    await queryRunner.query(`ALTER TABLE dict.pitch DROP CONSTRAINT pitch_pkey`);
    await queryRunner.query(`ALTER TABLE dict.pitch ADD PRIMARY KEY (text, reading, source)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM dict.pitch WHERE source <> 'unidic'`);
    await queryRunner.query(`ALTER TABLE dict.pitch DROP CONSTRAINT pitch_pkey`);
    await queryRunner.query(`ALTER TABLE dict.pitch ADD PRIMARY KEY (text, reading)`);
    await queryRunner.query(`ALTER TABLE dict.pitch DROP COLUMN source`);
  }
}
