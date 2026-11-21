import { BaseEntity, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { ContentRequest } from './ContentRequest';
import type { User } from './User';

/** One vote per account and request. A voter is also subscribed: they hear when the request is worked on or ships. */
@Entity('ContentRequestVote')
@Index(['userId'])
// TypeORM's own BaseEntity: these join rows have no `updated_at`, which the app's base entity would add.
export class ContentRequestVote extends BaseEntity {
  @PrimaryColumn({ name: 'request_id', type: 'int' })
  requestId!: number;

  @PrimaryColumn({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @ManyToOne('ContentRequest', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request?: ContentRequest;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
