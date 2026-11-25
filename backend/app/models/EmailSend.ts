import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import type { EmailKind } from '@app/services/email/metrics';
import { BaseEntity } from './base.entity';

/** What became of one send attempt. A bounce or a delivery is not a status here: those arrive later as `EmailEvent`
 * rows, joined on `ses_message_id`. */
export type EmailSendStatus = 'sent' | 'failed' | 'suppressed';

/** `backfill` rows were rebuilt from older tables when the log started; they carry less detail than `live` ones. */
type EmailSendSource = 'live' | 'backfill';

/** One row per message `sendEmail` was asked to deliver, written whether it went out, failed or was refused. Never the
 * body: sign-in mail carries a working token. */
@Entity('EmailSend')
@Index('IDX_email_send_sent_at', ['sentAt'])
@Index('IDX_email_send_address', ['address', 'sentAt'])
export class EmailSend extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;

  @Column({ type: 'varchar', length: 320 })
  address!: string;

  @Index('IDX_email_send_user')
  @Column({ name: 'user_id', type: 'int', nullable: true })
  userId?: number | null;

  @Column({ type: 'varchar', length: 32 })
  kind!: EmailKind;

  @Column({ type: 'varchar', length: 64, nullable: true })
  campaign?: string | null;

  @Column({ type: 'text', nullable: true })
  subject?: string | null;

  @Column({ type: 'varchar', length: 16 })
  status!: EmailSendStatus;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Index('IDX_email_send_ses_message')
  @Column({ name: 'ses_message_id', type: 'varchar', length: 128, nullable: true })
  sesMessageId?: string | null;

  @Column({ type: 'varchar', length: 16, default: 'live' })
  source!: EmailSendSource;
}
