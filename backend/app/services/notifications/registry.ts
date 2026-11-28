import { z } from 'zod';
import type { NotificationKind } from '@app/models';
import type { EmailKind } from '@app/services/email/metrics';
import type { EmailCategory } from '@app/services/email/unsubscribe';

/**
 * Single source of truth for every notification and email kind Nadeshiko can send (tasks 52 Phase 2 & 55).
 * Both `notify()` and `sendEmail()` validate against this catalog; `/admin/notifications` and `/admin/emails` render
 * their control tables straight from it so no undocumented notification can exist.
 */

export type RegistryKind = Exclude<EmailKind, 'unknown' | 'recap'> | NotificationKind;

export type RegistryArea = 'official' | 'words' | 'community' | 'lifecycle' | 'transactional';
export type RegistryTrigger = 'realtime' | 'cron' | 'admin';
export type SiteNotificationCategory = 'words' | 'requests' | 'reports';

export interface RegistryParamField {
  key: string;
  label: string;
  description: string;
  type: 'integer' | 'number';
  min: number;
  max: number;
}

export interface RegistryEntry<TParams extends Record<string, unknown> = Record<string, unknown>> {
  kind: RegistryKind;
  label: string;
  description: string;
  area: RegistryArea;
  trigger: RegistryTrigger;
  schedule?: string;
  channels: {
    site: boolean;
    email: boolean;
  };
  /** User-facing category for site bell preferences; null means not user-muteable (official). */
  siteCategory: SiteNotificationCategory | null;
  /** User-facing category for email opt-out; null means transactional/internal (not opt-out). */
  emailCategory: EmailCategory | null;
  /** Sender identity for email channel, for admin clarity. */
  emailFrom?: 'noreply' | 'hello';
  /** Pinned at top of the bell until read (official notices). */
  pinned: boolean;
  /** Supports folding unread entries via `groupKey`. */
  groupable: boolean;
  /** Cannot be turned off from `/admin` (prevents locking readers out of sign-in). */
  alwaysEnabled: boolean;
  /** Default runtime enabled state when no `NotificationSetting` row exists. */
  defaultSiteEnabled: boolean;
  defaultEmailEnabled: boolean;
  /** Whether subject/body copy can be overridden from `/admin/emails`. */
  editableTemplate: boolean;
  /** Copy file name under `backend/app/mailers/copy/<copyName>.md` when `editableTemplate` is true. */
  copyName?: string;
  /** Default subject line shown in the editor when `editableTemplate` is true. */
  defaultSubject?: string;
  /** Allowed `{{variable}}` placeholders for validation in the admin template editor. */
  allowedVariables?: readonly string[];
  /** Required `{{variable}}` placeholders that must remain in the template override. */
  requiredVariables?: readonly string[];
  /** Typed parameter schema + defaults for runtime tuning. */
  paramsSchema: z.ZodObject<z.ZodRawShape>;
  defaultParams: TParams;
  paramFields: readonly RegistryParamField[];
}

const emptySchema = z.object({});

const wordDigestParamsSchema = z.object({
  minNewSentences: z.number().int().min(1).max(100),
});

const siteAnnouncementParamsSchema = z.object({
  maxPinned: z.number().int().min(1).max(10),
});

const dormant30ParamsSchema = z.object({
  inactiveDays: z.number().int().min(7).max(365),
  dailyCap: z.number().int().min(1).max(500),
  cooldownDays: z.number().int().min(14).max(730),
});

const feedbackAskParamsSchema = z.object({
  delayDays: z.number().int().min(1).max(60),
});

const broadcastParamsSchema = z.object({
  emailsPerSec: z.number().int().min(1).max(50),
  errorCircuitBreakerPct: z.number().int().min(1).max(50),
});

export const NOTIFICATION_REGISTRY: Record<RegistryKind, RegistryEntry> = {
  'site-announcement': {
    kind: 'site-announcement',
    label: 'Site announcement',
    description:
      'Official release or site-wide announcement sent from /admin/notifications. Pinned at the top of the bell.',
    area: 'official',
    trigger: 'admin',
    channels: { site: true, email: false },
    siteCategory: null,
    emailCategory: null,
    pinned: true,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: true,
    defaultEmailEnabled: false,
    editableTemplate: false,
    paramsSchema: siteAnnouncementParamsSchema,
    defaultParams: { maxPinned: 5 },
    paramFields: [
      {
        key: 'maxPinned',
        label: 'Max pinned notices',
        description: 'Maximum unread official notices pinned at the top of the bell.',
        type: 'integer',
        min: 1,
        max: 10,
      },
    ],
  },
  'admin-message': {
    kind: 'admin-message',
    label: 'Direct admin message',
    description: 'One-to-one official message from an admin to a specific reader. Pinned at the top of the bell.',
    area: 'official',
    trigger: 'admin',
    channels: { site: true, email: false },
    siteCategory: null,
    emailCategory: null,
    pinned: true,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: true,
    defaultEmailEnabled: false,
    editableTemplate: false,
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  'word-available': {
    kind: 'word-available',
    label: 'Word first appearance',
    description: 'Notifies a reader when a watched word with zero sentences starts returning results.',
    area: 'words',
    trigger: 'cron',
    schedule: 'Daily 05:30 UTC',
    channels: { site: true, email: true },
    siteCategory: 'words',
    emailCategory: 'words',
    emailFrom: 'noreply',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: true,
    defaultEmailEnabled: true,
    editableTemplate: true,
    copyName: 'word-available',
    defaultSubject: '{{word}} is on Nadeshiko',
    allowedVariables: ['username', 'word'],
    requiredVariables: [],
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  'word-digest': {
    kind: 'word-digest',
    label: 'Weekly word digest',
    description: 'Weekly summary of new sentences for followed words, grouped by title.',
    area: 'words',
    trigger: 'cron',
    schedule: 'Mondays 06:15 UTC',
    channels: { site: true, email: true },
    siteCategory: 'words',
    emailCategory: 'words',
    emailFrom: 'noreply',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: true,
    defaultEmailEnabled: true,
    editableTemplate: true,
    copyName: 'word-digest',
    defaultSubject: 'New sentences for your followed words',
    allowedVariables: ['username'],
    requiredVariables: [],
    paramsSchema: wordDigestParamsSchema,
    defaultParams: { minNewSentences: 3 },
    paramFields: [
      {
        key: 'minNewSentences',
        label: 'Min new sentences',
        description: 'Minimum new sentences since last notice before a word is included in the weekly digest.',
        type: 'integer',
        min: 1,
        max: 100,
      },
    ],
  },
  'request-update': {
    kind: 'request-update',
    label: 'Content request updates',
    description:
      'Notifies voters and boosters when a content request moves to In progress, Released, Declined, or Merged.',
    area: 'community',
    trigger: 'realtime',
    channels: { site: true, email: true },
    siteCategory: 'requests',
    emailCategory: 'requests',
    emailFrom: 'noreply',
    pinned: false,
    groupable: true,
    alwaysEnabled: false,
    defaultSiteEnabled: true,
    defaultEmailEnabled: true,
    editableTemplate: true,
    copyName: 'request-update',
    defaultSubject: '{{title}} — content request update',
    allowedVariables: ['username', 'title', 'votes'],
    requiredVariables: [],
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  'report-resolved': {
    kind: 'report-resolved',
    label: 'Resolved sentence reports',
    description:
      'Notifies a reader in the bell when their reported subtitle/sentence issue is resolved (grouped automatically).',
    area: 'community',
    trigger: 'realtime',
    channels: { site: true, email: false },
    siteCategory: 'reports',
    emailCategory: null,
    pinned: false,
    groupable: true,
    alwaysEnabled: false,
    defaultSiteEnabled: true,
    defaultEmailEnabled: false,
    editableTemplate: false,
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  broadcast: {
    kind: 'broadcast',
    label: 'Broadcast email campaigns',
    description:
      'Custom long-form announcements (such as 3.0.0) sent to opted-in readers or segments from /admin/emails.',
    area: 'official',
    trigger: 'admin',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: 'updates',
    emailFrom: 'hello',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: false,
    allowedVariables: ['username'],
    paramsSchema: broadcastParamsSchema,
    defaultParams: { emailsPerSec: 5, errorCircuitBreakerPct: 5 },
    paramFields: [
      {
        key: 'emailsPerSec',
        label: 'Max emails / second',
        description: 'Rate limit for the broadcast worker so SES send quotas and auth mail stay healthy.',
        type: 'integer',
        min: 1,
        max: 50,
      },
      {
        key: 'errorCircuitBreakerPct',
        label: 'Circuit breaker (%)',
        description: 'Pause a broadcast automatically if failure rate exceeds this % after the first 50 sends.',
        type: 'integer',
        min: 1,
        max: 50,
      },
    ],
  },
  welcome: {
    kind: 'welcome',
    label: 'Welcome email',
    description: 'Sent once right after a new account is created with a quick tour of Nadeshiko.',
    area: 'lifecycle',
    trigger: 'realtime',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: null,
    emailFrom: 'hello',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: true,
    copyName: 'welcome',
    defaultSubject: 'Welcome to Nadeshiko!',
    allowedVariables: ['username', 'senderName', 'scaleSentences', 'scaleTitles', 'scaleHours'],
    requiredVariables: [],
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  'feedback-ask': {
    kind: 'feedback-ask',
    label: 'Day-7 check-in',
    description: 'One-off check-in email sent N days after sign-up asking how Nadeshiko is working out.',
    area: 'lifecycle',
    trigger: 'cron',
    schedule: 'Daily 05:00 UTC',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: 'checkins',
    emailFrom: 'hello',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: true,
    copyName: 'feedback-ask',
    defaultSubject: 'How is Nadeshiko working out?',
    allowedVariables: ['username', 'senderName'],
    requiredVariables: [],
    paramsSchema: feedbackAskParamsSchema,
    defaultParams: { delayDays: 7 },
    paramFields: [
      {
        key: 'delayDays',
        label: 'Days after sign-up',
        description: 'Account age in days before the check-in email fires.',
        type: 'integer',
        min: 1,
        max: 60,
      },
    ],
  },
  'dormant-30': {
    kind: 'dormant-30',
    label: 'Dormant win-back',
    description: 'Win-back email for accounts unseen for N days, showcasing newly added titles.',
    area: 'lifecycle',
    trigger: 'cron',
    schedule: 'Daily 05:00 UTC',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: 'checkins',
    emailFrom: 'hello',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: true,
    copyName: 'dormant-30',
    defaultSubject: 'We have added new titles to Nadeshiko!',
    allowedVariables: ['username', 'senderName', 'newTitles'],
    requiredVariables: [],
    paramsSchema: dormant30ParamsSchema,
    defaultParams: { inactiveDays: 30, dailyCap: 25, cooldownDays: 180 },
    paramFields: [
      {
        key: 'inactiveDays',
        label: 'Inactive days',
        description: 'Days since last activity before an account qualifies.',
        type: 'integer',
        min: 7,
        max: 365,
      },
      {
        key: 'dailyCap',
        label: 'Nightly cap',
        description: 'Maximum win-back emails sent per nightly sweep.',
        type: 'integer',
        min: 1,
        max: 500,
      },
      {
        key: 'cooldownDays',
        label: 'Repeat cooldown (days)',
        description: 'Minimum days before the same account can receive another win-back.',
        type: 'integer',
        min: 14,
        max: 730,
      },
    ],
  },
  feedback: {
    kind: 'feedback',
    label: 'Internal feedback alert',
    description: 'Forwards site feedback submissions to support@ with Reply-To set to the submitter.',
    area: 'transactional',
    trigger: 'realtime',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: null,
    emailFrom: 'noreply',
    pinned: false,
    groupable: false,
    alwaysEnabled: false,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: false,
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  'magic-link': {
    kind: 'magic-link',
    label: 'Sign-in magic link & OTP',
    description: 'Transactional authentication email with sign-in link and one-time code. Locked ON.',
    area: 'transactional',
    trigger: 'realtime',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: null,
    emailFrom: 'noreply',
    pinned: false,
    groupable: false,
    alwaysEnabled: true,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: false,
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
  'verify-new-email': {
    kind: 'verify-new-email',
    label: 'Verify new email address',
    description: 'Transactional confirmation sent when a reader changes their account email. Locked ON.',
    area: 'transactional',
    trigger: 'realtime',
    channels: { site: false, email: true },
    siteCategory: null,
    emailCategory: null,
    emailFrom: 'noreply',
    pinned: false,
    groupable: false,
    alwaysEnabled: true,
    defaultSiteEnabled: false,
    defaultEmailEnabled: true,
    editableTemplate: false,
    paramsSchema: emptySchema,
    defaultParams: {},
    paramFields: [],
  },
};

export const REGISTRY_KINDS = Object.keys(NOTIFICATION_REGISTRY) as RegistryKind[];

export const OFFICIAL_NOTIFICATION_KINDS: readonly NotificationKind[] = ['site-announcement', 'admin-message'];

export function isOfficialNotificationKind(kind: string): boolean {
  return (OFFICIAL_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

export function isRegistryKind(kind: string): kind is RegistryKind {
  return Object.hasOwn(NOTIFICATION_REGISTRY, kind);
}
