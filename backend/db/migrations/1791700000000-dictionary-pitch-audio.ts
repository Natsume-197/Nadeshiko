import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pitch-audio clips uploaded to R2 (task 40): one row per (hiragana reading, downstep) whose clip is served at
 * `pitch-audio/<voice>/<reading>_<downstep>.opus`, so the word card shows ▶ only where a clip exists. Clips are made
 * on the operator's PC (`bin/generatePitchAudio.ts`) and registered from its manifest; production only serves them.
 */
export class DictionaryPitchAudio1791700000000 implements MigrationInterface {
  name = 'DictionaryPitchAudio1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.pitch_audio (
        reading varchar NOT NULL,
        downstep smallint NOT NULL CHECK (downstep >= 0),
        voice varchar(32) NOT NULL,
        generated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (reading, downstep)
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dict.pitch_audio`);
  }
}
