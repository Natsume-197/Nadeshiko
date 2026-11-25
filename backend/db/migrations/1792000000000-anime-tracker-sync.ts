import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anime tracker sync — provider-agnostic foundation for AniList (Phase 1) and MyAnimeList (Phase 2) (task 54).
 *
 * `TrackerConnection` holds the reader's single active tracker connection and encrypted OAuth credentials, plus their
 * sync/spoiler preferences. `UserMediaProgress` stores the normalized anime list already resolved against `Media`
 * when a matching `MediaExternalId` exists, keeping search queries strictly local (Postgres + Elasticsearch).
 */
export class AnimeTrackerSync1792000000000 implements MigrationInterface {
  name = 'AnimeTrackerSync1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "TrackerConnection_provider_enum" AS ENUM ('ANILIST', 'MAL')`);
    await queryRunner.query(
      `CREATE TYPE "UserMediaProgress_status_enum" AS ENUM ('WATCHING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING')`,
    );

    await queryRunner.query(`
      CREATE TABLE "TrackerConnection" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "provider" "TrackerConnection_provider_enum" NOT NULL,
        "external_user_id" character varying(128) NOT NULL,
        "external_username" character varying(128),
        "access_token_ciphertext" text NOT NULL,
        "refresh_token_ciphertext" text,
        "access_token_expires_at" timestamptz,
        "auto_sync_enabled" boolean NOT NULL DEFAULT true,
        "spoiler_guard_enabled" boolean NOT NULL DEFAULT true,
        "hide_plan_to_watch" boolean NOT NULL DEFAULT false,
        "last_synced_at" timestamptz,
        "last_sync_error" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "UQ_tracker_connection_user_id" UNIQUE ("user_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "UserMediaProgress" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "provider" "TrackerConnection_provider_enum" NOT NULL,
        "external_source" character varying(16) NOT NULL,
        "external_id" character varying(64) NOT NULL,
        "title" character varying(255) NOT NULL,
        "media_id" integer REFERENCES "Media"("id") ON DELETE SET NULL,
        "status" "UserMediaProgress_status_enum" NOT NULL,
        "progress" integer NOT NULL DEFAULT 0,
        "custom_lists" text[] NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "UQ_user_media_progress_user_external" UNIQUE ("user_id", "external_source", "external_id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_user_media_progress_user_status" ON "UserMediaProgress" ("user_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_media_progress_external" ON "UserMediaProgress" ("external_source", "external_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_media_progress_media_id" ON "UserMediaProgress" ("media_id") WHERE "media_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "UserMediaProgress"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "TrackerConnection"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "UserMediaProgress_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "TrackerConnection_provider_enum"`);
  }
}
