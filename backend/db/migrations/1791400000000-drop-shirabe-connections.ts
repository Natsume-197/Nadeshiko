import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retire the Shirabe OAuth account-linking table now that Nadeshiko runs its own dictionary, parser, and per-account
 * custom Yomitan dictionaries.
 */
export class DropShirabeConnections1791400000000 implements MigrationInterface {
  name = 'DropShirabeConnections1791400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ShirabeConnection"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ShirabeConnection" (
        "id" SERIAL PRIMARY KEY,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "access_token_ciphertext" text NOT NULL,
        "access_token_expires_at" timestamptz NOT NULL,
        "refresh_token_ciphertext" text NOT NULL,
        "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "shirabe_name" character varying,
        "stack" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "stack_fingerprint" character varying(64),
        "stack_is_private" boolean NOT NULL DEFAULT false,
        "stack_names" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "synced_at" timestamptz,
        "disconnected_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_shirabe_connection_user" ON "ShirabeConnection" ("user_id")`);
  }
}
