import { Column, Entity, Index, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import type { User } from './User';
import { BaseEntity } from './base.entity';

export enum TrackerProviderType {
  ANILIST = 'ANILIST',
  MAL = 'MAL',
}

@Entity('TrackerConnection')
export class TrackerConnection extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'enum', enum: TrackerProviderType })
  provider!: TrackerProviderType;

  @Column({ name: 'external_user_id', type: 'varchar', length: 128 })
  externalUserId!: string;

  @Column({ name: 'external_username', type: 'varchar', length: 128, nullable: true })
  externalUsername?: string | null;

  @Column({ name: 'access_token_ciphertext', type: 'text' })
  accessTokenCiphertext!: string;

  @Column({ name: 'refresh_token_ciphertext', type: 'text', nullable: true })
  refreshTokenCiphertext?: string | null;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz', nullable: true })
  accessTokenExpiresAt?: Date | null;

  @Column({ name: 'auto_sync_enabled', type: 'boolean', default: true })
  autoSyncEnabled!: boolean;

  @Column({ name: 'spoiler_guard_enabled', type: 'boolean', default: true })
  spoilerGuardEnabled!: boolean;

  @Column({ name: 'hide_plan_to_watch', type: 'boolean', default: false })
  hidePlanToWatch!: boolean;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt?: Date | null;

  @Column({ name: 'last_sync_error', type: 'text', nullable: true })
  lastSyncError?: string | null;

  @OneToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
