import { BaseEntity, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';

/**
 * Runtime overrides for one entry of `notificationRegistry` (tasks 52 Phase 2 & 55).
 * Rows exist only when an admin has changed a toggle, parameter, or email template override away from code defaults.
 */
@Entity('NotificationSetting')
export class NotificationSetting extends BaseEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  kind!: string;

  @Column({ name: 'site_enabled', type: 'boolean', default: true })
  siteEnabled!: boolean;

  @Column({ name: 'email_enabled', type: 'boolean', default: true })
  emailEnabled!: boolean;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  params!: Record<string, unknown>;

  @Column({ name: 'subject_override', type: 'text', nullable: true })
  subjectOverride!: string | null;

  @Column({ name: 'body_override', type: 'text', nullable: true })
  bodyOverride!: string | null;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy!: number | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;

  @ManyToOne('User', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by' })
  updatedByUser?: User | null;
}
