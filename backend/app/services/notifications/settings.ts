import fs from 'fs';
import path from 'path';
import { NotificationSetting } from '@app/models';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import {
  NOTIFICATION_REGISTRY,
  REGISTRY_KINDS,
  isRegistryKind,
  type RegistryEntry,
  type RegistryKind,
} from './registry';

/**
 * Runtime configuration resolver for `notificationRegistry` (tasks 52 Phase 2 & 55).
 * Reads overrides from `NotificationSetting` with a short in-memory TTL cache so hot paths never hit Postgres.
 */

export interface ResolvedNotificationSetting {
  kind: RegistryKind;
  siteEnabled: boolean;
  emailEnabled: boolean;
  params: Record<string, unknown>;
  subjectOverride: string | null;
  bodyOverride: string | null;
  updatedAt: Date | null;
  updatedBy: number | null;
}

const CACHE_TTL_MS = 30_000;
let cachedRows: Map<string, NotificationSetting> | null = null;
let cachedAt = 0;

export function invalidateNotificationSettingsCache(): void {
  cachedRows = null;
  cachedAt = 0;
}

async function loadAllRows(): Promise<Map<string, NotificationSetting>> {
  if (cachedRows && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedRows;
  }
  try {
    const rows = await NotificationSetting.find();
    cachedRows = new Map(rows.map((r) => [r.kind, r]));
    cachedAt = Date.now();
    return cachedRows;
  } catch {
    // If tests run without the table or during a transient DB blip, fall back to code defaults cleanly.
    return new Map();
  }
}

function resolveFromRow(entry: RegistryEntry, row: NotificationSetting | undefined): ResolvedNotificationSetting {
  const siteEnabled = entry.channels.site
    ? entry.alwaysEnabled
      ? true
      : (row?.siteEnabled ?? entry.defaultSiteEnabled)
    : false;
  const emailEnabled = entry.channels.email
    ? entry.alwaysEnabled
      ? true
      : (row?.emailEnabled ?? entry.defaultEmailEnabled)
    : false;

  const mergedParams = { ...entry.defaultParams, ...(row?.params ?? {}) };
  const parsed = entry.paramsSchema.safeParse(mergedParams);
  const params = parsed.success ? (parsed.data as Record<string, unknown>) : { ...entry.defaultParams };

  return {
    kind: entry.kind,
    siteEnabled,
    emailEnabled,
    params,
    subjectOverride: entry.editableTemplate ? (row?.subjectOverride ?? null) : null,
    bodyOverride: entry.editableTemplate ? (row?.bodyOverride ?? null) : null,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function getNotificationSetting(kind: RegistryKind): Promise<ResolvedNotificationSetting> {
  const entry = NOTIFICATION_REGISTRY[kind];
  const rows = await loadAllRows();
  return resolveFromRow(entry, rows.get(kind));
}

export async function getAllNotificationSettings(): Promise<ResolvedNotificationSetting[]> {
  const rows = await loadAllRows();
  return REGISTRY_KINDS.map((kind) => resolveFromRow(NOTIFICATION_REGISTRY[kind], rows.get(kind)));
}

export async function isChannelEnabled(kind: RegistryKind, channel: 'site' | 'email'): Promise<boolean> {
  const entry = NOTIFICATION_REGISTRY[kind];
  if (entry.alwaysEnabled) return channel === 'site' ? entry.channels.site : entry.channels.email;
  const resolved = await getNotificationSetting(kind);
  return channel === 'site' ? resolved.siteEnabled : resolved.emailEnabled;
}

export async function getNotificationParams<T extends Record<string, unknown>>(kind: RegistryKind): Promise<T> {
  const resolved = await getNotificationSetting(kind);
  return resolved.params as T;
}

/** Extract `{{varName}}` placeholders from a template override (ignoring conditional `{{#x}}`/`{{/x}}` and `{{{raw}}}`). */
export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\{\{([a-zA-Z0-9_.]+)\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function validateTemplateVariables(entry: RegistryEntry, text: string): void {
  const allowed = new Set(entry.allowedVariables ?? []);
  const used = extractPlaceholders(text);
  const unknown = used.filter((v) => !allowed.has(v));
  if (unknown.length > 0) {
    throw new InvalidRequestError(
      `Unknown template variable(s): ${unknown.map((v) => `{{${v}}}`).join(', ')}. Allowed: ${
        allowed.size > 0 ? [...allowed].map((v) => `{{${v}}}`).join(', ') : 'none'
      }.`,
    );
  }
  for (const req of entry.requiredVariables ?? []) {
    if (!used.includes(req)) {
      throw new InvalidRequestError(`Required template variable {{${req}}} cannot be removed.`);
    }
  }
}

export async function readDefaultCopyMarkdown(copyName: string): Promise<string> {
  const file = path.join(import.meta.dirname, '..', '..', 'mailers', 'copy', `${copyName}.md`);
  return fs.promises.readFile(file, 'utf-8');
}

export interface UpdateNotificationSettingInput {
  siteEnabled?: boolean;
  emailEnabled?: boolean;
  params?: Record<string, unknown>;
  subjectOverride?: string | null;
  bodyOverride?: string | null;
  resetParams?: boolean;
  resetTemplate?: boolean;
}

export async function updateNotificationSetting(
  kind: string,
  input: UpdateNotificationSettingInput,
  adminUserId: number,
): Promise<ResolvedNotificationSetting> {
  if (!isRegistryKind(kind)) {
    throw new NotFoundError(`Unknown notification kind "${kind}".`);
  }
  const entry = NOTIFICATION_REGISTRY[kind];

  if (entry.alwaysEnabled && (input.siteEnabled === false || input.emailEnabled === false)) {
    throw new InvalidRequestError(`"${kind}" is transactional and cannot be disabled.`);
  }

  let row = await NotificationSetting.findOneBy({ kind });
  if (!row) {
    row = NotificationSetting.create({
      kind,
      siteEnabled: entry.defaultSiteEnabled,
      emailEnabled: entry.defaultEmailEnabled,
      params: {},
      subjectOverride: null,
      bodyOverride: null,
    });
  }

  if (input.siteEnabled !== undefined && entry.channels.site) {
    row.siteEnabled = entry.alwaysEnabled ? true : input.siteEnabled;
  }
  if (input.emailEnabled !== undefined && entry.channels.email) {
    row.emailEnabled = entry.alwaysEnabled ? true : input.emailEnabled;
  }

  if (input.resetParams) {
    row.params = {};
  } else if (input.params !== undefined) {
    const merged = { ...entry.defaultParams, ...row.params, ...input.params };
    const parsed = entry.paramsSchema.safeParse(merged);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new InvalidRequestError(`Invalid parameters: ${msg}`);
    }
    row.params = parsed.data as Record<string, unknown>;
  }

  if (input.resetTemplate) {
    row.subjectOverride = null;
    row.bodyOverride = null;
  } else {
    if (input.subjectOverride !== undefined) {
      if (!entry.editableTemplate) {
        throw new InvalidRequestError(`Template editing is not enabled for "${kind}".`);
      }
      const trimmed = input.subjectOverride?.trim() || null;
      if (trimmed) validateTemplateVariables(entry, trimmed);
      row.subjectOverride = trimmed;
    }
    if (input.bodyOverride !== undefined) {
      if (!entry.editableTemplate) {
        throw new InvalidRequestError(`Template editing is not enabled for "${kind}".`);
      }
      const trimmed = input.bodyOverride?.trim() || null;
      if (trimmed) validateTemplateVariables(entry, trimmed);
      row.bodyOverride = trimmed;
    }
  }

  row.updatedBy = adminUserId;
  row.updatedAt = new Date();
  await row.save();
  invalidateNotificationSettingsCache();

  return resolveFromRow(entry, row);
}
