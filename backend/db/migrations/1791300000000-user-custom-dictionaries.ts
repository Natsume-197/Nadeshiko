import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Metadata tables for user-uploaded Yomitan dictionaries (task 48).
 *
 * Indexed entries live in content-addressed read-only SQLite files on disk (`<USER_DICTIONARIES_DIR>/<sha256>.sqlite`)
 * rather than in Postgres so large monolingual dictionaries (100k-250k entries each) do not bloat Postgres indexes,
 * RAM, or nightly `pg-backup` dumps. Postgres owns only the small artifact registry and per-account links.
 */
export class UserCustomDictionaries1791300000000 implements MigrationInterface {
  name = 'UserCustomDictionaries1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "UserDictionaryArtifact" (
        "id" SERIAL PRIMARY KEY,
        "sha256" varchar(64) NOT NULL,
        "storage_key" varchar(64) NOT NULL,
        "title" varchar(200) NOT NULL,
        "revision" varchar(120) NOT NULL,
        "author" varchar(200),
        "description" text,
        "url" varchar(500),
        "format" smallint NOT NULL DEFAULT 3,
        "frequency_mode" varchar(32),
        "has_terms" boolean NOT NULL DEFAULT false,
        "has_frequency" boolean NOT NULL DEFAULT false,
        "has_pitch" boolean NOT NULL DEFAULT false,
        "term_count" integer NOT NULL DEFAULT 0,
        "frequency_count" integer NOT NULL DEFAULT 0,
        "pitch_count" integer NOT NULL DEFAULT 0,
        "zip_bytes" bigint NOT NULL,
        "sqlite_bytes" bigint NOT NULL DEFAULT 0,
        "status" varchar(16) NOT NULL DEFAULT 'processing',
        "error_message" text,
        "importer_version" smallint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_dictionary_artifact_sha256" UNIQUE ("sha256"),
        CONSTRAINT "UQ_user_dictionary_artifact_storage_key" UNIQUE ("storage_key"),
        CONSTRAINT "CHK_user_dictionary_artifact_status" CHECK ("status" IN ('processing', 'ready', 'failed'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "UserDictionary" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL,
        "artifact_id" integer NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_user_dictionary_user" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_dictionary_artifact" FOREIGN KEY ("artifact_id") REFERENCES "UserDictionaryArtifact"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_user_dictionary_user_artifact" UNIQUE ("user_id", "artifact_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_user_dictionary_user_sort" ON "UserDictionary" ("user_id", "sort_order")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_user_dictionary_artifact" ON "UserDictionary" ("artifact_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_dictionary_artifact"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_dictionary_user_sort"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "UserDictionary"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "UserDictionaryArtifact"`);
  }
}
