import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ties the paid quota tiers to the Patreon tiers that pay for them: Seed ($5),
 * Flower ($10) and Nadeshiko ($20).
 *
 * The match is by Patreon tier id, not by pledge amount. Patreon reports a
 * member's entitled amount in the patron's own currency, so an amount threshold
 * in US cents would under-grant a patron paying a local price and over-grant
 * one paying in a currency with large numbers. The tier a member is entitled
 * to is the same whatever they pay in.
 *
 * `patreon_tier_id` is the id from the tier's edit link on Patreon. Null means
 * Patreon never grants it (`free`, or a tier made by hand for one account), so
 * an admin can still add tiers that only an assignment reaches. It is unique
 * where set: one Patreon tier must not resolve to two quota tiers.
 *
 * `PatreonConnection.entitled_tier_ids` holds the ids from the member's
 * `currently_entitled_tiers` at the last successful check. Rows linked before
 * this migration start empty and earn nothing until their next refresh (the
 * daily job, or the reader opening Settings); they never earned anything
 * before either, so nobody loses a limit in between.
 *
 * `plus` and `pro` keep their ids and take the Seed and Flower numbers. Every
 * account in production is on `free` when this runs, so the lower numbers
 * reach nobody who had the old ones. The burst columns stay null for the same
 * reason the first tier migration gives: a bigger month must not quietly also
 * mean a bigger per-minute allowance.
 */
export class PatreonQuotaTiers1790800000000 implements MigrationInterface {
  name = 'PatreonQuotaTiers1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Tier" ADD COLUMN "patreon_tier_id" text`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tier_patreon_tier_id" ON "Tier" ("patreon_tier_id") WHERE "patreon_tier_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      UPDATE "Tier"
         SET "display_name" = 'Seed', "monthly_quota_limit" = 15000, "patreon_tier_id" = '22710324', "updated_at" = now()
       WHERE "id" = 'plus'
    `);
    await queryRunner.query(`
      UPDATE "Tier"
         SET "display_name" = 'Flower', "monthly_quota_limit" = 30000, "patreon_tier_id" = '28118736', "updated_at" = now()
       WHERE "id" = 'pro'
    `);
    await queryRunner.query(`
      INSERT INTO "Tier" ("id", "display_name", "monthly_quota_limit", "patreon_tier_id", "sort_order")
      VALUES ('max', 'Nadeshiko', 60000, '30077695', 30)
    `);

    await queryRunner.query(
      `ALTER TABLE "PatreonConnection" ADD COLUMN "entitled_tier_ids" text[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "PatreonConnection" DROP COLUMN "entitled_tier_ids"`);

    // The tier FK is ON DELETE SET NULL, so deleting `max` would silently drop
    // anyone assigned to it to the legacy column. Keep their number instead, as
    // the explicit exception it becomes once the tier is gone -- the same move
    // the first tier migration made for hand-raised accounts.
    await queryRunner.query(`
      UPDATE "User"
         SET "quota_override" = 60000
       WHERE "tier_id" = 'max' AND "quota_override" IS NULL
    `);
    await queryRunner.query(`UPDATE "User" SET "tier_id" = 'free' WHERE "tier_id" = 'max'`);
    await queryRunner.query(`DELETE FROM "Tier" WHERE "id" = 'max'`);

    await queryRunner.query(`
      UPDATE "Tier" SET "display_name" = 'Plus', "monthly_quota_limit" = 25000, "updated_at" = now() WHERE "id" = 'plus'
    `);
    await queryRunner.query(`
      UPDATE "Tier" SET "display_name" = 'Pro', "monthly_quota_limit" = 100000, "updated_at" = now() WHERE "id" = 'pro'
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_tier_patreon_tier_id"`);
    await queryRunner.query(`ALTER TABLE "Tier" DROP COLUMN "patreon_tier_id"`);
  }
}
