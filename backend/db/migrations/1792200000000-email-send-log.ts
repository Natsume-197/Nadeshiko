import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A log of every email the site sends.
 *
 * Until now nothing recorded a send: `EmailEvent` holds what the provider reports back (bounces, complaints,
 * deliveries), `EmailLifecycleSend` holds dedupe claims for two lifecycle kinds, and pg-boss deletes finished jobs
 * after a week. Sign-in mail is sent inline and left no trace at all. So "did we send this reader their link?" had no
 * answer.
 *
 * `EmailSend` is one row per message `sendEmail` was asked to deliver, written whether it went out, failed or was
 * refused. The SES message id ties it to the `EmailEvent` rows that arrive later. The body is never stored: sign-in
 * mail carries a working token.
 *
 * BACKFILL. What can be rebuilt is rebuilt once here, marked `source = 'backfill'`, in order of how much it proves:
 *  1. `EmailEvent`: the provider saw the message, so it was sent. SES payloads also give the subject and send time.
 *  2. `EmailLifecycleSend`: a claim taken right before the job was queued. The address is the account's current one.
 *  3. Finished `email-send` jobs pg-boss still holds (about a week): address, kind, subject and outcome.
 * Each step skips what an earlier one already wrote.
 */
export class EmailSendLog1792200000000 implements MigrationInterface {
  name = 'EmailSendLog1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "EmailSend" (
        "id" SERIAL PRIMARY KEY,
        "sent_at" timestamptz NOT NULL DEFAULT now(),
        "address" character varying(320) NOT NULL,
        "user_id" integer,
        "kind" character varying(32) NOT NULL,
        "campaign" character varying(64),
        "subject" text,
        "status" character varying(16) NOT NULL,
        "error" text,
        "ses_message_id" character varying(128),
        "source" character varying(16) NOT NULL DEFAULT 'live',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP DEFAULT now()
      )
    `);
    // The admin list reads newest first; "what did we send this address" is the support question.
    await queryRunner.query(`CREATE INDEX "IDX_email_send_sent_at" ON "EmailSend" ("sent_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_email_send_address" ON "EmailSend" ("address", "sent_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_email_send_user" ON "EmailSend" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_email_send_ses_message" ON "EmailSend" ("ses_message_id")`);
    // Events are joined to their send by message id.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_email_event_reference" ON "EmailEvent" ("email_reference")`,
    );

    await this.backfill(queryRunner);
  }

  /** Public so the test can run it against seeded rows; `up` runs it once. */
  public async backfill(queryRunner: QueryRunner): Promise<void> {
    // 1. Provider events. One send per message and address; the earliest event stands in for the send time when the
    // payload has no `mail.timestamp` (ZeptoMail-era rows).
    await queryRunner.query(`
      INSERT INTO "EmailSend" (sent_at, address, user_id, kind, campaign, subject, status, ses_message_id, source)
      SELECT DISTINCT ON (e.email_reference, e.address)
        CASE
          WHEN e.payload->'mail'->>'timestamp' ~ '^\\d{4}-\\d{2}-\\d{2}T'
            THEN (e.payload->'mail'->>'timestamp')::timestamptz
          ELSE e.occurred_at
        END,
        e.address,
        u.id,
        left(COALESCE(NULLIF(split_part(e.client_reference, ':', 1), ''), 'unknown'), 32),
        left(NULLIF(substring(e.client_reference FROM position(':' IN e.client_reference) + 1), e.client_reference), 64),
        e.payload->'mail'->'commonHeaders'->>'subject',
        'sent',
        e.email_reference,
        'backfill'
      FROM "EmailEvent" e
      LEFT JOIN "User" u ON lower(u.email) = e.address
      WHERE e.email_reference IS NOT NULL
      ORDER BY e.email_reference, e.address, e.occurred_at
    `);

    // 2. Lifecycle claims not already covered by an event for the same reader, kind and campaign.
    await queryRunner.query(`
      INSERT INTO "EmailSend" (sent_at, address, user_id, kind, campaign, status, source)
      SELECT l.sent_at, lower(u.email), l.user_id, l.kind, l.campaign, 'sent', 'backfill'
      FROM "EmailLifecycleSend" l
      JOIN "User" u ON u.id = l.user_id
      WHERE u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "EmailSend" s
          WHERE s.address = lower(u.email) AND s.kind = l.kind AND s.campaign IS NOT DISTINCT FROM l.campaign
        )
    `);

    // 3. Finished send jobs pg-boss still holds. A job that "completed" for a suppressed address never left; one an
    // event or claim already covers (same address, kind and campaign within a day) is skipped.
    const [{ exists }] = await queryRunner.query(`SELECT to_regclass('pgboss.job') IS NOT NULL AS "exists"`);
    if (!exists) return;

    await queryRunner.query(`
      INSERT INTO "EmailSend" (sent_at, address, user_id, kind, campaign, subject, status, error, source)
      SELECT
        COALESCE(j.completed_on, j.created_on),
        lower(j.data->>'to'),
        CASE WHEN j.data->>'userId' ~ '^\\d{1,9}$' THEN (j.data->>'userId')::int END,
        left(COALESCE(j.data->>'kind', 'unknown'), 32),
        left(j.data->>'campaign', 64),
        j.data->>'subject',
        CASE
          WHEN j.state::text = 'failed' THEN 'failed'
          WHEN EXISTS (
            SELECT 1 FROM "EmailSuppression" x
            WHERE x.address = lower(j.data->>'to') AND x.suppressed_at <= COALESCE(j.completed_on, j.created_on)
          ) THEN 'suppressed'
          ELSE 'sent'
        END,
        CASE WHEN j.state::text = 'failed' THEN left(j.output->>'message', 500) END,
        'backfill'
      FROM pgboss.job j
      WHERE j.name = 'email-send'
        AND j.state::text IN ('completed', 'failed')
        AND COALESCE(j.data->>'to', '') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM "EmailSend" s
          WHERE s.address = lower(j.data->>'to')
            AND s.kind = COALESCE(j.data->>'kind', 'unknown')
            AND s.campaign IS NOT DISTINCT FROM (j.data->>'campaign')
            AND abs(extract(epoch FROM s.sent_at - COALESCE(j.completed_on, j.created_on))) < 86400
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_email_event_reference"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "EmailSend"`);
  }
}
