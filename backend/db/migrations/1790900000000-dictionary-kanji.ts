import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The kanji card (task 44): what the word card shows when a reader opens one of a word's kanji. One table per upstream
 * source, so each import replaces only its own rows:
 * - `dict.kanji` from KANJIDIC2 (jmdict-simplified `kanjidic2-all`, EDRDG licence): readings, English and Spanish
 *   meanings, stroke count, school grade, newspaper frequency and classical (Kangxi) radical.
 * - `dict.kanji_component` from KRADFILE (jmdict-simplified `kradfile`, CC BY-SA 4.0): the parts a kanji is built from.
 * - `dict.kanji_strokes` from KanjiVG (CC BY-SA 3.0): one SVG path per stroke, in writing order, and where KanjiVG puts
 *   each stroke's number.
 * - `dict.kanji_jlpt` from Jonathan Waller's JLPT lists (CC BY), as converted by davidluzgouveia/kanji-data (MIT).
 * - `dict.radical` from Kanji alive (CC BY 4.0): the 214 Kangxi radicals and their variant shapes, with their Japanese
 *   names and English meanings.
 */
export class DictionaryKanji1790900000000 implements MigrationInterface {
  name = 'DictionaryKanji1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dict.kanji (
        character text PRIMARY KEY,
        stroke_count smallint NOT NULL,
        grade smallint,
        frequency smallint,
        radical smallint,
        on_readings text[] NOT NULL DEFAULT '{}',
        kun_readings text[] NOT NULL DEFAULT '{}',
        meanings_en text[] NOT NULL DEFAULT '{}',
        meanings_es text[] NOT NULL DEFAULT '{}'
      )`);
    await queryRunner.query(`CREATE INDEX kanji_radical_idx ON dict.kanji (radical)`);
    await queryRunner.query(`
      CREATE TABLE dict.kanji_component (
        character text PRIMARY KEY,
        components text[] NOT NULL
      )`);
    // "Kanji that contain this one": which component lists hold a character.
    await queryRunner.query(`CREATE INDEX kanji_component_parts_idx ON dict.kanji_component USING gin (components)`);
    await queryRunner.query(`
      CREATE TABLE dict.kanji_strokes (
        character text PRIMARY KEY,
        paths text[] NOT NULL,
        numbers jsonb NOT NULL DEFAULT '[]'
      )`);
    await queryRunner.query(`
      CREATE TABLE dict.kanji_jlpt (
        character text PRIMARY KEY,
        level smallint NOT NULL CHECK (level BETWEEN 1 AND 5)
      )`);
    await queryRunner.query(`
      CREATE TABLE dict.radical (
        glyph text PRIMARY KEY,
        number smallint NOT NULL CHECK (number BETWEEN 1 AND 214),
        variant_of text,
        reading text NOT NULL,
        meaning text NOT NULL
      )`);
    await queryRunner.query(`CREATE INDEX radical_number_idx ON dict.radical (number)`);
    // Which written forms contain a kanji: the kanji card's word list starts from here. Each spelling as an array of
    // its characters; ~8 MB for JMdict's ~890,000 active written forms.
    await queryRunner.query(
      `CREATE INDEX form_chars_idx ON dict.form USING gin (string_to_array(text, NULL)) WHERE NOT kana AND active`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX dict.form_chars_idx`);
    await queryRunner.query(`DROP TABLE dict.radical`);
    await queryRunner.query(`DROP TABLE dict.kanji_jlpt`);
    await queryRunner.query(`DROP TABLE dict.kanji_strokes`);
    await queryRunner.query(`DROP TABLE dict.kanji_component`);
    await queryRunner.query(`DROP TABLE dict.kanji`);
  }
}
