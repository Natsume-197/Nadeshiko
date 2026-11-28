import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';

export type EmailBroadcastAudience = 'ALL_OPTED_IN' | 'PATRONS' | 'ACTIVE_DAYS' | 'SPECIFIC_USERS';
export type EmailBroadcastStatus = 'DRAFT' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

export interface EmailBroadcastAudienceParams {
  activeDays?: number;
  userIds?: number[];
}

/**
 * Custom rich email broadcast / campaign managed from `/admin/emails` (task 55).
 * Dispatched in rate-limited batches by `emailBroadcastWorker`, with delivery/bounce stats in `EmailSend`.
 */
@Entity('EmailBroadcast')
export class EmailBroadcast extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ name: 'campaign_key', type: 'varchar', length: 80, unique: true })
  campaignKey!: string;

  @Column({ type: 'varchar', length: 200 })
  subject!: string;

  @Column({ name: 'preview_text', type: 'varchar', length: 240, nullable: true })
  previewText!: string | null;

  @Column({ name: 'body_markdown', type: 'text' })
  bodyMarkdown!: string;

  @Column({ name: 'cta_label', type: 'varchar', length: 80, nullable: true })
  ctaLabel!: string | null;

  @Column({ name: 'cta_url', type: 'varchar', length: 512, nullable: true })
  ctaUrl!: string | null;

  @Column({ type: 'varchar', length: 32 })
  audience!: EmailBroadcastAudience;

  @Column({ name: 'audience_params', type: 'jsonb', default: () => `'{}'::jsonb` })
  audienceParams!: EmailBroadcastAudienceParams;

  @Column({ type: 'varchar', length: 24, default: 'DRAFT' })
  status!: EmailBroadcastStatus;

  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  recipientCount!: number;

  @Column({ name: 'sent_count', type: 'int', default: 0 })
  sentCount!: number;

  @Column({ name: 'failed_count', type: 'int', default: 0 })
  failedCount!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: User | null;
}
