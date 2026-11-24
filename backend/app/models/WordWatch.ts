import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';

/** `FIRST`: tell me once when the word starts returning sentences. `NEW_SENTENCES`: a weekly digest of new ones. */
export enum WordWatchMode {
  FIRST = 'FIRST',
  NEW_SENTENCES = 'NEW_SENTENCES',
}

/** `FULFILLED` is a `FIRST` alert that was met; it stays listed so the reader can switch it to `NEW_SENTENCES`. */
export enum WordWatchStatus {
  ACTIVE = 'ACTIVE',
  FULFILLED = 'FULFILLED',
  PAUSED = 'PAUSED',
}

/** The search's own match modes (task 43), so an alert counts exactly what the reader's search showed. */
export enum WordWatchMatchMode {
  WORD = 'WORD',
  EXACT = 'EXACT',
  CONTAINS = 'CONTAINS',
}

/**
 * One reader's alert on one word (task 52). `lastCount` is the reader's own filtered count when they were last told
 * (or when the alert was made); notices are decided on it. `lastGlobalCount` is the unfiltered count at that same
 * moment: filters only remove sentences, so a word whose global count has not grown since cannot have grown for the
 * reader either, and the sweep skips it without running their search.
 */
@Entity('WordWatch')
@Index(['userId', 'query', 'matchMode'], { unique: true })
@Index(['status', 'mode'])
export class WordWatch extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  /** NFKC-normalised and trimmed; `isWordQuery` decides what may be stored. */
  @Column({ type: 'varchar', length: 32 })
  query!: string;

  @Column({ name: 'match_mode', type: 'enum', enum: WordWatchMatchMode, default: WordWatchMatchMode.WORD })
  matchMode!: WordWatchMatchMode;

  @Column({ type: 'enum', enum: WordWatchMode })
  mode!: WordWatchMode;

  @Column({ type: 'enum', enum: WordWatchStatus, default: WordWatchStatus.ACTIVE })
  status!: WordWatchStatus;

  @Column({ name: 'last_count', type: 'int', default: 0 })
  lastCount!: number;

  @Column({ name: 'last_global_count', type: 'int', default: 0 })
  lastGlobalCount!: number;

  @Column({ name: 'last_notified_at', type: 'timestamptz', nullable: true })
  lastNotifiedAt!: Date | null;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
