import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which parser produced a segment's `tokens`.
 *
 * Shirabe is being replaced by our own parser, which will run in shadow and then reparse the corpus in batches. Rows
 * from the two must be told apart while both exist, so the batches can resume and the switch can be measured.
 *
 * Every existing row came from Shirabe. Adding the column with a constant default and then dropping the default
 * stamps them all as 'shirabe' without rewriting ~1.5M rows (Postgres stores the default once), while new rows start
 * NULL until a parser writes them. The value means nothing while `tokens` is NULL.
 */
export class SegmentParserVersion1790200000000 implements MigrationInterface {
  name = 'SegmentParserVersion1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" ADD COLUMN "parser_version" varchar(32) DEFAULT 'shirabe'`);
    await queryRunner.query(`ALTER TABLE "Segment" ALTER COLUMN "parser_version" DROP DEFAULT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Segment" DROP COLUMN "parser_version"`);
  }
}
