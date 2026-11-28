<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core';
import {
  mdiAccountGroupOutline,
  mdiBellOutline,
  mdiBullhornOutline,
  mdiClose,
  mdiDockLeft,
  mdiEmailOutline,
  mdiHeartOutline,
  mdiHomeOutline,
  mdiMagnify,
  mdiMenu,
  mdiOpenInNew,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
} from '@mdi/js';
import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';
import { splitLocalePrefix } from '~/utils/routes';

type RailSectionId = 'home' | 'moderation' | 'communication' | 'people';

interface NavPageItem {
  id: string;
  label: string;
  to: string;
  icon: string;
  badge?: (o: AdminOverview | null) => { text: string; tone?: 'brand' | 'warning' | 'danger' | 'success' } | null;
}

interface RailSection {
  id: RailSectionId;
  label: string;
  icon: string;
  defaultTo: string;
  matchPrefixes: string[];
  items: NavPageItem[];
}

const { t } = useI18n();
const { formatNumber } = useFormat();
const localePath = useLocalePath();
const route = useRoute();
const router = useRouter();
const store = userStore();

const { overview } = useAdminOverview();

const sidebarOpen = ref(true);
const mobileNavOpen = ref(false);
const commandOpen = ref(false);
const commandQuery = ref('');
const commandInput = ref<HTMLInputElement | null>(null);

const normalizedPath = computed(() => {
  const { localizedPath } = splitLocalePrefix(route.path);
  return localizedPath.replace(/\/+$/, '') || '/';
});

const sections = computed<RailSection[]>(() => [
  {
    id: 'home',
    label: 'Home',
    icon: mdiHomeOutline,
    defaultTo: '/admin',
    matchPrefixes: ['/admin'],
    items: [{ id: 'overview', label: t('adminDashboard.title'), to: '/admin', icon: mdiHomeOutline }],
  },
  {
    id: 'moderation',
    label: 'Moderation',
    icon: mdiShieldCrownOutline,
    defaultTo: '/admin/reports',
    matchPrefixes: ['/admin/reports', '/admin/requests'],
    items: [
      {
        id: 'reports',
        label: t('accountSettings.tabs.reports'),
        to: '/admin/reports',
        icon: mdiShieldCrownOutline,
        badge: (o) => (o && o.reports.open > 0 ? { text: formatNumber(o.reports.open), tone: 'brand' } : null),
      },
      {
        id: 'requests',
        label: t('requests.admin.tab'),
        to: '/admin/requests',
        icon: mdiThumbUpOutline,
        badge: (o) =>
          o && o.requests.open > 0
            ? { text: formatNumber(o.requests.open), tone: o.requests.boostedOpen > 0 ? 'warning' : 'brand' }
            : null,
      },
    ],
  },
  {
    id: 'communication',
    label: 'Comms',
    icon: mdiBellOutline,
    defaultTo: '/admin/notifications',
    matchPrefixes: ['/admin/notifications', '/admin/emails', '/admin/announcement'],
    items: [
      {
        id: 'notifications',
        label: t('adminNotifications.title'),
        to: '/admin/notifications',
        icon: mdiBellOutline,
      },
      {
        id: 'emails',
        label: t('adminEmails.title'),
        to: '/admin/emails',
        icon: mdiEmailOutline,
        badge: (o) => {
          const p = (o?.emails?.failed ?? 0) + (o?.emails?.bounced ?? 0);
          return p > 0 ? { text: formatNumber(p), tone: o?.emails?.failed ? 'danger' : 'warning' } : null;
        },
      },
      {
        id: 'announcement',
        label: t('accountSettings.tabs.announcement'),
        to: '/admin/announcement',
        icon: mdiBullhornOutline,
        badge: (o) => (o?.announcement.active ? { text: 'ON', tone: 'warning' } : null),
      },
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: mdiAccountGroupOutline,
    defaultTo: '/admin/users',
    matchPrefixes: ['/admin/users', '/admin/patreon'],
    items: [
      {
        id: 'users',
        label: t('accountSettings.tabs.users'),
        to: '/admin/users',
        icon: mdiAccountGroupOutline,
        badge: (o) => (o ? { text: formatNumber(o.users.total) } : null),
      },
      {
        id: 'patreon',
        label: t('adminDashboard.items.patreonTitle'),
        to: '/admin/patreon',
        icon: mdiHeartOutline,
        badge: (o) =>
          o && o.users.activePatrons > 0 ? { text: formatNumber(o.users.activePatrons), tone: 'success' } : null,
      },
    ],
  },
]);

const activeSection = computed<RailSection>(() => {
  const p = normalizedPath.value;
  const fallback = sections.value[0] as RailSection;
  if (p === '/admin') return fallback;
  return (
    sections.value.find(
      (s) => s.id !== 'home' && s.matchPrefixes.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)),
    ) ?? fallback
  );
});

const allCommandItems = computed(() => {
  const list: Array<NavPageItem & { sectionLabel: string }> = [];
  for (const sec of sections.value) {
    for (const item of sec.items) {
      list.push({ ...item, sectionLabel: sec.label });
    }
  }
  const q = commandQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (item) => item.label.toLowerCase().includes(q) || item.sectionLabel.toLowerCase().includes(q),
  );
});

const currentPageLabel = computed(() => {
  const match = activeSection.value.items.find((i) => isItemActive(i));
  return match?.label ?? activeSection.value.label;
});

function isItemActive(item: NavPageItem): boolean {
  if (item.to === '/admin') return normalizedPath.value === '/admin';
  return normalizedPath.value === item.to || normalizedPath.value.startsWith(`${item.to}/`);
}

function badgeClass(tone?: 'brand' | 'warning' | 'danger' | 'success'): string {
  switch (tone) {
    case 'brand':
      return 'bg-brand/15 text-brand';
    case 'warning':
      return 'bg-amber-500/15 text-amber-300';
    case 'danger':
      return 'bg-red-500/15 text-red-300';
    case 'success':
      return 'bg-emerald-500/15 text-emerald-300';
    default:
      return 'text-ink-faint';
  }
}

function goTo(item: NavPageItem) {
  commandOpen.value = false;
  mobileNavOpen.value = false;
  void router.push(localePath(item.to));
}

function openCommand() {
  commandQuery.value = '';
  commandOpen.value = true;
  nextTick(() => commandInput.value?.focus());
}

onKeyStroke('k', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    if (commandOpen.value) commandOpen.value = false;
    else openCommand();
  }
});

watch(
  () => route.fullPath,
  () => {
    mobileNavOpen.value = false;
  },
);
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-background text-ink">
    <LayoutImpersonationBanner />

    <!-- PostHog-style compact top bar -->
    <header class="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-3">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink lg:hidden"
          aria-label="Toggle navigation"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <UiBaseIcon :path="mdiMenu" :size="18" />
        </button>

        <NuxtLink
          :to="localePath('/admin')"
          class="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-surface-hover"
        >
          <span class="flex size-5 items-center justify-center rounded bg-brand-solid text-[11px] font-bold text-white">
            N
          </span>
          <span class="hidden sm:inline">Nadeshiko</span>
        </NuxtLink>

        <span class="text-xs text-ink-faint">/</span>
        <span class="truncate text-xs font-medium text-ink-muted">{{ currentPageLabel }}</span>
      </div>

      <!-- Center Ctrl+K quick jump -->
      <button
        type="button"
        class="hidden h-7 w-full max-w-md items-center justify-between gap-2 rounded-md border border-hairline bg-background/80 px-2.5 text-xs text-ink-faint transition-colors hover:border-line-hover hover:text-ink-muted sm:flex"
        @click="openCommand"
      >
        <span class="flex items-center gap-1.5">
          <UiBaseIcon :path="mdiMagnify" :size="14" />
          <span>Jump to…</span>
        </span>
        <kbd class="rounded border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
          Ctrl+K
        </kbd>
      </button>

      <!-- Right utilities -->
      <div class="flex shrink-0 items-center gap-2">
        <span v-if="store.userName" class="hidden text-xs font-medium text-ink-faint md:inline">
          {{ store.userName }}
        </span>
        <NuxtLink
          :to="localePath('/')"
          class="inline-flex h-7 items-center gap-1 rounded-md border border-hairline px-2 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <span>Site</span>
          <UiBaseIcon :path="mdiOpenInNew" :size="12" />
        </NuxtLink>
      </div>
    </header>

    <!-- Dual-rail PostHog layout: Icon Rail (domains) + Secondary Sidebar (pages in domain) + Main Canvas -->
    <div class="relative flex min-h-0 flex-1 overflow-hidden">
      <!-- Primary Icon Rail -->
      <aside class="hidden w-[62px] shrink-0 flex-col items-center justify-between border-r border-hairline bg-surface py-2 lg:flex">
        <nav class="flex w-full flex-col items-center gap-1 px-1.5">
          <NuxtLink
            v-for="sec in sections"
            :key="sec.id"
            :to="localePath(sec.defaultTo)"
            class="flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors"
            :class="
              activeSection.id === sec.id
                ? 'bg-brand/15 text-brand'
                : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
            "
          >
            <UiBaseIcon :path="sec.icon" :size="19" />
            <span class="truncate">{{ sec.label }}</span>
          </NuxtLink>
        </nav>

        <div class="flex w-full flex-col items-center gap-1 px-1.5">
          <a
            href="https://status.nadeshiko.co"
            target="_blank"
            rel="noopener noreferrer"
            title="Status page"
            class="flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <UiBaseIcon :path="mdiOpenInNew" :size="16" />
            <span>Status</span>
          </a>
          <button
            v-if="activeSection.items.length > 1"
            type="button"
            :title="sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'"
            class="inline-flex size-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            @click="sidebarOpen = !sidebarOpen"
          >
            <UiBaseIcon :path="mdiDockLeft" :size="17" />
          </button>
        </div>
      </aside>

      <!-- Secondary Contextual Sidebar (shown when section has >1 page; 1 item = 1 page, zero tab duplication) -->
      <aside
        v-if="sidebarOpen && activeSection.items.length > 1"
        class="hidden w-52 shrink-0 flex-col border-r border-hairline bg-card-background/60 lg:flex"
      >
        <div class="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5 text-xs font-semibold text-ink">
          <UiBaseIcon :path="activeSection.icon" :size="15" class="text-brand" />
          <span>{{ activeSection.label }}</span>
        </div>

        <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          <NuxtLink
            v-for="item in activeSection.items"
            :key="item.id"
            :to="localePath(item.to)"
            class="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors"
            :class="
              isItemActive(item)
                ? 'bg-brand/15 font-semibold text-brand'
                : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
            "
          >
            <span class="flex min-w-0 items-center gap-2">
              <UiBaseIcon :path="item.icon" :size="15" class="shrink-0" />
              <span class="truncate">{{ item.label }}</span>
            </span>
            <span
              v-if="item.badge?.(overview)"
              class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              :class="badgeClass(item.badge?.(overview)?.tone)"
            >
              {{ item.badge?.(overview)?.text }}
            </span>
          </NuxtLink>
        </nav>
      </aside>

      <!-- Mobile nav drawer -->
      <CommonBaseModal
        :open="mobileNavOpen"
        transition="nd-drawer"
        labelledby="admin-mobile-nav-title"
        overlay-class="items-stretch justify-start bg-fixed-scrim/60 lg:hidden"
        panel-class="flex h-full w-64 flex-col overflow-y-auto border-r border-hairline bg-background"
        @close="mobileNavOpen = false"
      >
        <div class="nd-modal-header">
          <span id="admin-mobile-nav-title" class="text-sm font-bold text-ink">Nadeshiko Admin</span>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint hover:text-ink"
            @click="mobileNavOpen = false"
          >
            <UiBaseIcon :path="mdiClose" :size="16" />
          </button>
        </div>
        <div class="space-y-4 p-3">
          <div v-for="sec in sections" :key="sec.id" class="space-y-1">
            <div class="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {{ sec.label }}
            </div>
            <NuxtLink
              v-for="item in sec.items"
              :key="item.id"
              :to="localePath(item.to)"
              class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <UiBaseIcon :path="item.icon" :size="15" />
              <span class="truncate">{{ item.label }}</span>
            </NuxtLink>
          </div>
        </div>
      </CommonBaseModal>

      <!-- Main canvas -->
      <main class="min-w-0 flex-1 overflow-y-auto bg-background">
        <div class="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>

    <!-- Ctrl+K Command Palette -->
    <CommonBaseModal
      :open="commandOpen"
      labelledby="admin-command-palette-title"
      overlay-class="items-start justify-center bg-fixed-scrim/60 px-4 pt-20"
      panel-class="w-full max-w-md overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="commandOpen = false"
    >
      <div class="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <UiBaseIcon :path="mdiMagnify" :size="16" class="text-ink-faint" />
        <input
          id="admin-command-palette-title"
          ref="commandInput"
          v-model="commandQuery"
          type="search"
          placeholder="Jump to…"
          class="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          @keydown.enter="allCommandItems[0] && goTo(allCommandItems[0])"
        />
        <button type="button" class="text-ink-faint hover:text-ink" @click="commandOpen = false">
          <UiBaseIcon :path="mdiClose" :size="16" />
        </button>
      </div>
      <div class="max-h-72 overflow-y-auto p-1.5">
        <div v-if="allCommandItems.length === 0" class="px-3 py-6 text-center text-xs text-ink-faint">
          No matching pages
        </div>
        <button
          v-for="item in allCommandItems"
          :key="item.id"
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          @click="goTo(item)"
        >
          <span class="flex items-center gap-2.5">
            <UiBaseIcon :path="item.icon" :size="15" class="text-brand" />
            <span class="font-medium text-ink">{{ item.label }}</span>
          </span>
          <span class="text-[11px] text-ink-faint">{{ item.sectionLabel }}</span>
        </button>
      </div>
    </CommonBaseModal>
  </div>
</template>
