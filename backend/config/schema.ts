/**
 * Single source of truth for TypeORM entities, subscribers, and shared config.
 * Used by both the production DataSource and the test DataSource.
 */
import type { LoggerOptions } from 'typeorm';
import { isProdEnvironment } from '@config/environment';
import { config } from '@config/config';
import {
  User,
  AccountQuotaUsage,
  Tier,
  Media,
  MediaExternalId,
  Segment,
  Episode,
  Collection,
  CollectionSegment,
  Report,
  Feedback,
  EmailEvent,
  EmailSuppression,
  EmailLifecycleSend,
  UserActivity,
  UserMediaAffinity,
  SegmentRevision,
  Announcement,
  WordFrequency,
  PatreonConnection,
  TrackerConnection,
  UserMediaProgress,
  ContentRequest,
  ContentRequestVote,
  ContentRequestBoost,
  WordWatch,
  Notification,
  UserDictionary,
  UserDictionaryArtifact,
  UserDictionaryUpload,
} from '@app/models';
import { SegmentSubscriber } from '@app/subscribers';

export const APP_ENTITIES = [
  User,
  AccountQuotaUsage,
  Tier,
  Media,
  MediaExternalId,
  Segment,
  Episode,
  Collection,
  CollectionSegment,
  Report,
  Feedback,
  EmailEvent,
  EmailSuppression,
  EmailLifecycleSend,
  UserActivity,
  UserMediaAffinity,
  SegmentRevision,
  Announcement,
  WordFrequency,
  PatreonConnection,
  TrackerConnection,
  UserMediaProgress,
  ContentRequest,
  ContentRequestVote,
  ContentRequestBoost,
  WordWatch,
  Notification,
  UserDictionary,
  UserDictionaryArtifact,
  UserDictionaryUpload,
];

export const APP_SUBSCRIBERS = [SegmentSubscriber];

/** Parse `DB_LOG_LEVEL` as booleans, `all`, or a comma-separated level list; unset enables logging in dev/local and
 * disables it in production. */
export function getDbLogging(rawValue: string | undefined = config.DB_LOG_LEVEL): LoggerOptions {
  const raw = rawValue?.trim().toLowerCase();
  if (!raw) return !isProdEnvironment();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'all') return 'all';
  return raw.split(',').map((s) => s.trim()) as LoggerOptions;
}
