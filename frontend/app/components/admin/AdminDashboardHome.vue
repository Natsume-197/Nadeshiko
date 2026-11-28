<script setup lang="ts">
import {
  mdiAccountGroupOutline,
  mdiArrowRight,
  mdiCheckCircleOutline,
  mdiEmailOutline,
  mdiHeartOutline,
  mdiOpenInNew,
  mdiRefresh,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
} from '@mdi/js';
import AdminUiBadge from './ui/Badge.vue';
import AdminUiCard from './ui/Card.vue';
import AdminUiEmpty from './ui/Empty.vue';
import AdminUiPageHeader from './ui/PageHeader.vue';
import AdminUiStatStrip, { type AdminStat } from './ui/StatStrip.vue';
import {
  ADMIN_CATEGORIES,
  ADMIN_DIRECTORY_ITEMS,
  type AdminCategoryId,
  type AdminDirectoryBadge,
} from '~/composables/useAdminOverview';

const { t } = useI18n();
const { formatNumber } = useFormat();
const localePath = useLocalePath();

const { overview, isLoading, refresh } = useAdminOverview();
// Spin only after hydration so SSR and client render the same markup.
const mounted = ref(false);
onMounted(() => (mounted.value = true));

const stats = computed<AdminStat[]>(() => {
  const o = overview.value;
  const emailProblems = (o?.emails?.failed ?? 0) + (o?.emails?.bounced ?? 0);
  return [
    {
      id: 'reports',
      label: t('accountSettings.tabs.reports'),
      value: o ? formatNumber(o.reports.open) : null,
      sub: t('adminDashboard.kpi.open'),
      icon: mdiShieldCrownOutline,
      to: '/admin/reports',
      tone: o && o.reports.open > 0 ? 'brand' : 'neutral',
    },
    {
      id: 'requests',
      label: t('requests.admin.tab'),
      value: o ? formatNumber(o.requests.open) : null,
      sub:
        o && o.requests.boostedOpen > 0
          ? t('adminDashboard.kpi.boosted', { n: formatNumber(o.requests.boostedOpen) })
          : t('adminDashboard.kpi.open'),
      icon: mdiThumbUpOutline,
      to: '/admin/requests',
      tone: o && o.requests.boostedOpen > 0 ? 'warning' : 'neutral',
    },
    {
      id: 'users',
      label: t('accountSettings.tabs.users'),
      value: o ? formatNumber(o.users.total) : null,
      sub: t('adminDashboard.kpi.accounts'),
      icon: mdiAccountGroupOutline,
      to: '/admin/users',
    },
    {
      id: 'patrons',
      label: t('adminDashboard.items.patreonTitle'),
      value: o ? formatNumber(o.users.activePatrons) : null,
      sub: t('adminDashboard.kpi.activePatrons'),
      icon: mdiHeartOutline,
      to: '/admin/patreon',
      tone: o && o.users.activePatrons > 0 ? 'success' : 'neutral',
    },
    {
      id: 'emails',
      label: t('adminEmails.title'),
      value: o ? formatNumber(emailProblems) : null,
      sub: t('adminDashboard.kpi.issues24h'),
      icon: mdiEmailOutline,
      to: '/admin/emails',
      tone: o?.emails?.failed ? 'danger' : emailProblems > 0 ? 'warning' : 'success',
    },
  ];
});

const directory = computed(() =>
  ADMIN_DIRECTORY_ITEMS.map((item) => ({ item, badge: item.badge ? item.badge(overview.value) : null })),
);

/** Directory entries whose badge asks for action (anything but a neutral count). */
const attention = computed(() =>
  directory.value.filter(({ badge }) => badge && badge.tone !== 'neutral' && badge.tone !== 'success'),
);

function itemsForCategory(category: AdminCategoryId) {
  return directory.value.filter(({ item }) => item.category === category);
}

function badgeLabel(badge: AdminDirectoryBadge): string {
  return badge.key ? t(badge.key) : formatNumber(badge.count);
}
</script>

<template>
  <div data-testid="admin-dashboard-home" class="space-y-6">
    <AdminUiPageHeader :title="t('adminDashboard.title')">
      <template #actions>
        <button
          type="button"
          data-testid="admin-refresh-overview"
          :disabled="mounted && isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          class="nd-btn !h-8 !text-[13px]"
          @click="refresh()"
        >
          <UiBaseIcon
            :path="mdiRefresh"
            :size="15"
            w="w-4"
            h="h-4"
            :class="{ 'animate-spin': mounted && isLoading }"
          />
          <span>{{ t('adminLayout.reload') }}</span>
        </button>
      </template>
    </AdminUiPageHeader>

    <AdminUiStatStrip :stats="stats" />

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <!-- Needs attention -->
      <AdminUiCard :title="t('adminDashboard.attention')" flush class="lg:col-span-1">
        <template #actions>
          <AdminUiBadge v-if="attention.length" tone="warning">{{ attention.length }}</AdminUiBadge>
        </template>
        <ul v-if="attention.length" class="divide-y divide-hairline">
          <li v-for="{ item, badge } in attention" :key="item.id">
            <NuxtLink
              :to="localePath(item.to)"
              class="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
            >
              <UiBaseIcon :path="item.icon" :size="16" w="w-4" h="h-4" class="shrink-0 text-ink-faint" />
              <span class="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{{ t(item.titleKey) }}</span>
              <AdminUiBadge v-if="badge" :tone="badge.tone" dot>{{ badgeLabel(badge) }}</AdminUiBadge>
              <UiBaseIcon
                :path="mdiArrowRight"
                :size="14"
                w="w-3.5"
                h="h-3.5"
                class="shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
              />
            </NuxtLink>
          </li>
        </ul>
        <AdminUiEmpty v-else :icon="mdiCheckCircleOutline" :text="t('adminDashboard.allClear')" compact />
      </AdminUiCard>

      <!-- Directory -->
      <section data-testid="admin-directory" class="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2">
        <AdminUiCard
          v-for="cat in ADMIN_CATEGORIES"
          :key="cat.id"
          :data-testid="`admin-section-${cat.id}`"
          :title="t(cat.labelKey)"
          flush
        >
          <ul class="p-1.5">
            <li v-for="{ item, badge } in itemsForCategory(cat.id)" :key="item.id">
              <NuxtLink
                :to="item.external ? item.to : localePath(item.to)"
                :target="item.external ? '_blank' : undefined"
                :rel="item.external ? 'noopener noreferrer' : undefined"
                :data-testid="`admin-dir-${item.id}`"
                class="group flex h-9 items-center gap-2.5 rounded-md px-2.5 transition-colors hover:bg-surface-hover"
              >
                <UiBaseIcon
                  :path="item.icon"
                  :size="16"
                  w="w-4"
                  h="h-4"
                  class="shrink-0 text-ink-faint transition-colors group-hover:text-brand"
                />
                <span class="min-w-0 flex-1 truncate text-[13px] text-ink">{{ t(item.titleKey) }}</span>
                <UiBaseIcon v-if="item.external" :path="mdiOpenInNew" :size="12" w="w-3" h="h-3" class="text-ink-faint" />
                <AdminUiBadge v-if="badge" :tone="badge.tone">{{ badgeLabel(badge) }}</AdminUiBadge>
              </NuxtLink>
            </li>
          </ul>
        </AdminUiCard>
      </section>
    </div>
  </div>
</template>
