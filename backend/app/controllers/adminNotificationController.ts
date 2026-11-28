import type { RequestHandler } from 'express';
import type {
  CancelAdminEmailBroadcast,
  CreateAdminEmailBroadcast,
  DeleteAdminEmailBroadcast,
  EstimateAdminEmailBroadcast,
  ListAdminEmailBroadcasts,
  ListAdminNotificationBroadcasts,
  ListAdminNotificationSettings,
  PreviewAdminEmailTemplate,
  SendAdminEmailBroadcast,
  SendAdminNotificationBroadcast,
  TestAdminEmailBroadcast,
  UpdateAdminEmailBroadcast,
  UpdateAdminNotificationSetting,
  UploadAdminEmailAsset,
} from 'generated/routes/admin';
import {
  EmailAsset,
  EmailBroadcast,
  EmailSend,
  Notification,
  NotificationBroadcast,
  type EmailBroadcastAudience,
  type NotificationBroadcastAudience,
  type NotificationBroadcastKind,
} from '@app/models';
import { InvalidRequestError, NotFoundError } from '@app/errors';
import { assertUser } from '@app/middleware/authentication';
import { renderAdminTemplatePreview, sendAdminRawTestEmail } from '@app/mailers/email';
import {
  cancelEmailBroadcast,
  createEmailBroadcast,
  deleteEmailBroadcast,
  estimateEmailBroadcastAudience,
  launchEmailBroadcast,
  sendTestEmailBroadcast,
  toEmailBroadcastJSON,
  updateEmailBroadcast,
} from '@app/services/email/broadcast';
import { createNotificationBroadcast, toNotificationBroadcastJSON } from '@app/services/notifications/broadcast';
import { NOTIFICATION_REGISTRY, REGISTRY_KINDS, isRegistryKind } from '@app/services/notifications/registry';
import {
  getAllNotificationSettings,
  readDefaultCopyMarkdown,
  updateNotificationSetting,
  validateTemplateVariables,
} from '@app/services/notifications/settings';
import type { EmailKind } from '@app/services/email/metrics';

export const listAdminNotificationSettings: ListAdminNotificationSettings = async (_params, respond) => {
  const [resolved, siteRows, emailRows] = await Promise.all([
    getAllNotificationSettings(),
    Notification.query(
      `SELECT kind, COUNT(*)::int AS count FROM "Notification" WHERE created_at >= now() - interval '7 days' GROUP BY kind`,
    ) as Promise<Array<{ kind: string; count: number }>>,
    EmailSend.query(
      `SELECT kind,
              COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE status IN ('failed', 'suppressed'))::int AS failed
       FROM "EmailSend"
       WHERE sent_at >= now() - interval '7 days'
       GROUP BY kind`,
    ) as Promise<Array<{ kind: string; sent: number; failed: number }>>,
  ]);

  const resolvedMap = new Map(resolved.map((r) => [r.kind, r]));
  const siteCounts = new Map(siteRows.map((r) => [r.kind, Number(r.count)]));
  const emailCounts = new Map(emailRows.map((r) => [r.kind, { sent: Number(r.sent), failed: Number(r.failed) }]));

  const items = await Promise.all(
    REGISTRY_KINDS.map(async (kind) => {
      const entry = NOTIFICATION_REGISTRY[kind];
      const setting = resolvedMap.get(kind);
      if (!setting) throw new Error(`Missing resolved setting for ${kind}`);
      let defaultBodyMarkdown: string | null = null;
      if (entry.editableTemplate && entry.copyName) {
        try {
          defaultBodyMarkdown = await readDefaultCopyMarkdown(entry.copyName);
        } catch {
          defaultBodyMarkdown = null;
        }
      }
      const ec = emailCounts.get(kind);
      return {
        kind: entry.kind,
        label: entry.label,
        description: entry.description,
        area: entry.area,
        trigger: entry.trigger,
        schedule: entry.schedule ?? null,
        channels: entry.channels,
        siteCategory: entry.siteCategory,
        emailCategory: entry.emailCategory,
        emailFrom: entry.emailFrom ?? null,
        pinned: entry.pinned,
        groupable: entry.groupable,
        alwaysEnabled: entry.alwaysEnabled,
        siteEnabled: setting.siteEnabled,
        emailEnabled: setting.emailEnabled,
        editableTemplate: entry.editableTemplate,
        defaultSubject: entry.defaultSubject ?? null,
        defaultBodyMarkdown,
        subjectOverride: setting.subjectOverride,
        bodyOverride: setting.bodyOverride,
        allowedVariables: [...(entry.allowedVariables ?? [])],
        requiredVariables: [...(entry.requiredVariables ?? [])],
        params: setting.params,
        defaultParams: entry.defaultParams,
        paramFields: [...entry.paramFields],
        updatedAt: setting.updatedAt ? setting.updatedAt.toISOString() : null,
        stats7d: {
          siteSent: siteCounts.get(kind) ?? 0,
          emailSent: ec?.sent ?? 0,
          emailFailed: ec?.failed ?? 0,
        },
      };
    }),
  );

  return respond.with200().body({ items });
};

export const updateAdminNotificationSetting: UpdateAdminNotificationSetting = async (
  { params, body },
  respond,
  req,
) => {
  const admin = assertUser(req);
  const updated = await updateNotificationSetting(params.kind, body, admin.id);
  return respond.with200().body({
    kind: updated.kind,
    siteEnabled: updated.siteEnabled,
    emailEnabled: updated.emailEnabled,
    params: updated.params,
    subjectOverride: updated.subjectOverride,
    bodyOverride: updated.bodyOverride,
    updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : null,
  });
};

export const previewAdminEmailTemplate: PreviewAdminEmailTemplate = async ({ params, body }, respond) => {
  if (!isRegistryKind(params.kind)) {
    throw new NotFoundError(`Unknown notification kind "${params.kind}".`);
  }
  const entry = NOTIFICATION_REGISTRY[params.kind];
  if (body.subjectOverride?.trim()) validateTemplateVariables(entry, body.subjectOverride);
  if (body.bodyOverride?.trim()) validateTemplateVariables(entry, body.bodyOverride);

  const { subject, html } = await renderAdminTemplatePreview(params.kind, {
    subject: body.subjectOverride,
    body: body.bodyOverride,
    previewText: body.previewText,
    ctaLabel: body.ctaLabel,
    ctaUrl: body.ctaUrl,
  });

  let testSent = false;
  if (body.sendTestTo) {
    await sendAdminRawTestEmail(body.sendTestTo, subject, html, params.kind as EmailKind);
    testSent = true;
  }

  return respond.with200().body({ subject, html, testSent });
};

export const listAdminNotificationBroadcasts: ListAdminNotificationBroadcasts = async ({ query }, respond) => {
  const rows = await NotificationBroadcast.find({
    relations: { targetUser: true },
    order: { createdAt: 'DESC', id: 'DESC' },
    take: query.limit ?? 25,
  });
  return respond.with200().body({ items: rows.map(toNotificationBroadcastJSON) });
};

export const sendAdminNotificationBroadcast: SendAdminNotificationBroadcast = async ({ body }, respond, req) => {
  const admin = assertUser(req);
  const created = await createNotificationBroadcast(
    {
      kind: body.kind as NotificationBroadcastKind,
      audience: body.audience as NotificationBroadcastAudience,
      targetUserId: body.targetUserId ?? null,
      title: body.title,
      message: body.message,
      linkUrl: body.linkUrl ?? null,
      linkLabel: body.linkLabel ?? null,
    },
    admin.id,
  );
  const loaded = await NotificationBroadcast.findOne({
    where: { id: created.id },
    relations: { targetUser: true },
  });
  return respond.with201().body(toNotificationBroadcastJSON(loaded ?? created));
};

export const listAdminEmailBroadcasts: ListAdminEmailBroadcasts = async (_params, respond) => {
  const rows = await EmailBroadcast.find({ order: { createdAt: 'DESC', id: 'DESC' }, take: 50 });
  return respond.with200().body({ items: rows.map(toEmailBroadcastJSON) });
};

export const estimateAdminEmailBroadcast: EstimateAdminEmailBroadcast = async ({ body }, respond) => {
  const recipientCount = await estimateEmailBroadcastAudience(
    body.audience as EmailBroadcastAudience,
    body.audienceParams ?? {},
  );
  return respond.with200().body({ recipientCount });
};

export const createAdminEmailBroadcast: CreateAdminEmailBroadcast = async ({ body }, respond, req) => {
  const admin = assertUser(req);
  const row = await createEmailBroadcast(
    {
      campaignKey: body.campaignKey,
      subject: body.subject,
      previewText: body.previewText ?? null,
      bodyMarkdown: body.bodyMarkdown,
      ctaLabel: body.ctaLabel ?? null,
      ctaUrl: body.ctaUrl ?? null,
      audience: body.audience as EmailBroadcastAudience,
      audienceParams: body.audienceParams ?? {},
    },
    admin.id,
  );
  return respond.with201().body(toEmailBroadcastJSON(row));
};

export const updateAdminEmailBroadcast: UpdateAdminEmailBroadcast = async ({ params, body }, respond) => {
  const row = await updateEmailBroadcast(params.broadcastId, {
    ...(body.campaignKey !== undefined ? { campaignKey: body.campaignKey } : {}),
    ...(body.subject !== undefined ? { subject: body.subject } : {}),
    ...(body.previewText !== undefined ? { previewText: body.previewText } : {}),
    ...(body.bodyMarkdown !== undefined ? { bodyMarkdown: body.bodyMarkdown } : {}),
    ...(body.ctaLabel !== undefined ? { ctaLabel: body.ctaLabel } : {}),
    ...(body.ctaUrl !== undefined ? { ctaUrl: body.ctaUrl } : {}),
    ...(body.audience !== undefined ? { audience: body.audience as EmailBroadcastAudience } : {}),
    ...(body.audienceParams !== undefined ? { audienceParams: body.audienceParams } : {}),
  });
  return respond.with200().body(toEmailBroadcastJSON(row));
};

export const deleteAdminEmailBroadcast: DeleteAdminEmailBroadcast = async ({ params }, respond) => {
  await deleteEmailBroadcast(params.broadcastId);
  return respond.with204().body();
};

export const testAdminEmailBroadcast: TestAdminEmailBroadcast = async ({ params, body }, respond, req) => {
  const admin = assertUser(req);
  const toEmail = body?.toEmail?.trim() || admin.email;
  await sendTestEmailBroadcast(params.broadcastId, toEmail);
  return respond.with204().body();
};

export const sendAdminEmailBroadcast: SendAdminEmailBroadcast = async ({ params }, respond) => {
  const row = await launchEmailBroadcast(params.broadcastId);
  return respond.with200().body(toEmailBroadcastJSON(row));
};

export const cancelAdminEmailBroadcast: CancelAdminEmailBroadcast = async ({ params }, respond) => {
  const row = await cancelEmailBroadcast(params.broadcastId);
  return respond.with200().body(toEmailBroadcastJSON(row));
};

const ALLOWED_ASSET_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uploadAdminEmailAsset: UploadAdminEmailAsset = async ({ body }, respond, req) => {
  const admin = assertUser(req);
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl.trim());
  if (!match?.[1] || !match[2]) {
    throw new InvalidRequestError('Expected a base64 image data URL.');
  }
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_ASSET_MIME.has(mimeType)) {
    throw new InvalidRequestError('Unsupported image format. Use PNG, JPEG, WebP, or GIF.');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_ASSET_BYTES) {
    throw new InvalidRequestError('Image must be between 1 byte and 2 MB.');
  }
  const asset = await EmailAsset.create({
    mimeType,
    data: buffer,
    byteSize: buffer.byteLength,
    createdBy: admin.id,
  }).save();

  return respond.with201().body({
    id: asset.publicId,
    url: `/v1/email/assets/${asset.publicId}`,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
  });
};

export const serveEmailAsset: RequestHandler = async (req, res) => {
  const assetId = String(req.params.assetId ?? '');
  if (!UUID_RE.test(assetId)) {
    res.status(404).end();
    return;
  }
  const asset = await EmailAsset.findOneBy({ publicId: assetId });
  if (!asset) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Length', String(asset.byteSize));
  res.send(asset.data);
};
