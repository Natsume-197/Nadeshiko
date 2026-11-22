import { config } from '@config/config';
import { logger } from '@config/log';
import { Cache, createCacheNamespace } from '@lib/cache';

/** Cache campaign members for 5 minutes so opening `/admin/patreon` does not hammer Patreon's rate limit. */
export const PATREON_CAMPAIGN_CACHE = createCacheNamespace('patreonCampaignMembers');
const CAMPAIGN_CACHE_TTL_MS = 5 * 60_000;
const MAX_PAGES = 10;

interface PatreonResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string; type: string } | Array<{ id: string; type: string }> | null }>;
}

interface CampaignMembersApiResponse {
  data?: PatreonResource[];
  included?: PatreonResource[];
  links?: { next?: string };
}

export interface CampaignMemberRecord {
  memberId: string;
  patreonUserId: string | null;
  fullName: string;
  email: string | null;
  patronStatus: string | null;
  entitledAmountCents: number;
  monthlyAmountCents: number;
  lifetimeSupportCents: number;
  pledgeStart: string | null;
  lastChargeStatus: string | null;
  lastChargeDate: string | null;
  entitledTierIds: string[];
  patreonTierTitles: string[];
}

export type CampaignFetchStatus = 'ok' | 'unconfigured' | 'unauthorized' | 'error';

export interface CampaignMembersSnapshot {
  configured: boolean;
  status: CampaignFetchStatus;
  errorMessage: string | null;
  fetchedAt: string | null;
  members: CampaignMemberRecord[];
}

export function isPatreonCreatorConfigured(): boolean {
  return Boolean(config.PATREON_CREATOR_ACCESS_TOKEN && config.PATREON_CAMPAIGN_ID);
}

function buildMembersUrl(campaignId: string): string {
  const url = new URL(`https://www.patreon.com/api/oauth2/v2/campaigns/${encodeURIComponent(campaignId)}/members`);
  url.searchParams.set('include', 'currently_entitled_tiers,user');
  url.searchParams.set(
    'fields[member]',
    'full_name,email,patron_status,currently_entitled_amount_cents,campaign_lifetime_support_cents,lifetime_support_cents,pledge_relationship_start,last_charge_status,last_charge_date',
  );
  url.searchParams.set('fields[tier]', 'title,amount_cents');
  url.searchParams.set('fields[user]', 'full_name');
  url.searchParams.set('page[count]', '500');
  return url.toString();
}

function parseMember(
  item: PatreonResource,
  tierTitlesById: Map<string, string>,
  tierAmountsById: Map<string, number>,
  userNamesById: Map<string, string>,
): CampaignMemberRecord {
  const attrs = item.attributes ?? {};
  const userRel = item.relationships?.user?.data;
  const patreonUserId = userRel && !Array.isArray(userRel) ? userRel.id : null;
  const tiersRel = item.relationships?.currently_entitled_tiers?.data;
  const entitledTierIds = Array.isArray(tiersRel) ? tiersRel.filter((t) => t.type === 'tier').map((t) => t.id) : [];
  const patreonTierTitles = entitledTierIds
    .map((id) => tierTitlesById.get(id))
    .filter((title): title is string => Boolean(title));

  const memberName = typeof attrs.full_name === 'string' && attrs.full_name.trim() ? attrs.full_name.trim() : null;
  const userName = patreonUserId ? (userNamesById.get(patreonUserId) ?? null) : null;
  const patronStatus = typeof attrs.patron_status === 'string' ? attrs.patron_status : null;
  const entitledAmountCents =
    typeof attrs.currently_entitled_amount_cents === 'number' ? attrs.currently_entitled_amount_cents : 0;
  // Prefer the Patreon tier's USD list price so Apple iOS's +43% IAP markup does not inflate monthly revenue.
  // Fall back to `entitledAmountCents` for active custom pledges that are not attached to a paid tier.
  const tierAmountCents = entitledTierIds.reduce((max, id) => Math.max(max, tierAmountsById.get(id) ?? 0), 0);
  const monthlyAmountCents =
    patronStatus === 'active_patron' ? (tierAmountCents > 0 ? tierAmountCents : entitledAmountCents) : 0;

  return {
    memberId: item.id,
    patreonUserId,
    fullName: memberName ?? userName ?? '—',
    email: typeof attrs.email === 'string' && attrs.email.trim() ? attrs.email.trim() : null,
    patronStatus,
    entitledAmountCents,
    monthlyAmountCents,
    lifetimeSupportCents:
      typeof attrs.campaign_lifetime_support_cents === 'number'
        ? attrs.campaign_lifetime_support_cents
        : typeof attrs.lifetime_support_cents === 'number'
          ? attrs.lifetime_support_cents
          : 0,
    pledgeStart: typeof attrs.pledge_relationship_start === 'string' ? attrs.pledge_relationship_start : null,
    lastChargeStatus: typeof attrs.last_charge_status === 'string' ? attrs.last_charge_status : null,
    lastChargeDate: typeof attrs.last_charge_date === 'string' ? attrs.last_charge_date : null,
    entitledTierIds,
    patreonTierTitles,
  };
}

/**
 * Fetches all campaign members directly from Patreon's Creator API.
 * Failures degrade gracefully into a typed status rather than breaking `/admin/patreon`.
 */
export async function fetchCampaignMembers(force = false): Promise<CampaignMembersSnapshot> {
  if (!isPatreonCreatorConfigured()) {
    return {
      configured: false,
      status: 'unconfigured',
      errorMessage: null,
      fetchedAt: null,
      members: [],
    };
  }

  if (force) {
    Cache.invalidate(PATREON_CAMPAIGN_CACHE);
  } else {
    const cached = Cache.get<CampaignMembersSnapshot>(PATREON_CAMPAIGN_CACHE, 'members');
    if (cached) return cached;
  }

  const tierTitlesById = new Map<string, string>();
  const tierAmountsById = new Map<string, number>();
  const userNamesById = new Map<string, string>();
  const rawMembers: PatreonResource[] = [];

  let nextUrl: string | undefined = buildMembersUrl(config.PATREON_CAMPAIGN_ID);
  let pages = 0;

  try {
    while (nextUrl && pages < MAX_PAGES) {
      pages += 1;
      const response = await fetch(nextUrl, {
        headers: { authorization: `Bearer ${config.PATREON_CREATOR_ACCESS_TOKEN}` },
      });

      if (response.status === 401 || response.status === 403) {
        logger.warn({ status: response.status }, 'Patreon Creator Access Token rejected by Patreon API');
        return {
          configured: true,
          status: 'unauthorized',
          errorMessage: `Patreon API returned HTTP ${response.status}. Renew PATREON_CREATOR_ACCESS_TOKEN.`,
          fetchedAt: null,
          members: [],
        };
      }

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Patreon campaign members request failed');
        return {
          configured: true,
          status: 'error',
          errorMessage: `Patreon API returned HTTP ${response.status}.`,
          fetchedAt: null,
          members: [],
        };
      }

      const payload = (await response.json()) as CampaignMembersApiResponse;
      for (const inc of payload.included ?? []) {
        if (inc.type === 'tier') {
          if (typeof inc.attributes?.title === 'string') {
            tierTitlesById.set(inc.id, inc.attributes.title);
          }
          if (typeof inc.attributes?.amount_cents === 'number') {
            tierAmountsById.set(inc.id, inc.attributes.amount_cents);
          }
        } else if (inc.type === 'user' && typeof inc.attributes?.full_name === 'string') {
          userNamesById.set(inc.id, inc.attributes.full_name);
        }
      }
      if (Array.isArray(payload.data)) {
        rawMembers.push(...payload.data);
      }

      nextUrl = typeof payload.links?.next === 'string' && payload.links.next ? payload.links.next : undefined;
    }
  } catch (err) {
    logger.warn({ err }, 'Could not reach Patreon API for campaign members');
    return {
      configured: true,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Network error calling Patreon API.',
      fetchedAt: null,
      members: [],
    };
  }

  const members = rawMembers.map((item) => parseMember(item, tierTitlesById, tierAmountsById, userNamesById));
  // Active patrons first, then declined, then former, sorted by highest monthly amount / lifetime support / newest start.
  const statusRank = (s: string | null) =>
    s === 'active_patron' ? 0 : s === 'declined_patron' ? 1 : s === 'former_patron' ? 2 : 3;
  members.sort((a, b) => {
    const rankDiff = statusRank(a.patronStatus) - statusRank(b.patronStatus);
    if (rankDiff !== 0) return rankDiff;
    if (b.monthlyAmountCents !== a.monthlyAmountCents) return b.monthlyAmountCents - a.monthlyAmountCents;
    if (b.lifetimeSupportCents !== a.lifetimeSupportCents) return b.lifetimeSupportCents - a.lifetimeSupportCents;
    return (b.pledgeStart ?? '').localeCompare(a.pledgeStart ?? '');
  });

  const snapshot: CampaignMembersSnapshot = {
    configured: true,
    status: 'ok',
    errorMessage: null,
    fetchedAt: new Date().toISOString(),
    members,
  };
  Cache.set(PATREON_CAMPAIGN_CACHE, 'members', snapshot, CAMPAIGN_CACHE_TTL_MS);
  return snapshot;
}
