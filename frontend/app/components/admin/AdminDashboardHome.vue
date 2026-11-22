<script setup lang="ts">
import { mdiOpenInNew, mdiRefresh } from '@mdi/js';
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

function itemsForCategory(category: AdminCategoryId) {
  return ADMIN_DIRECTORY_ITEMS.filter((item) => item.category === category).map((item) => ({
    item,
    badge: item.badge ? item.badge(overview.value) : null,
  }));
}

function badgeLabel(badge: AdminDirectoryBadge): string {
  if (badge.key) return badge.params ? t(badge.key, badge.params) : t(badge.key);
  return badge.text ?? '';
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
  <div data-testid="admin-dashboard-home" class="space-y-8">
    <!-- Title + live corpus/community pulse strip -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-ink">
          {{ t('adminDashboard.title') }}
        </h1>
        <p class="mt-0.5 text-sm text-ink-muted">
          {{ t('adminDashboard.subtitle') }}
        </p>
      </div>

      <div
        v-if="overview"
        data-testid="admin-pulse-strip"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint"
      >
        <span>{{ t('adminDashboard.pulse.users', { count: formatNumber(overview.users.total) }) }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ t('adminDashboard.pulse.patrons', { count: formatNumber(overview.users.activePatrons) }) }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ t('adminDashboard.pulse.media', { count: formatNumber(overview.catalogue.media) }) }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ t('adminDashboard.pulse.segments', { count: formatNumber(overview.catalogue.segments) }) }}</span>
        <button
          type="button"
          data-testid="admin-refresh-overview"
          :disabled="isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          :title="t('adminDashboard.nav.refresh')"
          class="inline-flex size-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          @click="refresh"
        >
          <UiBaseIcon :path="mdiRefresh" :size="14" :class="{ 'animate-spin': isLoading }" />
        </button>
      </div>
      <div v-else-if="isLoading" class="text-xs text-ink-faint">
        {{ t('adminDashboard.loading') }}
      </div>
    </div>

    <!-- 4-column categorized directory -->
    <section
      data-testid="admin-directory"
      class="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-2 xl:grid-cols-4"
    >
      <div
        v-for="cat in ADMIN_CATEGORIES"
        :key="cat.id"
        :data-testid="`admin-section-${cat.id}`"
        class="space-y-3"
      >
        <div class="flex items-center justify-between border-b border-hairline pb-2">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {{ t(cat.labelKey) }}
          </h2>
        </div>

        <ul class="space-y-1">
          <li v-for="{ item, badge } in itemsForCategory(cat.id)" :key="item.id">
            <!-- Live internal route -->
            <NuxtLink
              v-if="item.status === 'live' && item.to"
              :to="localePath(item.to)"
              :data-testid="`admin-dir-${item.id}`"
              class="group flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-hover"
            >
              <span class="mt-0.5 shrink-0 text-brand">
                <UiBaseIcon :path="item.icon" :size="18" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2">
                  <span class="text-sm font-medium text-ink group-hover:text-brand transition-colors">
                    {{ t(item.titleKey) }}
                  </span>
                  <span
                    v-if="badge"
                    :class="[
                      'rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                      badgeClasses(badge.tone),
                    ]"
                  >
                    {{ badgeLabel(badge) }}
                  </span>
                </span>
                <span class="mt-0.5 block text-xs leading-snug text-ink-faint">
                  {{ t(item.descriptionKey) }}
                </span>
              </span>
            </NuxtLink>

            <!-- Live external link -->
            <a
              v-else-if="item.status === 'live' && item.href"
              :href="item.href"
              target="_blank"
              rel="noopener noreferrer"
              :data-testid="`admin-dir-${item.id}`"
              class="group flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-hover"
            >
              <span class="mt-0.5 shrink-0 text-brand">
                <UiBaseIcon :path="item.icon" :size="18" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="text-sm font-medium text-ink group-hover:text-brand transition-colors">
                    {{ t(item.titleKey) }}
                  </span>
                  <UiBaseIcon :path="mdiOpenInNew" :size="12" class="text-ink-faint" />
                </span>
                <span class="mt-0.5 block text-xs leading-snug text-ink-faint">
                  {{ t(item.descriptionKey) }}
                </span>
              </span>
            </a>

            <!-- Planned Phase 2 item (non-broken, still surfaces live backend counts) -->
            <div
              v-else
              :data-testid="`admin-dir-${item.id}`"
              class="flex items-start gap-3 rounded-lg px-2.5 py-2 opacity-75"
            >
              <span class="mt-0.5 shrink-0 text-ink-faint">
                <UiBaseIcon :path="item.icon" :size="18" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="text-sm font-medium text-ink-muted">
                    {{ t(item.titleKey) }}
                  </span>
                  <span
                    v-if="badge"
                    :class="[
                      'rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                      badgeClasses(badge.tone),
                    ]"
                  >
                    {{ badgeLabel(badge) }}
                  </span>
                  <span class="rounded border border-hairline bg-surface px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
                    {{ t('adminDashboard.status.soon') }}
                  </span>
                </span>
                <span class="mt-0.5 block text-xs leading-snug text-ink-faint">
                  {{ t(item.descriptionKey) }}
                </span>
              </span>
            </div>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
