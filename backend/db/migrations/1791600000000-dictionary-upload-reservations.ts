import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Direct uploads of custom dictionaries to R2 (task 48). The browser asks for a reservation,
 * gets a short-lived presigned PUT for one object of a declared size, uploads straight to R2, and completes it. A
 * reservation never completed expires; the nightly sweep deletes its object and row.
 */
export class DictionaryUploadReservations1791600000000 implements MigrationInterface {
  name = 'DictionaryUploadReservations1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "UserDictionaryUpload" (
        "id" uuid PRIMARY KEY,
        "user_id" integer NOT NULL,
        "object_key" character varying(300) NOT NULL,
        "declared_bytes" bigint NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'reserved',
        "expires_at" timestamptz NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "FK_user_dictionary_upload_user" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_dictionary_upload_expiry" ON "UserDictionaryUpload" ("status", "expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "UserDictionaryUpload"`);
  }
}
