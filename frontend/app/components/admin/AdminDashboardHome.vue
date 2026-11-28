<script setup lang="ts">
import {
  mdiAccountGroupOutline,
  mdiArrowRight,
  mdiEmailOutline,
  mdiHeartOutline,
  mdiOpenInNew,
  mdiRefresh,
  mdiShieldCrownOutline,
  mdiThumbUpOutline,
} from '@mdi/js';
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

const pulseCards = computed(() => {
  const o = overview.value;
  const emailProblems = (o?.emails?.failed ?? 0) + (o?.emails?.bounced ?? 0);
  return [
    {
      id: 'reports',
      label: t('accountSettings.tabs.reports'),
      value: o ? formatNumber(o.reports.open) : '—',
      sub: 'open reports',
      icon: mdiShieldCrownOutline,
      to: '/admin/reports',
      tone: o && o.reports.open > 0 ? 'text-brand' : 'text-ink',
    },
    {
      id: 'requests',
      label: t('requests.admin.tab'),
      value: o ? formatNumber(o.requests.open) : '—',
      sub: o && o.requests.boostedOpen > 0 ? `${o.requests.boostedOpen} boosted` : 'open requests',
      icon: mdiThumbUpOutline,
      to: '/admin/requests',
      tone: o && o.requests.boostedOpen > 0 ? 'text-amber-300' : 'text-ink',
    },
    {
      id: 'users',
      label: t('accountSettings.tabs.users'),
      value: o ? formatNumber(o.users.total) : '—',
      sub: 'total accounts',
      icon: mdiAccountGroupOutline,
      to: '/admin/users',
      tone: 'text-ink',
    },
    {
      id: 'patrons',
      label: t('adminDashboard.items.patreonTitle'),
      value: o ? formatNumber(o.users.activePatrons) : '—',
      sub: 'active patrons',
      icon: mdiHeartOutline,
      to: '/admin/patreon',
      tone: o && o.users.activePatrons > 0 ? 'text-emerald-300' : 'text-ink',
    },
    {
      id: 'emails',
      label: t('adminEmails.title'),
      value: o ? formatNumber(emailProblems) : '—',
      sub: '24h issues',
      icon: mdiEmailOutline,
      to: '/admin/emails',
      tone: o?.emails?.failed ? 'text-red-300' : emailProblems > 0 ? 'text-amber-300' : 'text-emerald-300',
    },
  ];
});

function itemsForCategory(category: AdminCategoryId) {
  return ADMIN_DIRECTORY_ITEMS.filter((item) => item.category === category).map((item) => ({
    item,
    badge: item.badge ? item.badge(overview.value) : null,
  }));
}

function badgeLabel(badge: AdminDirectoryBadge): string {
  return badge.key ? t(badge.key) : formatNumber(badge.count);
}

function badgeClasses(tone: 'brand' | 'warning' | 'danger' | 'success' | 'neutral'): string {
  switch (tone) {
    case 'brand':
      return 'bg-brand/15 text-brand border-brand/30';
    case 'warning':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'danger':
      return 'bg-red-500/15 text-red-300 border-red-500/30';
    case 'success':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    default:
      return 'bg-surface-lift text-ink-muted border-hairline';
  }
}
</script>

<template>
  <div data-testid="admin-dashboard-home" class="space-y-6">
    <!-- PostHog-style compact page header -->
    <div class="flex items-center justify-between gap-3 border-b border-hairline pb-4">
      <div>
        <h1 class="text-lg font-semibold tracking-tight text-ink">
          {{ t('adminDashboard.title') }}
        </h1>
        <p class="text-xs text-ink-muted">
          {{ t('adminDashboard.subtitle') }}
        </p>
      </div>

      <button
        type="button"
        data-testid="admin-refresh-overview"
        :disabled="isLoading"
        :aria-label="t('adminDashboard.nav.refresh')"
        :title="t('adminDashboard.nav.refresh')"
        class="nd-btn !h-8 text-xs"
        @click="refresh()"
      >
        <UiBaseIcon :path="mdiRefresh" :size="14" :class="{ 'animate-spin': isLoading }" />
        <span>Reload</span>
      </button>
    </div>

    <!-- Compact joined KPI metric strip -->
    <div class="grid grid-cols-2 divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card-background sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-5">
      <NuxtLink
        v-for="card in pulseCards"
        :key="card.id"
        :to="localePath(card.to)"
        class="group flex flex-col justify-between px-4 py-3 transition-colors hover:bg-surface-hover"
      >
        <div class="flex items-center justify-between text-[11px] font-medium text-ink-faint">
          <span>{{ card.label }}</span>
          <UiBaseIcon :path="card.icon" :size="14" class="text-ink-faint group-hover:text-brand transition-colors" />
        </div>
        <div class="mt-1.5 flex items-baseline justify-between gap-2">
          <span :class="['text-xl font-bold tabular-nums tracking-tight', card.tone]">{{ card.value }}</span>
          <span class="truncate text-[11px] text-ink-faint">{{ card.sub }}</span>
        </div>
      </NuxtLink>
    </div>

    <!-- Categorized flat workspace panels -->
    <section
      data-testid="admin-directory"
      class="grid grid-cols-1 gap-4 md:grid-cols-3"
    >
      <div
        v-for="cat in ADMIN_CATEGORIES"
        :key="cat.id"
        :data-testid="`admin-section-${cat.id}`"
        class="overflow-hidden rounded-lg border border-hairline bg-card-background"
      >
        <div class="border-b border-hairline bg-surface/60 px-3.5 py-2">
          <h2 class="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {{ t(cat.labelKey) }}
          </h2>
        </div>

        <ul class="divide-y divide-hairline">
          <li v-for="{ item, badge } in itemsForCategory(cat.id)" :key="item.id">
            <NuxtLink
              :to="item.external ? item.to : localePath(item.to)"
              :target="item.external ? '_blank' : undefined"
              :rel="item.external ? 'noopener noreferrer' : undefined"
              :data-testid="`admin-dir-${item.id}`"
              class="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-hover"
            >
              <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-lift text-brand">
                <UiBaseIcon :path="item.icon" :size="16" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-xs font-semibold text-ink group-hover:text-brand transition-colors">
                    {{ t(item.titleKey) }}
                  </span>
                  <UiBaseIcon v-if="item.external" :path="mdiOpenInNew" :size="11" class="shrink-0 text-ink-faint" />
                  <span
                    v-if="badge"
                    :class="[
                      'rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums',
                      badgeClasses(badge.tone),
                    ]"
                  >
                    {{ badgeLabel(badge) }}
                  </span>
                </span>
                <span class="mt-0.5 block truncate text-[11px] text-ink-faint">
                  {{ t(item.descriptionKey) }}
                </span>
              </span>
              <UiBaseIcon
                :path="mdiArrowRight"
                :size="13"
                class="shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
              />
            </NuxtLink>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
