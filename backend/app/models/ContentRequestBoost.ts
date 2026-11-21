import { BaseEntity, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { ContentRequest } from './ContentRequest';
import type { User } from './User';

/**
 * A patron's boost: worth several votes, permanent, and at most one per account and request. Patrons get a monthly
 * allowance by Patreon tier (`Tier.monthlyRequestBoosts`), counted from these rows by calendar month (UTC).
 */
@Entity('ContentRequestBoost')
@Index(['userId', 'createdAt'])
// TypeORM's own BaseEntity: these join rows have no `updated_at`, which the app's base entity would add.
export class ContentRequestBoost extends BaseEntity {
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
