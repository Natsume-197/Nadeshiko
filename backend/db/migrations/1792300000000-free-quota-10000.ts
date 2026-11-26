import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Raises the free API quota from 5,000 to 10,000 requests a month (release 3.0.0). The paid tiers keep their numbers
 * (Seed 15,000, Flower 30,000, Nadeshiko 60,000).
 *
 * Every account without a membership resolves through the `free` row of `Tier`, so that row carries the change. The
 * legacy `User.monthly_quota_limit` column is still populated and is the fallback when a tier row is missing, so its
 * default and the rows still on the old default move with it.
 *
 * A hand-set `quota_override` wins over every tier and never expires, so one at or below 10,000 would now hold its
 * account at or under the free limit. Those overrides are cleared and the account falls back to its tier. `down` cannot
 * know which overrides were cleared, so it leaves them cleared.
 */
export class FreeQuota100001792300000000 implements MigrationInterface {
  name = 'FreeQuota100001792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "Tier" SET "monthly_quota_limit" = 10000, "updated_at" = now() WHERE "id" = 'free'`,
    );
    await queryRunner.query(`ALTER TABLE "User" ALTER COLUMN "monthly_quota_limit" SET DEFAULT 10000`);
    await queryRunner.query(`UPDATE "User" SET "monthly_quota_limit" = 10000 WHERE "monthly_quota_limit" = 5000`);
    await queryRunner.query(`UPDATE "User" SET "quota_override" = NULL WHERE "quota_override" <= 10000`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE "User" SET "monthly_quota_limit" = 5000 WHERE "monthly_quota_limit" = 10000`);
    await queryRunner.query(`ALTER TABLE "User" ALTER COLUMN "monthly_quota_limit" SET DEFAULT 5000`);
    await queryRunner.query(`UPDATE "Tier" SET "monthly_quota_limit" = 5000, "updated_at" = now() WHERE "id" = 'free'`);
  }
}
