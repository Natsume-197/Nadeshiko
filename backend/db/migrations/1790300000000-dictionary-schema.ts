import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nadeshiko's own dictionary (task 40), filled from jmdict-simplified (JMdict, JMnedict) and JmdictFurigana by
 * `bin/importDictionary.ts`. Lives in its own `dict` schema: it is reference data, rebuilt from upstream files, and
 * nothing in `public` points into it yet.
 *
 * Identity is designed so stored references survive weekly updates:
 * - `word.id` is the upstream `ent_seq` (JMdict < 5,000,000, JMnedict above), never generated here.
 * - `form.idx` is append-only per word: a new spelling gets the next index, a spelling that disappears upstream is
 *   flagged inactive and keeps its index. `(word_id, idx)` therefore never changes meaning.
 * - Senses carry no such promise; they are replaced on every import.
 *
 * Only English and Spanish glosses are kept, one `sense` row per upstream sense and language.
 */
export class DictionarySchema1790300000000 implements MigrationInterface {
  name = 'DictionarySchema1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS dict`);

    await queryRunner.query(`
      CREATE TABLE dict.word (
        id integer PRIMARY KEY,
        source varchar(16) NOT NULL,
        common boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await queryRunner.query(`CREATE INDEX word_source_active_idx ON dict.word (source) WHERE active`);

    await queryRunner.query(`
      CREATE TABLE dict.form (
        word_id integer NOT NULL REFERENCES dict.word (id) ON DELETE CASCADE,
        idx smallint NOT NULL,
        text varchar NOT NULL,
        kana boolean NOT NULL,
        common boolean NOT NULL DEFAULT false,
        tags text[] NOT NULL DEFAULT '{}',
        applies_to_kanji text[] NOT NULL DEFAULT '{}',
        active boolean NOT NULL DEFAULT true,
        PRIMARY KEY (word_id, idx),
        UNIQUE (word_id, kana, text)
      )`);

    await queryRunner.query(`
      CREATE TABLE dict.sense (
        word_id integer NOT NULL REFERENCES dict.word (id) ON DELETE CASCADE,
        idx smallint NOT NULL,
        lang char(3) NOT NULL,
        pos text[] NOT NULL DEFAULT '{}',
        misc text[] NOT NULL DEFAULT '{}',
        field text[] NOT NULL DEFAULT '{}',
        dialect text[] NOT NULL DEFAULT '{}',
        info text[] NOT NULL DEFAULT '{}',
        applies_to_kanji text[] NOT NULL DEFAULT '{}',
        applies_to_kana text[] NOT NULL DEFAULT '{}',
        related jsonb NOT NULL DEFAULT '[]',
        antonym jsonb NOT NULL DEFAULT '[]',
        glosses jsonb NOT NULL,
        PRIMARY KEY (word_id, idx)
      )`);

    // Every spelling, in its own text and as hiragana, including inactive forms so words whose spelling was
    // dropped upstream can still be found (and ranked down).
    await queryRunner.query(`
      CREATE TABLE dict.lookup (
        key varchar NOT NULL,
        word_id integer NOT NULL,
        form_idx smallint NOT NULL,
        PRIMARY KEY (key, word_id, form_idx),
        FOREIGN KEY (word_id, form_idx) REFERENCES dict.form (word_id, idx) ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX lookup_word_idx ON dict.lookup (word_id)`);

    // Ruby per (spelling, reading), shaped like the word card's: [{text, ruby?}]. Keyed by source too: JMdict and
    // JMnedict can both split 田中/たなか, and reimporting one must not delete the other's rows.
    await queryRunner.query(`
      CREATE TABLE dict.furigana (
        text varchar NOT NULL,
        reading varchar NOT NULL,
        source varchar(32) NOT NULL,
        segments jsonb NOT NULL,
        PRIMARY KEY (text, reading, source)
      )`);
    await queryRunner.query(`CREATE INDEX furigana_source_idx ON dict.furigana (source)`);

    // What was imported, from which upstream version, plus the upstream tag descriptions.
    await queryRunner.query(`
      CREATE TABLE dict.source (
        name varchar(32) PRIMARY KEY,
        version varchar NOT NULL,
        dict_date date,
        tags jsonb NOT NULL DEFAULT '{}',
        imported_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA dict CASCADE`);
  }
}
