import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Uploaded image asset used inside admin email broadcasts (task 55).
 * Stored in Postgres and served publicly at `/v1/email/assets/:publicId` with immutable cache headers so pasted
 * screenshots work identically in local dev, staging, and production without extra R2 credentials.
 */
@Entity('EmailAsset')
export class EmailAsset extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Column({ name: 'public_id', type: 'uuid', unique: true, generated: 'uuid' })
  publicId!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 64 })
  mimeType!: string;

  @Column({ type: 'bytea' })
  data!: Buffer;

  @Column({ name: 'byte_size', type: 'int' })
  byteSize!: number;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
