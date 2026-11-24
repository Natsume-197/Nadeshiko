import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Word alerts and the in-site notification centre (task 52).
 *
 * `WordWatch` is one reader's alert on one word: tell me when it first appears (`FIRST`), or when new sentences of it
 * come in (`NEW_SENTENCES`). Two baselines live on the row: `last_count` is the reader's own filtered count, the number
 * notices are decided on, and `last_global_count` is the unfiltered count at the same moment, which lets the sweep skip
 * every word whose corpus did not grow without running anyone's search.
 *
 * `Notification` is what the bell in the header lists. Email stays a separate channel, sent alongside.
 */
export class WordAlertsAndNotifications1791900000000 implements MigrationInterface {
  name = 'WordAlertsAndNotifications1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "WordWatch_mode_enum" AS ENUM ('FIRST', 'NEW_SENTENCES')`);
    await queryRunner.query(`CREATE TYPE "WordWatch_status_enum" AS ENUM ('ACTIVE', 'FULFILLED', 'PAUSED')`);
    await queryRunner.query(`CREATE TYPE "WordWatch_match_mode_enum" AS ENUM ('WORD', 'EXACT', 'CONTAINS')`);
    await queryRunner.query(`
      CREATE TABLE "WordWatch" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "query" character varying(32) NOT NULL,
        "match_mode" "WordWatch_match_mode_enum" NOT NULL DEFAULT 'WORD',
        "mode" "WordWatch_mode_enum" NOT NULL,
        "status" "WordWatch_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "last_count" integer NOT NULL DEFAULT 0,
        "last_global_count" integer NOT NULL DEFAULT 0,
        "last_notified_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "UQ_word_watch_public_id" UNIQUE ("public_id"),
        CONSTRAINT "UQ_word_watch_user_query" UNIQUE ("user_id", "query", "match_mode")
      )
    `);
    // The sweeps read every active alert of one mode; the per-reader list reads by user (covered by the unique key).
    await queryRunner.query(`CREATE INDEX "IDX_word_watch_status_mode" ON "WordWatch" ("status", "mode")`);

    await queryRunner.query(`
      CREATE TABLE "Notification" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "kind" character varying(32) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_notification_public_id" UNIQUE ("public_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_user_created" ON "Notification" ("user_id", "created_at" DESC)`,
    );
    // The bell asks for the unread count on every page load; keep that an index-only lookup.
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_user_unread" ON "Notification" ("user_id") WHERE "read_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "Notification"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "WordWatch"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "WordWatch_match_mode_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "WordWatch_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "WordWatch_mode_enum"`);
  }
}
