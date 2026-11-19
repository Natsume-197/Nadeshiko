import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import type { User } from './User';
import { UserDictionaryArtifact } from './UserDictionaryArtifact';

/**
 * Private per-account link to an indexed Yomitan dictionary artifact, with the user's own stack order and toggle.
 */
@Entity('UserDictionary')
@Unique(['userId', 'artifactId'])
@Index(['userId', 'sortOrder'])
export class UserDictionary extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Index()
  @Column({ name: 'artifact_id', type: 'int' })
  artifactId!: number;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne(() => UserDictionaryArtifact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'artifact_id' })
  artifact?: UserDictionaryArtifact;
}
