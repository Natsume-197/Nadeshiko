<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core';
import {
  mdiAccountGroupOutline,
  mdiBellOutline,
  mdiBullhornOutline,
  mdiChevronRight,
  mdiClose,
  mdiDockLeft,
  mdiEmailOutline,
  mdiHeartOutline,
  mdiHomeOutline,
  mdiMagnify,
  mdiMenu,
  mdiOpenInNew,
  mdiPulse,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
} from '@mdi/js';
import type { AdminOverview } from '@brigadasos/nadeshiko-sdk';
import type { AdminTone } from '~/components/admin/ui/Badge.vue';
import { splitLocalePrefix } from '~/utils/routes';

type RailSectionId = 'home' | 'moderation' | 'communication' | 'people';

interface NavPageItem {
  id: string;
  label: string;
  to: string;
  icon: string;
  badge?: (o: AdminOverview | null) => { text: string; tone?: AdminTone } | null;
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
const commandIndex = ref(0);
const commandInput = ref<HTMLInputElement | null>(null);

const normalizedPath = computed(() => {
  const { localizedPath } = splitLocalePrefix(route.path);
  return localizedPath.replace(/\/+$/, '') || '/';
});

const sections = computed<RailSection[]>(() => [
  {
    id: 'home',
    label: t('adminLayout.sections.home'),
    icon: mdiHomeOutline,
    defaultTo: '/admin',
    matchPrefixes: ['/admin'],
    items: [{ id: 'overview', label: t('adminDashboard.title'), to: '/admin', icon: mdiHomeOutline }],
  },
  {
    id: 'moderation',
    label: t('adminLayout.sections.moderation'),
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
    label: t('adminLayout.sections.communication'),
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
        badge: (o) => (o?.announcement.active ? { text: t('adminLayout.on'), tone: 'warning' } : null),
      },
    ],
  },
  {
    id: 'people',
    label: t('adminLayout.sections.people'),
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

watch(commandQuery, () => {
  commandIndex.value = 0;
});

const currentPageLabel = computed(() => {
  const match = activeSection.value.items.find((i) => isItemActive(i));
  return match?.label ?? activeSection.value.label;
});

const showSidebar = computed(() => sidebarOpen.value && activeSection.value.items.length > 1);

function isItemActive(item: NavPageItem): boolean {
  if (item.to === '/admin') return normalizedPath.value === '/admin';
  return normalizedPath.value === item.to || normalizedPath.value.startsWith(`${item.to}/`);
}

function goTo(item: NavPageItem) {
  commandOpen.value = false;
  mobileNavOpen.value = false;
  void router.push(localePath(item.to));
}

function openCommand() {
  commandQuery.value = '';
  commandIndex.value = 0;
  commandOpen.value = true;
  nextTick(() => commandInput.value?.focus());
}

function openSelectedCommand() {
  const item = allCommandItems.value[commandIndex.value];
  if (item) goTo(item);
}

function moveCommand(delta: number) {
  const n = allCommandItems.value.length;
  if (!n) return;
  commandIndex.value = (commandIndex.value + delta + n) % n;
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

    <header class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-3">
      <div class="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          class="inline-flex size-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink lg:hidden"
          :aria-label="t('adminLayout.menu')"
          @click="mobileNavOpen = !mobileNavOpen"
        >
          <UiBaseIcon :path="mdiMenu" :size="18" />
        </button>

        <NuxtLink
          :to="localePath('/admin')"
          class="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] font-semibold text-ink transition-colors hover:bg-surface-hover"
        >
          <span class="flex size-6 items-center justify-center rounded-md bg-brand-solid text-xs font-bold text-on-accent">
            N
          </span>
          <span class="hidden sm:inline">Nadeshiko</span>
        </NuxtLink>

        <UiBaseIcon :path="mdiChevronRight" :size="14" w="w-3.5" h="h-3.5" class="hidden text-ink-faint sm:inline-flex" />
        <span v-if="activeSection.id !== 'home'" class="hidden truncate text-[13px] text-ink-faint md:inline">
          {{ activeSection.label }}
        </span>
        <UiBaseIcon
          v-if="activeSection.id !== 'home'"
          :path="mdiChevronRight"
          :size="14"
          w="w-3.5"
          h="h-3.5"
          class="hidden text-ink-faint md:inline-flex"
        />
        <span class="truncate text-[13px] font-medium text-ink">{{ currentPageLabel }}</span>
      </div>

      <button
        type="button"
        class="hidden h-8 w-full max-w-sm items-center justify-between gap-2 rounded-md border border-hairline bg-background/70 px-2.5 text-[13px] text-ink-faint transition-colors hover:border-line-hover hover:text-ink-muted sm:flex"
        @click="openCommand"
      >
        <span class="flex items-center gap-2">
          <UiBaseIcon :path="mdiMagnify" :size="15" w="w-4" h="h-4" />
          <span>{{ t('adminLayout.jumpTo') }}</span>
        </span>
        <kbd class="rounded border border-hairline bg-surface px-1.5 py-px font-mono text-[11px] text-ink-faint">Ctrl K</kbd>
      </button>

      <div class="flex shrink-0 items-center gap-2">
        <span
          v-if="store.userName"
          class="hidden size-7 items-center justify-center rounded-full bg-surface-lift text-xs font-semibold uppercase text-ink-muted md:flex"
          :title="store.userName"
        >
          {{ store.userName.charAt(0) }}
        </span>
        <NuxtLink
          :to="localePath('/')"
          class="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline px-2.5 text-[13px] text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <span>{{ t('adminLayout.site') }}</span>
          <UiBaseIcon :path="mdiOpenInNew" :size="13" w="w-3.5" h="h-3.5" />
        </NuxtLink>
      </div>
    </header>

    <div class="relative flex min-h-0 flex-1 overflow-hidden">
      <!-- Icon rail: one entry per area -->
      <aside class="hidden w-20 shrink-0 flex-col items-center justify-between border-r border-hairline bg-surface py-2 lg:flex">
        <nav class="flex w-full flex-col items-center gap-1 px-1.5">
          <NuxtLink
            v-for="sec in sections"
            :key="sec.id"
            :to="localePath(sec.defaultTo)"
            class="flex w-full flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors"
            :class="activeSection.id === sec.id ? 'bg-brand/15 text-brand' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'"
          >
            <UiBaseIcon :path="sec.icon" :size="20" w="w-5" h="h-5" />
            <span class="max-w-full truncate px-0.5">{{ sec.label }}</span>
          </NuxtLink>
        </nav>

        <div class="flex w-full flex-col items-center gap-1 px-1.5">
          <a
            href="https://status.nadeshiko.co"
            target="_blank"
            rel="noopener noreferrer"
            class="flex w-full flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <UiBaseIcon :path="mdiPulse" :size="18" w="w-[18px]" h="h-[18px]" />
            <span>{{ t('adminLayout.status') }}</span>
          </a>
          <button
            v-if="activeSection.items.length > 1"
            type="button"
            :aria-label="t('adminLayout.toggleSidebar')"
            class="inline-flex size-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            @click="sidebarOpen = !sidebarOpen"
          >
            <UiBaseIcon :path="mdiDockLeft" :size="18" w="w-[18px]" h="h-[18px]" />
          </button>
        </div>
      </aside>

      <!-- Pages of the active area (only when it has more than one) -->
      <aside v-if="showSidebar" class="hidden w-56 shrink-0 flex-col border-r border-hairline bg-surface/40 lg:flex">
        <div class="px-4 pb-2 pt-4 text-xs font-medium text-ink-faint">
          {{ activeSection.label }}
        </div>
        <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          <NuxtLink
            v-for="item in activeSection.items"
            :key="item.id"
            :to="localePath(item.to)"
            class="flex h-8 items-center justify-between gap-2 rounded-md px-2.5 text-[13px] transition-colors"
            :class="isItemActive(item) ? 'bg-surface-lift font-medium text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'"
          >
            <span class="flex min-w-0 items-center gap-2.5">
              <UiBaseIcon
                :path="item.icon"
                :size="16"
                w="w-4"
                h="h-4"
                class="shrink-0"
                :class="isItemActive(item) ? 'text-brand' : ''"
              />
              <span class="truncate">{{ item.label }}</span>
            </span>
            <AdminUiBadge v-if="item.badge?.(overview)" :tone="item.badge?.(overview)?.tone ?? 'neutral'">
              {{ item.badge?.(overview)?.text }}
            </AdminUiBadge>
          </NuxtLink>
        </nav>
      </aside>

      <!-- Mobile nav drawer -->
      <CommonBaseModal
        :open="mobileNavOpen"
        transition="nd-drawer"
        labelledby="admin-mobile-nav-title"
        overlay-class="items-stretch justify-start bg-fixed-scrim/60 lg:hidden"
        panel-class="flex h-full w-72 flex-col overflow-y-auto border-r border-hairline bg-background"
        @close="mobileNavOpen = false"
      >
        <div class="nd-modal-header">
          <span id="admin-mobile-nav-title" class="text-sm font-semibold text-ink">Nadeshiko</span>
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint hover:text-ink"
            :aria-label="t('adminLayout.close')"
            @click="mobileNavOpen = false"
          >
            <UiBaseIcon :path="mdiClose" :size="16" />
          </button>
        </div>
        <div class="space-y-5 p-3">
          <div v-for="sec in sections" :key="sec.id" class="space-y-0.5">
            <div class="px-2.5 pb-1 text-xs font-medium text-ink-faint">{{ sec.label }}</div>
            <NuxtLink
              v-for="item in sec.items"
              :key="item.id"
              :to="localePath(item.to)"
              class="flex h-9 items-center justify-between gap-2 rounded-md px-2.5 text-sm"
              :class="isItemActive(item) ? 'bg-surface-lift font-medium text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'"
            >
              <span class="flex items-center gap-2.5">
                <UiBaseIcon :path="item.icon" :size="16" w="w-4" h="h-4" />
                <span class="truncate">{{ item.label }}</span>
              </span>
              <AdminUiBadge v-if="item.badge?.(overview)" :tone="item.badge?.(overview)?.tone ?? 'neutral'">
                {{ item.badge?.(overview)?.text }}
              </AdminUiBadge>
            </NuxtLink>
          </div>
        </div>
      </CommonBaseModal>

      <main class="min-w-0 flex-1 overflow-y-auto bg-background">
        <div class="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>

    <!-- Ctrl+K command palette -->
    <CommonBaseModal
      :open="commandOpen"
      labelledby="admin-command-palette-title"
      overlay-class="items-start justify-center bg-fixed-scrim/60 px-4 pt-24"
      panel-class="w-full max-w-lg overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl"
      @close="commandOpen = false"
    >
      <div class="flex items-center gap-2.5 border-b border-hairline px-4 py-3">
        <UiBaseIcon :path="mdiMagnify" :size="18" w="w-[18px]" h="h-[18px]" class="text-ink-faint" />
        <input
          id="admin-command-palette-title"
          ref="commandInput"
          v-model="commandQuery"
          type="search"
          :placeholder="t('adminLayout.jumpTo')"
          class="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          @keydown.down.prevent="moveCommand(1)"
          @keydown.up.prevent="moveCommand(-1)"
          @keydown.enter="openSelectedCommand"
        />
        <kbd class="rounded border border-hairline px-1.5 py-px font-mono text-[11px] text-ink-faint">Esc</kbd>
      </div>
      <div class="max-h-80 overflow-y-auto p-1.5">
        <div v-if="allCommandItems.length === 0" class="px-3 py-8 text-center text-[13px] text-ink-faint">
          {{ t('adminLayout.noMatches') }}
        </div>
        <button
          v-for="(item, i) in allCommandItems"
          :key="item.id"
          type="button"
          class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors"
          :class="i === commandIndex ? 'bg-surface-lift text-ink' : 'text-ink-muted hover:bg-surface-hover'"
          @mouseenter="commandIndex = i"
          @click="goTo(item)"
        >
          <span class="flex items-center gap-2.5">
            <UiBaseIcon :path="item.icon" :size="16" w="w-4" h="h-4" class="text-ink-faint" />
            <span class="font-medium text-ink">{{ item.label }}</span>
          </span>
          <span class="text-xs text-ink-faint">{{ item.sectionLabel }}</span>
        </button>
      </div>
    </CommonBaseModal>
  </div>
</template>
