import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Content requests with votes (task 49): readers request anime, J-dramas, audiobooks and YouTube channels on the site,
 * everyone votes, patrons boost. Replaces the patron-only roadmap proposals, which never went live; their roadmap
 * feature entry is renamed to what shipped instead.
 */
export class ContentRequests1791800000000 implements MigrationInterface {
  name = 'ContentRequests1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "ContentRequest_category_enum" AS ENUM ('ANIME', 'JDRAMA', 'YOUTUBE', 'AUDIOBOOK')`,
    );
    await queryRunner.query(`CREATE TYPE "ContentRequest_kind_enum" AS ENUM ('NEW', 'UPDATE')`);
    await queryRunner.query(
      `CREATE TYPE "ContentRequest_status_enum" AS ENUM ('OPEN', 'PLANNED', 'IN_PROGRESS', 'RELEASED', 'DECLINED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "ContentRequest_external_source_enum" AS ENUM ('ANILIST', 'IMDB', 'TVDB', 'TMDB', 'YOUTUBE', 'ASIN')`,
    );
    await queryRunner.query(`
      CREATE TABLE "ContentRequest" (
        "id" SERIAL PRIMARY KEY,
        "public_id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "category" "ContentRequest_category_enum" NOT NULL,
        "kind" "ContentRequest_kind_enum" NOT NULL DEFAULT 'NEW',
        "status" "ContentRequest_status_enum" NOT NULL DEFAULT 'OPEN',
        "title" character varying(180) NOT NULL,
        "note" text NOT NULL DEFAULT '',
        "source_url" text NOT NULL,
        "external_source" "ContentRequest_external_source_enum",
        "external_id" character varying(120),
        "cover_url" text,
        "media_id" integer REFERENCES "Media"("id") ON DELETE SET NULL,
        "decline_reason" text,
        "vote_count" integer NOT NULL DEFAULT 0,
        "boost_count" integer NOT NULL DEFAULT 0,
        "score" integer GENERATED ALWAYS AS ("vote_count" + "boost_count" * 5) STORED,
        "possible_duplicate_of_id" integer REFERENCES "ContentRequest"("id") ON DELETE SET NULL,
        "requester_user_id" integer REFERENCES "User"("id") ON DELETE SET NULL,
        "released_at" timestamptz,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now(),
        CONSTRAINT "UQ_content_request_public_id" UNIQUE ("public_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_content_request_status_score" ON "ContentRequest" ("status", "score")`);
    await queryRunner.query(`CREATE INDEX "IDX_content_request_requester" ON "ContentRequest" ("requester_user_id")`);
    // One active request per title: a second request for the same identity becomes a vote. Released and declined
    // requests leave the index, so a title can be asked for again later (a new season, a decline that no longer holds).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_content_request_active_identity" ON "ContentRequest" ("external_source", "external_id")
      WHERE "external_id" IS NOT NULL AND "status" IN ('OPEN', 'PLANNED', 'IN_PROGRESS')
    `);

    await queryRunner.query(`
      CREATE TABLE "ContentRequestVote" (
        "request_id" integer NOT NULL REFERENCES "ContentRequest"("id") ON DELETE CASCADE,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("request_id", "user_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_content_request_vote_user" ON "ContentRequestVote" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "ContentRequestBoost" (
        "request_id" integer NOT NULL REFERENCES "ContentRequest"("id") ON DELETE CASCADE,
        "user_id" integer NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("request_id", "user_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_content_request_boost_user_created" ON "ContentRequestBoost" ("user_id", "created_at")`,
    );

    // Boosts per Patreon tier, decided 2026-11-21: Seed 3, Flower 5, Nadeshiko 10.
    await queryRunner.query(`ALTER TABLE "Tier" ADD COLUMN "monthly_request_boosts" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`UPDATE "Tier" SET "monthly_request_boosts" = 3 WHERE "id" = 'plus'`);
    await queryRunner.query(`UPDATE "Tier" SET "monthly_request_boosts" = 5 WHERE "id" = 'pro'`);
    await queryRunner.query(`UPDATE "Tier" SET "monthly_request_boosts" = 10 WHERE "id" = 'max'`);

    await queryRunner.query(`
      UPDATE "RoadmapItem"
         SET "title" = 'Content requests',
             "description" = 'Anyone can request anime, dramas, audiobooks and YouTube channels and vote for what comes next; patrons boost.',
             "updated_at" = now()
       WHERE "kind" = 'FEATURE' AND "title" = 'Patreon title proposals'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "RoadmapItem"
         SET "title" = 'Patreon title proposals',
             "description" = 'Patrons can link their membership, propose a title, and follow approved additions on the public roadmap.'
       WHERE "kind" = 'FEATURE' AND "title" = 'Content requests'
    `);
    await queryRunner.query(`ALTER TABLE "Tier" DROP COLUMN "monthly_request_boosts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ContentRequestBoost"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ContentRequestVote"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ContentRequest"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ContentRequest_external_source_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ContentRequest_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ContentRequest_kind_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ContentRequest_category_enum"`);
  }
}
