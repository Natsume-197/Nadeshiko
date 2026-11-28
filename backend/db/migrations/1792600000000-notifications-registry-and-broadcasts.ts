import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Central notification registry settings, live grouping on `Notification`, in-site official broadcasts
 * (`NotificationBroadcast`), and email broadcasts (`EmailBroadcast`) (tasks 52 Phase 2 & 55).
 */
export class NotificationsRegistryAndBroadcasts1792600000000 implements MigrationInterface {
  name = 'NotificationsRegistryAndBroadcasts1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Live grouping columns on Notification
    await queryRunner.query(`ALTER TABLE "Notification" ADD COLUMN "group_key" character varying(128)`);
    await queryRunner.query(`ALTER TABLE "Notification" ADD COLUMN "group_count" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_user_group_unread" ON "Notification" ("user_id", "group_key") WHERE "read_at" IS NULL AND "group_key" IS NOT NULL`,
    );

    // 2. Runtime parameterization & template overrides for every notification/email kind
    await queryRunner.query(`
      CREATE TABLE "NotificationSetting" (
        "kind" character varying(32) PRIMARY KEY,
        "site_enabled" boolean NOT NULL DEFAULT true,
        "email_enabled" boolean NOT NULL DEFAULT true,
        "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "subject_override" text,
        "body_override" text,
        "updated_by" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 3. Log of admin-sent in-site official announcements and direct messages
    await queryRunner.query(`
      CREATE TABLE "NotificationBroadcast" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" character varying(32) NOT NULL,
        "audience" character varying(32) NOT NULL,
        "target_user_id" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "title" character varying(160) NOT NULL,
        "message" text NOT NULL,
        "link_url" character varying(512),
        "link_label" character varying(80),
        "status" character varying(24) NOT NULL DEFAULT 'QUEUED',
        "recipient_count" integer NOT NULL DEFAULT 0,
        "sent_count" integer NOT NULL DEFAULT 0,
        "error" text,
        "created_by" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_notification_broadcast_public_id" UNIQUE ("public_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_broadcast_created" ON "NotificationBroadcast" ("created_at" DESC)`,
    );

    // 4. Custom email broadcasts / campaigns managed from /admin/emails
    await queryRunner.query(`
      CREATE TABLE "EmailBroadcast" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "campaign_key" character varying(80) NOT NULL,
        "subject" character varying(200) NOT NULL,
        "preview_text" character varying(240),
        "body_markdown" text NOT NULL,
        "cta_label" character varying(80),
        "cta_url" character varying(512),
        "audience" character varying(32) NOT NULL,
        "audience_params" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" character varying(24) NOT NULL DEFAULT 'DRAFT',
        "recipient_count" integer NOT NULL DEFAULT 0,
        "sent_count" integer NOT NULL DEFAULT 0,
        "failed_count" integer NOT NULL DEFAULT 0,
        "error" text,
        "created_by" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_email_broadcast_public_id" UNIQUE ("public_id"),
        CONSTRAINT "UQ_email_broadcast_campaign_key" UNIQUE ("campaign_key")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_email_broadcast_created" ON "EmailBroadcast" ("created_at" DESC)`);

    // 5. Uploaded images for email broadcasts (pasted screenshots / inline visuals)
    await queryRunner.query(`
      CREATE TABLE "EmailAsset" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "mime_type" character varying(64) NOT NULL,
        "data" bytea NOT NULL,
        "byte_size" integer NOT NULL,
        "created_by" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_email_asset_public_id" UNIQUE ("public_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailAsset"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailBroadcast"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "NotificationBroadcast"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "NotificationSetting"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_user_group_unread"`);
    await queryRunner.query(`ALTER TABLE "Notification" DROP COLUMN IF EXISTS "group_count"`);
    await queryRunner.query(`ALTER TABLE "Notification" DROP COLUMN IF EXISTS "group_key"`);
  }
}
