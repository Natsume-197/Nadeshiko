import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';
import {
  mdiAccountGroupOutline,
  mdiBullhornOutline,
  mdiChartBar,
  mdiDatabaseCogOutline,
  mdiEmailAlertOutline,
  mdiHeartOutline,
  mdiMessageAlertOutline,
  mdiMovieOpenOutline,
  mdiOpenInNew,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
  mdiTimelineClockOutline,
} from '@mdi/js';
import { handleApiError } from '~/utils/apiError';

export type AdminCategoryId = 'moderation' | 'community' | 'site' | 'catalogue';

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
  status: 'live' | 'planned';
  badge?: (overview: AdminOverview | null) => AdminDirectoryBadge | null;
}

export const ADMIN_CATEGORIES: readonly { id: AdminCategoryId; labelKey: string }[] = [
  { id: 'moderation', labelKey: 'adminDashboard.categories.moderation' },
  { id: 'community', labelKey: 'adminDashboard.categories.community' },
  { id: 'site', labelKey: 'adminDashboard.categories.site' },
  { id: 'catalogue', labelKey: 'adminDashboard.categories.catalogue' },
] as const;

export const ADMIN_DIRECTORY_ITEMS: readonly AdminDirectoryItem[] = [
  // Moderation & quality
  {
    id: 'reports',
    category: 'moderation',
    titleKey: 'accountSettings.tabs.reports',
    descriptionKey: 'adminDashboard.items.reportsDesc',
    icon: mdiShieldCrownOutline,
    to: '/admin/reports',
    status: 'live',
    badge: (o) => (o && o.reports.open > 0 ? { text: `${o.reports.open}`, tone: 'brand' } : null),
  },
  {
    id: 'feedback',
    category: 'moderation',
    titleKey: 'adminDashboard.items.feedbackTitle',
    descriptionKey: 'adminDashboard.items.feedbackDesc',
    icon: mdiMessageAlertOutline,
    status: 'planned',
    badge: (o) => (o && o.feedback.unhandled > 0 ? { text: `${o.feedback.unhandled}`, tone: 'warning' } : null),
  },

  // Community
  {
    id: 'requests',
    category: 'community',
    titleKey: 'requests.admin.tab',
    descriptionKey: 'adminDashboard.items.requestsDesc',
    icon: mdiThumbUpOutline,
    to: '/admin/requests',
    status: 'live',
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
    status: 'live',
  },
  {
    id: 'announcement',
    category: 'community',
    titleKey: 'accountSettings.tabs.announcement',
    descriptionKey: 'adminDashboard.items.announcementDesc',
    icon: mdiBullhornOutline,
    to: '/admin/announcement',
    status: 'live',
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
    status: 'live',
    badge: (o) => (o ? { text: `${o.users.total}`, tone: 'neutral' } : null),
  },
  {
    id: 'patreon',
    category: 'site',
    titleKey: 'adminDashboard.items.patreonTitle',
    descriptionKey: 'adminDashboard.items.patreonDesc',
    icon: mdiHeartOutline,
    to: '/admin/patreon',
    status: 'live',
    badge: (o) => (o && o.users.activePatrons > 0 ? { text: `${o.users.activePatrons}`, tone: 'success' } : null),
  },
  {
    id: 'email-suppressions',
    category: 'site',
    titleKey: 'adminDashboard.items.emailTitle',
    descriptionKey: 'adminDashboard.items.emailDesc',
    icon: mdiEmailAlertOutline,
    status: 'planned',
    badge: (o) => (o && o.email.suppressed > 0 ? { text: `${o.email.suppressed}`, tone: 'warning' } : null),
  },

  // Catalogue & data
  {
    id: 'queues',
    category: 'catalogue',
    titleKey: 'adminDashboard.items.queuesTitle',
    descriptionKey: 'adminDashboard.items.queuesDesc',
    icon: mdiDatabaseCogOutline,
    status: 'planned',
    badge: (o) => {
      if (!o) return null;
      if (o.queues.failed > 0) {
        return { key: 'adminDashboard.status.failedJobs', params: { count: o.queues.failed }, tone: 'danger' };
      }
      if (o.queues.queued + o.queues.active > 0) {
        return { text: `${o.queues.queued + o.queues.active}`, tone: 'neutral' };
      }
      return null;
    },
  },
  {
    id: 'media-catalogue',
    category: 'catalogue',
    titleKey: 'adminDashboard.items.catalogueTitle',
    descriptionKey: 'adminDashboard.items.catalogueDesc',
    icon: mdiMovieOpenOutline,
    to: '/media',
    status: 'live',
    badge: (o) => (o ? { text: `${o.catalogue.media}`, tone: 'neutral' } : null),
  },
  {
    id: 'corpus-stats',
    category: 'catalogue',
    titleKey: 'adminDashboard.items.statsTitle',
    descriptionKey: 'adminDashboard.items.statsDesc',
    icon: mdiChartBar,
    to: '/stats',
    status: 'live',
  },
  {
    id: 'status-page',
    category: 'catalogue',
    titleKey: 'adminDashboard.items.statusTitle',
    descriptionKey: 'adminDashboard.items.statusDesc',
    icon: mdiOpenInNew,
    href: 'https://status.nadeshiko.co',
    status: 'live',
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
