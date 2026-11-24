import { BaseEntity, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';

/** What the bell can say. Each kind belongs to one channel category, see `NOTIFICATION_CATEGORY`. */
export type NotificationKind = 'word-available' | 'word-digest' | 'request-update';

/**
 * One entry in a reader's notification centre (task 52). The payload is whatever the site needs to draw it (words,
 * counts, titles, a path); it is written once and never edited. Read entries older than the retention window are
 * deleted by the nightly sweep.
 */
@Entity('Notification')
@Index(['userId', 'createdAt'])
// TypeORM's own BaseEntity: these rows have no `updated_at`, which the app's base entity would add.
export class Notification extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'varchar', length: 32 })
  kind!: NotificationKind;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload!: Record<string, unknown>;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
