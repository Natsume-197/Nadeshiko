import type { GetAdminOverview, GetAdminUsersWithProviders } from 'generated/routes/admin';
import type { t_AdminOverview, t_AdminUserWithProviders } from 'generated/models';
import { User, type UserRoleType } from '@app/models';
import { AppDataSource } from '@config/database';
import { Cache, createCacheNamespace } from '@lib/cache';
import { countSendsLast24h } from '@app/services/email/sendLog';

/** Short-lived cache for the admin launcher badges so rapid tab switches do not repeat aggregate scans. */
export const ADMIN_OVERVIEW_CACHE = createCacheNamespace('adminOverview');
const OVERVIEW_CACHE_TTL_MS = 30_000;

export const getAdminOverview: GetAdminOverview = async (_params, respond) => {
  const body = await Cache.getOrCompute<t_AdminOverview>(
    ADMIN_OVERVIEW_CACHE,
    'summary',
    OVERVIEW_CACHE_TTL_MS,
    async () => {
      const [[summary], emails] = await Promise.all([
        User.query(
          `SELECT
           r.reports_open,
           cr.requests_open,
           cr.requests_boosted_open,
           (SELECT COUNT(*)::int FROM "User" WHERE is_active = true) AS users_total,
           (SELECT COUNT(*)::int FROM "PatreonConnection" WHERE patron_status = 'active_patron' AND entitled_amount_cents > 0) AS active_patrons,
           EXISTS (SELECT 1 FROM "Announcement" WHERE active = true) AS announcement_active
         FROM
           (SELECT COUNT(*) FILTER (WHERE status = 'OPEN')::int AS reports_open FROM "Report") r,
           (SELECT
              COUNT(*) FILTER (WHERE status = 'OPEN')::int AS requests_open,
              COUNT(*) FILTER (WHERE status = 'OPEN' AND boost_count > 0)::int AS requests_boosted_open
            FROM "ContentRequest") cr`,
        ),
        countSendsLast24h(),
      ]);

      return {
        reports: { open: Number(summary?.reports_open ?? 0) },
        requests: {
          open: Number(summary?.requests_open ?? 0),
          boostedOpen: Number(summary?.requests_boosted_open ?? 0),
        },
        users: {
          total: Number(summary?.users_total ?? 0),
          activePatrons: Number(summary?.active_patrons ?? 0),
        },
        announcement: { active: Boolean(summary?.announcement_active) },
        emails: { failed: emails.failed, bounced: emails.bounced },
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
