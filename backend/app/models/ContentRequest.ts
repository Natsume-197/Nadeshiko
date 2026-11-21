import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { CategoryType } from './Media';
import { ExternalSourceType } from './MediaExternalId';
import type { Media } from './Media';
import type { User } from './User';

/** NEW asks for a title that is not on Nadeshiko; UPDATE asks for more of one that is (episodes, a season, videos). */
export enum ContentRequestKind {
  NEW = 'NEW',
  UPDATE = 'UPDATE',
}

export enum ContentRequestStatus {
  OPEN = 'OPEN',
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  RELEASED = 'RELEASED',
  DECLINED = 'DECLINED',
}

/** Statuses a request is still waiting in: they count against the requester's open limit and can be voted on. */
export const ACTIVE_REQUEST_STATUSES: readonly ContentRequestStatus[] = [
  ContentRequestStatus.OPEN,
  ContentRequestStatus.PLANNED,
  ContentRequestStatus.IN_PROGRESS,
];

/** Votes one boost counts for in a request's score. */
export const REQUEST_BOOST_WEIGHT = 5;

/**
 * A reader's request for content, shared by everyone who wants the same title: a second request for a title that is
 * already asked for becomes a vote on the first one. The vote and boost counters are kept on the row so the list can
 * sort by score without aggregating; the vote and boost tables are the truth they are rebuilt from.
 */
@Entity('ContentRequest')
@Index(['status', 'score'])
export class ContentRequest extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ type: 'enum', enum: CategoryType, enumName: 'ContentRequest_category_enum' })
  category!: CategoryType;

  @Column({ type: 'enum', enum: ContentRequestKind, default: ContentRequestKind.NEW })
  kind!: ContentRequestKind;

  @Column({ type: 'enum', enum: ContentRequestStatus, default: ContentRequestStatus.OPEN })
  status!: ContentRequestStatus;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  /** The requester's note: which season, why, where subtitles exist. */
  @Column({ type: 'text', default: '' })
  note!: string;

  @Column({ name: 'source_url', type: 'text' })
  sourceUrl!: string;

  /** Where the identity below comes from; null when the link names nothing we can match (a MyDramaList page). */
  @Column({
    name: 'external_source',
    type: 'enum',
    enum: ExternalSourceType,
    enumName: 'ContentRequest_external_source_enum',
    nullable: true,
  })
  externalSource!: ExternalSourceType | null;

  /** The same id `MediaExternalId` stores for published media, so a request can be matched to what ships. A single
   * YouTube video is `video:<id>`, which no media carries. */
  @Column({ name: 'external_id', type: 'varchar', length: 120, nullable: true })
  externalId!: string | null;

  @Column({ name: 'cover_url', type: 'text', nullable: true })
  coverUrl!: string | null;

  /** The published media: the one an UPDATE is for, or the one a released request produced. */
  @Column({ name: 'media_id', type: 'int', nullable: true })
  mediaId!: number | null;

  @ManyToOne('Media', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'media_id' })
  media?: Media | null;

  /** Shown publicly on a declined request, so the same title is not asked for again. */
  @Column({ name: 'decline_reason', type: 'text', nullable: true })
  declineReason!: string | null;

  @Column({ name: 'vote_count', type: 'int', default: 0 })
  voteCount!: number;

  @Column({ name: 'boost_count', type: 'int', default: 0 })
  boostCount!: number;

  /** votes + boosts × weight, kept by the database (a generated column) so it can be indexed and sorted on. */
  @Column({
    type: 'int',
    generatedType: 'STORED',
    asExpression: `"vote_count" + "boost_count" * ${REQUEST_BOOST_WEIGHT}`,
    insert: false,
    update: false,
  })
  score!: number;

  /** Another active request this one looks like (same title, different link). Flagged for an admin, never merged
   * automatically. */
  @Column({ name: 'possible_duplicate_of_id', type: 'int', nullable: true })
  possibleDuplicateOfId!: number | null;

  @ManyToOne('ContentRequest', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'possible_duplicate_of_id' })
  possibleDuplicateOf?: ContentRequest | null;

  @Column({ name: 'requester_user_id', type: 'int', nullable: true })
  requesterUserId!: number | null;

  @ManyToOne('User', { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'requester_user_id' })
  requester?: User | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;
}
