export const ES_SYNC_CREATE_QUEUE = 'es-sync-create';
export const ES_SYNC_UPDATE_QUEUE = 'es-sync-update';
export const ES_SYNC_DELETE_QUEUE = 'es-sync-delete';
export const EMAIL_SEND_QUEUE = 'email-send';
export const EMAIL_LIFECYCLE_QUEUE = 'email-lifecycle-sweep';
export const ACTIVITY_RETENTION_QUEUE = 'activity-retention-cleanup';
export const AFFINITY_RETENTION_QUEUE = 'affinity-retention-cleanup';
export const TOKEN_PARSE_QUEUE = 'segment-token-parse';
export const TOKEN_SWEEP_QUEUE = 'segment-token-sweep';
export const DICTIONARY_REFRESH_QUEUE = 'dictionary-refresh';
export const RECURRING_RECOMPUTE_QUEUE = 'segment-recurring-recompute';
export const RECURRING_SWEEP_QUEUE = 'segment-recurring-sweep';
export const PATREON_MEMBERSHIP_REFRESH_QUEUE = 'patreon-membership-refresh';
export const USER_DICTIONARY_IMPORT_QUEUE = 'user-dictionary-import';
export const USER_DICTIONARY_MAINTENANCE_QUEUE = 'user-dictionary-maintenance';
export const WORD_WATCH_FIRST_QUEUE = 'word-watch-first';
export const WORD_WATCH_DIGEST_QUEUE = 'word-watch-digest';

const ES_SYNC_QUEUES = [ES_SYNC_CREATE_QUEUE, ES_SYNC_UPDATE_QUEUE, ES_SYNC_DELETE_QUEUE] as const;

export const ALL_QUEUES = [
  ES_SYNC_CREATE_QUEUE,
  ES_SYNC_UPDATE_QUEUE,
  ES_SYNC_DELETE_QUEUE,
  EMAIL_SEND_QUEUE,
  EMAIL_LIFECYCLE_QUEUE,
  ACTIVITY_RETENTION_QUEUE,
  AFFINITY_RETENTION_QUEUE,
  TOKEN_PARSE_QUEUE,
  TOKEN_SWEEP_QUEUE,
  DICTIONARY_REFRESH_QUEUE,
  RECURRING_RECOMPUTE_QUEUE,
  RECURRING_SWEEP_QUEUE,
  PATREON_MEMBERSHIP_REFRESH_QUEUE,
  USER_DICTIONARY_IMPORT_QUEUE,
  USER_DICTIONARY_MAINTENANCE_QUEUE,
  WORD_WATCH_FIRST_QUEUE,
  WORD_WATCH_DIGEST_QUEUE,
] as const;

export type EsSyncQueueName = (typeof ES_SYNC_QUEUES)[number];
