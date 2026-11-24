// Base entity
export { BaseEntity } from './base.entity';

// User domain
export { User, UserRoleType } from './User';
export type { UserPreferences } from './User';
export { AccountQuotaUsage } from './AccountQuotaUsage';
export { PatreonConnection } from './PatreonConnection';
export { UserDictionary } from './UserDictionary';
export { UserDictionaryArtifact } from './UserDictionaryArtifact';
export type { UserDictionaryArtifactStatus } from './UserDictionaryArtifact';
export { UserDictionaryUpload } from './UserDictionaryUpload';
export type { UserDictionaryUploadStatus } from './UserDictionaryUpload';
export {
  ContentRequest,
  ContentRequestKind,
  ContentRequestStatus,
  ACTIVE_REQUEST_STATUSES,
  REQUEST_BOOST_WEIGHT,
} from './ContentRequest';
export { ContentRequestVote } from './ContentRequestVote';
export { ContentRequestBoost } from './ContentRequestBoost';
export { WordWatch, WordWatchMode, WordWatchStatus, WordWatchMatchMode } from './WordWatch';
export { Notification } from './Notification';
export type { NotificationKind } from './Notification';
export { Tier } from './Tier';
export {
  resolveQuotaLimit,
  patreonQuotaTier,
  highestEntitledTier,
  unmatchedPatreonTierIds,
  PATREON_QUOTA_STALE_MS,
} from './quota';
export type { QuotaSource, ResolvedQuota, PatreonMembership } from './quota';

// Media domain
export { Media, CategoryType, ALL_CATEGORIES } from './Media';
export { MediaExternalId, ExternalSourceType } from './MediaExternalId';
export { Segment, SegmentStatus, SegmentStorage, ContentRating } from './Segment';
export type { RatingAnalysisData } from './Segment';
export { Episode } from './Episode';
export { Collection, CollectionType, CollectionVisibility } from './Collection';
export { CollectionSegment } from './CollectionSegment';
export { SegmentRevision, RevisionActor } from './SegmentRevision';

// API domain
export { AuthType, ApiKeyKind, ApiPermission } from './ApiPermission';

// Reports
export { Report, ReportSource, ReportTargetType, ReportStatus, ReportReason } from './Report';

// Feedback
export { Feedback, FEEDBACK_MAX_BODY, FEEDBACK_MAX_URLS } from './Feedback';

// Outbound mail: what came back, and who we stopped writing to
export { EmailEvent, EMAIL_EVENTS } from './EmailEvent';
export { EmailLifecycleSend, LIFECYCLE_KINDS } from './EmailLifecycleSend';
export type { LifecycleKind } from './EmailLifecycleSend';
export type { EmailEventName } from './EmailEvent';
export { EmailSuppression, SUPPRESSION_CAUSES, isPermanentCause } from './EmailSuppression';
export type { SuppressionCause } from './EmailSuppression';

// Activity tracking
export { UserActivity, ActivityType } from './UserActivity';
export { UserMediaAffinity } from './UserMediaAffinity';

// Announcements
export { Announcement } from './Announcement';
export type { AnnouncementType } from './Announcement';

// Word frequency
export { WordFrequency } from './WordFrequency';
