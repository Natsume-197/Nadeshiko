import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

export type UserDictionaryUploadStatus = 'reserved' | 'completed';

/**
 * A reservation for one direct upload of a custom dictionary `.zip` to R2 (task 48). It binds the presigned PUT to an
 * account, an object key and a declared size; `completeDictionaryUpload` checks all three before importing.
 */
@Entity('UserDictionaryUpload')
export class UserDictionaryUpload extends BaseEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'user_id', type: 'int' })
  userId!: number;

  @Column({ name: 'object_key', type: 'varchar', length: 300 })
  objectKey!: string;

  @Column({ name: 'declared_bytes', type: 'bigint' })
  declaredBytes!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'reserved' })
  status!: UserDictionaryUploadStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
