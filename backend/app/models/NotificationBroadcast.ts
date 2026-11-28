import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';

export type NotificationBroadcastKind = 'site-announcement' | 'admin-message';
export type NotificationBroadcastAudience = 'ALL' | 'PATRONS' | 'USER';
export type NotificationBroadcastStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';

/**
 * Audit & dispatch record for admin-sent in-site official notices (task 52 Phase 2a).
 */
@Entity('NotificationBroadcast')
export class NotificationBroadcast extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ type: 'varchar', length: 32 })
  kind!: NotificationBroadcastKind;

  @Column({ type: 'varchar', length: 32 })
  audience!: NotificationBroadcastAudience;

  @Column({ name: 'target_user_id', type: 'int', nullable: true })
  targetUserId!: number | null;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'link_url', type: 'varchar', length: 512, nullable: true })
  linkUrl!: string | null;

  @Column({ name: 'link_label', type: 'varchar', length: 80, nullable: true })
  linkLabel!: string | null;

  @Column({ type: 'varchar', length: 24, default: 'QUEUED' })
  status!: NotificationBroadcastStatus;

  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  recipientCount!: number;

  @Column({ name: 'sent_count', type: 'int', default: 0 })
  sentCount!: number;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'target_user_id' })
  targetUser?: User | null;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser?: User | null;
}
