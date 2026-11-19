import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { BaseEntity } from './base.entity';

export type UserDictionaryArtifactStatus = 'processing' | 'ready' | 'failed';

/**
 * Content-addressed metadata for one uploaded Yomitan `.zip` indexed into SQLite (`<sha256>.sqlite`).
 *
 * Shared storage is deduplicated by full-file SHA-256 so repeated uploads of the same archive do not duplicate disk
 * usage, while strict access control is enforced by requiring a `UserDictionary` row proving this account uploaded it.
 */
@Entity('UserDictionaryArtifact')
export class UserDictionaryArtifact extends BaseEntity {
  @PrimaryColumn({ type: 'int', generated: 'increment' })
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'sha256', type: 'varchar', length: 64 })
  sha256!: string;

  /** Unguessable 256-bit random hex key used for the R2 object path (`<prefix>/<storageKey>.sqlite`). Separate from
   * `sha256` so someone who owns the original `.zip` cannot deduce its R2 URL even inside a shared bucket. */
  @Index({ unique: true })
  @Column({ name: 'storage_key', type: 'varchar', length: 64 })
  storageKey!: string;

  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;

  @Column({ name: 'revision', type: 'varchar', length: 120 })
  revision!: string;

  @Column({ name: 'author', type: 'varchar', length: 200, nullable: true })
  author?: string | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'url', type: 'varchar', length: 500, nullable: true })
  url?: string | null;

  @Column({ name: 'format', type: 'smallint', default: 3 })
  format!: number;

  @Column({ name: 'frequency_mode', type: 'varchar', length: 32, nullable: true })
  frequencyMode?: string | null;

  @Column({ name: 'has_terms', type: 'boolean', default: false })
  hasTerms!: boolean;

  @Column({ name: 'has_frequency', type: 'boolean', default: false })
  hasFrequency!: boolean;

  @Column({ name: 'has_pitch', type: 'boolean', default: false })
  hasPitch!: boolean;

  @Column({ name: 'term_count', type: 'int', default: 0 })
  termCount!: number;

  @Column({ name: 'frequency_count', type: 'int', default: 0 })
  frequencyCount!: number;

  @Column({ name: 'pitch_count', type: 'int', default: 0 })
  pitchCount!: number;

  @Column({ name: 'zip_bytes', type: 'bigint' })
  zipBytes!: string;

  @Column({ name: 'sqlite_bytes', type: 'bigint', default: '0' })
  sqliteBytes!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'processing' })
  status!: UserDictionaryArtifactStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null;

  /** `IMPORTER_VERSION` that built the SQLite file; 0 until an import finishes. An upload of an artifact built by an
   * older version re-indexes it rather than reusing it. */
  @Column({ name: 'importer_version', type: 'smallint', default: 0 })
  importerVersion!: number;
}
