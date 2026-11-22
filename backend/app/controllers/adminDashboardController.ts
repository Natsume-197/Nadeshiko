import type { GetAdminOverview, GetAdminUsersWithProviders } from 'generated/routes/admin';
import type { t_AdminOverview, t_AdminUserWithProviders } from 'generated/models';
import { User, type UserRoleType } from '@app/models';
import { AppDataSource } from '@config/database';
import { Cache, createCacheNamespace } from '@lib/cache';

/** Short-lived cache for the admin launcher badges so rapid tab switches do not repeat aggregate scans. */
export const ADMIN_OVERVIEW_CACHE = createCacheNamespace('adminOverview');
const OVERVIEW_CACHE_TTL_MS = 30_000;

interface QueueCounts {
  queued: number;
  active: number;
  failed: number;
}

async function queryQueueCounts(): Promise<QueueCounts> {
  const [{ rel }] = await User.query(`SELECT to_regclass('pgboss.job') AS rel`);
  if (!rel) return { queued: 0, active: 0, failed: 0 };

  const [row] = await User.query(
    `SELECT
       COUNT(*) FILTER (WHERE state IN ('created', 'retry'))::int AS queued,
       COUNT(*) FILTER (WHERE state = 'active')::int AS active,
       COUNT(*) FILTER (WHERE state = 'failed')::int AS failed
     FROM pgboss.job`,
  );
  return {
    queued: Number(row?.queued ?? 0),
    active: Number(row?.active ?? 0),
    failed: Number(row?.failed ?? 0),
  };
}

export const getAdminOverview: GetAdminOverview = async (_params, respond) => {
  const body = await Cache.getOrCompute<t_AdminOverview>(
    ADMIN_OVERVIEW_CACHE,
    'summary',
    OVERVIEW_CACHE_TTL_MS,
    async () => {
      const [summary] = await User.query(
        `SELECT
           (SELECT COUNT(*)::int FROM "Report" WHERE status = 'OPEN') AS reports_open,
           (SELECT COUNT(*)::int FROM "Report" WHERE status = 'PROCESSING') AS reports_processing,
           (SELECT COUNT(*)::int FROM "ContentRequest" WHERE status = 'OPEN') AS requests_open,
           (SELECT COUNT(*)::int FROM "ContentRequest" WHERE status = 'PLANNED') AS requests_planned,
           (SELECT COUNT(*)::int FROM "ContentRequest" WHERE status = 'IN_PROGRESS') AS requests_in_progress,
           (SELECT COUNT(*)::int FROM "ContentRequest" WHERE status = 'OPEN' AND boost_count > 0) AS requests_boosted_open,
           (SELECT COUNT(*)::int FROM "Feedback" WHERE handled_at IS NULL) AS feedback_unhandled,
           (SELECT COUNT(*)::int FROM "Feedback") AS feedback_total,
           (SELECT COUNT(*)::int FROM "SegmentRevision" WHERE actor = 'AGENT' AND created_at >= NOW() - INTERVAL '24 hours') AS agent_edits_24h,
           (SELECT COUNT(*)::int FROM "User" WHERE is_active = true) AS users_total,
           (SELECT COUNT(*)::int FROM "User" WHERE is_active = true AND created_at >= NOW() - INTERVAL '7 days') AS users_new_7d,
           (SELECT COUNT(*)::int FROM "User" WHERE is_active = true AND banned = true) AS users_banned,
           (SELECT COUNT(*)::int FROM "PatreonConnection" WHERE patron_status = 'active_patron' AND entitled_amount_cents > 0) AS active_patrons,
           (SELECT COUNT(*)::int FROM "Media") AS catalogue_media,
           (SELECT COALESCE(SUM(episode_count), 0)::int FROM "Media") AS catalogue_episodes,
           (SELECT COALESCE(SUM(num_segments), 0)::int FROM "Media") AS catalogue_segments,
           (SELECT COUNT(*)::int FROM "EmailSuppression") AS email_suppressed,
           EXISTS (SELECT 1 FROM "Announcement" WHERE active = true) AS announcement_active`,
      );
      const queues = await queryQueueCounts();

      return {
        reports: {
          open: Number(summary?.reports_open ?? 0),
          processing: Number(summary?.reports_processing ?? 0),
        },
        requests: {
          open: Number(summary?.requests_open ?? 0),
          planned: Number(summary?.requests_planned ?? 0),
          inProgress: Number(summary?.requests_in_progress ?? 0),
          boostedOpen: Number(summary?.requests_boosted_open ?? 0),
        },
        feedback: {
          unhandled: Number(summary?.feedback_unhandled ?? 0),
          total: Number(summary?.feedback_total ?? 0),
        },
        agentActivity: {
          editsLast24h: Number(summary?.agent_edits_24h ?? 0),
        },
        users: {
          total: Number(summary?.users_total ?? 0),
          newLast7d: Number(summary?.users_new_7d ?? 0),
          activePatrons: Number(summary?.active_patrons ?? 0),
          banned: Number(summary?.users_banned ?? 0),
        },
        catalogue: {
          media: Number(summary?.catalogue_media ?? 0),
          episodes: Number(summary?.catalogue_episodes ?? 0),
          segments: Number(summary?.catalogue_segments ?? 0),
        },
        queues,
        email: {
          suppressed: Number(summary?.email_suppressed ?? 0),
        },
        announcement: {
          active: Boolean(summary?.announcement_active),
        },
        generatedAt: new Date().toISOString(),
      };
    },
  );

  return respond.with200().body(body);
};

interface AdminUserRow {
  id: number;
  name: string | null;
  email: string;
  role: UserRoleType;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  providers: string[];
}

function toAdminUserDTO(row: AdminUserRow): t_AdminUserWithProviders {
  return {
    id: row.id,
    name: row.name ?? '',
    email: row.email,
    role: row.role,
    emailVerified: row.emailVerified,
    banned: row.banned,
    banReason: row.banReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.updatedAt ?? row.createdAt).toISOString(),
    providers: row.providers,
  };
}

export const getAdminUsersWithProviders: GetAdminUsersWithProviders = async ({ query }, respond) => {
  const search = query.search?.trim() ?? '';

  const searchCondition = search ? `AND (u.email ILIKE $3 OR u.username ILIKE $3)` : '';
  const params: (string | number)[] = [query.limit, query.offset];
  if (search) params.push(`%${search}%`);

  const rows: AdminUserRow[] = await AppDataSource.query(
    `SELECT
        u.id,
        u.username AS name,
        u.email,
        u.role,
        u.is_verified AS "emailVerified",
        u.banned,
        u.ban_reason AS "banReason",
        u.created_at AS "createdAt",
        u.modified_at AS "updatedAt",
        COALESCE(
          array_agg(DISTINCT a.provider_id) FILTER (WHERE a.provider_id IS NOT NULL),
          ARRAY[]::text[]
        ) AS providers
      FROM "User" u
      LEFT JOIN account a ON a.user_id = u.id
      WHERE u.is_active = true ${searchCondition}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2`,
    params,
  );

  const [{ count }] = await AppDataSource.query(
    `SELECT COUNT(*) AS count FROM "User" u WHERE u.is_active = true ${search ? 'AND (u.email ILIKE $1 OR u.username ILIKE $1)' : ''}`,
    search ? [`%${search}%`] : [],
  );

  return respond.with200().body({
    users: rows.map(toAdminUserDTO),
    total: Number(count),
  });
};
