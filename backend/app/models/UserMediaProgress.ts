import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { Media } from './Media';
import type { User } from './User';
import { BaseEntity } from './base.entity';
import { TrackerProviderType } from './TrackerConnection';

export enum WatchStatus {
  WATCHING = 'WATCHING',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED',
  DROPPED = 'DROPPED',
  PLANNING = 'PLANNING',
}

@Entity('UserMediaProgress')
@Index('UQ_user_media_progress_user_external', ['userId', 'externalSource', 'externalId'], { unique: true })
export class UserMediaProgress extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ type: 'enum', enum: TrackerProviderType })
  provider!: TrackerProviderType;

  @Column({ name: 'external_source', type: 'varchar', length: 16 })
  externalSource!: string;

  @Column({ name: 'external_id', type: 'varchar', length: 64 })
  externalId!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ name: 'media_id', type: 'int', nullable: true })
  mediaId?: number | null;

  @Column({ type: 'enum', enum: WatchStatus })
  status!: WatchStatus;

  @Column({ type: 'int', default: 0 })
  progress!: number;

  @Column({ name: 'custom_lists', type: 'text', array: true, default: () => "'{}'" })
  customLists!: string[];

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne('Media', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'media_id' })
  media?: Media | null;
}
