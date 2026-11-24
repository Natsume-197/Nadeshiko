import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';
import {
  mdiAccountGroupOutline,
  mdiBullhornOutline,
  mdiHeartOutline,
  mdiOpenInNew,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
} from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

export type AdminCategoryId = 'moderation' | 'community' | 'site';

export interface AdminDirectoryBadge {
  /** Formatted with the reader's locale; ignored when `key` is set. */
  count?: number;
  key?: string;
  tone: 'brand' | 'warning' | 'danger' | 'success' | 'neutral';
}

export interface AdminDirectoryItem {
  id: string;
  category: AdminCategoryId;
  titleKey: string;
  descriptionKey: string;
  icon: string;
  /** Locale-relative app path, or an absolute URL when `external` is set. */
  to: string;
  external?: boolean;
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
    badge: (o) => (o && o.reports.open > 0 ? { count: o.reports.open, tone: 'brand' } : null),
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
        ? { count: o.requests.open, tone: o.requests.boostedOpen > 0 ? 'warning' : 'brand' }
        : null,
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
    badge: (o) => (o ? { count: o.users.total, tone: 'neutral' } : null),
  },
  {
    id: 'patreon',
    category: 'site',
    titleKey: 'adminDashboard.items.patreonTitle',
    descriptionKey: 'adminDashboard.items.patreonDesc',
    icon: mdiHeartOutline,
    to: '/admin/patreon',
    badge: (o) => (o && o.users.activePatrons > 0 ? { count: o.users.activePatrons, tone: 'success' } : null),
  },
  {
    id: 'status-page',
    category: 'site',
    titleKey: 'adminDashboard.items.statusTitle',
    descriptionKey: 'adminDashboard.items.statusDesc',
    icon: mdiOpenInNew,
    to: 'https://status.nadeshiko.co',
    external: true,
  },
];

/** Live counts for the dashboard badges; refetched each time the dashboard mounts. */
export function useAdminOverview() {
  const {
    data: overview,
    status,
    refresh,
  } = useLazyAsyncData(
    'admin-overview',
    async () => {
      try {
        return await useNadeshikoSdk().getAdminOverview();
      } catch (error) {
        handleApiError('admin:overview-fetch-failed', error);
        return null;
      }
    },
    { server: false, default: () => null },
  );

  const isLoading = computed(() => status.value === 'pending');

  return { overview, isLoading, refresh };
}
