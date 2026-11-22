import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';
import {
  mdiAccountGroupOutline,
  mdiBullhornOutline,
  mdiHeartOutline,
  mdiOpenInNew,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
  mdiTimelineClockOutline,
} from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

export type AdminCategoryId = 'moderation' | 'community' | 'site';

export interface AdminDirectoryBadge {
  text?: string;
  key?: string;
  params?: Record<string, unknown>;
  tone: 'brand' | 'warning' | 'danger' | 'success' | 'neutral';
}

export interface AdminDirectoryItem {
  id: string;
  category: AdminCategoryId;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  to?: string;
  href?: string;
  badge?: (overview: AdminOverview | null) => AdminDirectoryBadge | null;
}

export const ADMIN_CATEGORIES: readonly { id: AdminCategoryId; labelKey: string }[] = [
  { id: 'moderation', labelKey: 'adminDashboard.categories.moderation' },
  { id: 'community', labelKey: 'adminDashboard.categories.community' },
  { id: 'site', labelKey: 'adminDashboard.categories.site' },
] as const;

export const ADMIN_DIRECTORY_ITEMS: readonly AdminDirectoryItem[] = [
  // Moderation
  {
    id: 'reports',
    category: 'moderation',
    titleKey: 'accountSettings.tabs.reports',
    descriptionKey: 'adminDashboard.items.reportsDesc',
    icon: mdiShieldCrownOutline,
    to: '/admin/reports',
    badge: (o) => (o && o.reports.open > 0 ? { text: `${o.reports.open}`, tone: 'brand' } : null),
  },

  // Community
  {
    id: 'requests',
    category: 'community',
    titleKey: 'requests.admin.tab',
    descriptionKey: 'adminDashboard.items.requestsDesc',
    icon: mdiThumbUpOutline,
    to: '/admin/requests',
    badge: (o) =>
      o && o.requests.open > 0
        ? { text: `${o.requests.open}`, tone: o.requests.boostedOpen > 0 ? 'warning' : 'brand' }
        : null,
  },
  {
    id: 'roadmap',
    category: 'community',
    titleKey: 'roadmap.admin.tab',
    descriptionKey: 'adminDashboard.items.roadmapDesc',
    icon: mdiTimelineClockOutline,
    to: '/admin/roadmap',
  },
  {
    id: 'announcement',
    category: 'community',
    titleKey: 'accountSettings.tabs.announcement',
    descriptionKey: 'adminDashboard.items.announcementDesc',
    icon: mdiBullhornOutline,
    to: '/admin/announcement',
    badge: (o) => (o?.announcement.active ? { key: 'adminDashboard.status.bannerActive', tone: 'warning' } : null),
  },

  // Site & users
  {
    id: 'users',
    category: 'site',
    titleKey: 'accountSettings.tabs.users',
    descriptionKey: 'adminDashboard.items.usersDesc',
    icon: mdiAccountGroupOutline,
    to: '/admin/users',
    badge: (o) => (o ? { text: `${o.users.total}`, tone: 'neutral' } : null),
  },
  {
    id: 'patreon',
    category: 'site',
    titleKey: 'adminDashboard.items.patreonTitle',
    descriptionKey: 'adminDashboard.items.patreonDesc',
    icon: mdiHeartOutline,
    to: '/admin/patreon',
    badge: (o) => (o && o.users.activePatrons > 0 ? { text: `${o.users.activePatrons}`, tone: 'success' } : null),
  },
  {
    id: 'status-page',
    category: 'site',
    titleKey: 'adminDashboard.items.statusTitle',
    descriptionKey: 'adminDashboard.items.statusDesc',
    icon: mdiOpenInNew,
    href: 'https://status.nadeshiko.co',
  },
];

export function useAdminOverview() {
  const overview = useState<AdminOverview | null>('admin-overview-data', () => null);
  const isLoading = useState<boolean>('admin-overview-loading', () => false);
  const hasLoaded = useState<boolean>('admin-overview-loaded', () => false);

  async function refresh() {
    if (isLoading.value) return;
    isLoading.value = true;
    try {
      overview.value = await useNadeshikoSdk().getAdminOverview();
      hasLoaded.value = true;
    } catch (error) {
      handleApiError('admin:overview-fetch-failed', error);
    } finally {
      isLoading.value = false;
    }
  }

  async function ensureLoaded() {
    if (!hasLoaded.value && !isLoading.value) {
      await refresh();
    }
  }

  return {
    overview,
    isLoading,
    hasLoaded,
    refresh,
    ensureLoaded,
  };
}
