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
  <div data-testid="admin-dashboard-home" class="space-y-8">
    <!-- Title + refresh -->
    <div class="flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold tracking-tight text-ink">
          {{ t('adminDashboard.title') }}
        </h1>
        <p class="mt-0.5 text-sm text-ink-muted">
          {{ t('adminDashboard.subtitle') }}
        </p>
      </div>

      <button
        type="button"
        data-testid="admin-refresh-overview"
        :disabled="isLoading"
        :aria-label="t('adminDashboard.nav.refresh')"
        :title="t('adminDashboard.nav.refresh')"
        class="inline-flex size-8 items-center justify-center rounded-lg border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
        @click="refresh()"
      >
        <UiBaseIcon :path="mdiRefresh" :size="16" :class="{ 'animate-spin': isLoading }" />
      </button>
    </div>

    <!-- 3-column categorized directory -->
    <section
      data-testid="admin-directory"
      class="grid grid-cols-1 gap-x-6 gap-y-8 md:grid-cols-3"
    >
      <div
        v-for="cat in ADMIN_CATEGORIES"
        :key="cat.id"
        :data-testid="`admin-section-${cat.id}`"
        class="space-y-3"
      >
        <h2 class="border-b border-hairline pb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {{ t(cat.labelKey) }}
        </h2>

        <ul class="space-y-1">
          <li v-for="{ item, badge } in itemsForCategory(cat.id)" :key="item.id">
            <NuxtLink
              :to="item.external ? item.to : localePath(item.to)"
              :target="item.external ? '_blank' : undefined"
              :rel="item.external ? 'noopener noreferrer' : undefined"
              :data-testid="`admin-dir-${item.id}`"
              class="group flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-hover"
            >
              <span class="mt-0.5 shrink-0 text-brand">
                <UiBaseIcon :path="item.icon" :size="18" />
              </span>
              <span class="min-w-0 flex-1">
                <span :class="['flex items-center', item.external ? 'gap-1.5' : 'gap-2']">
                  <span class="text-sm font-medium text-ink group-hover:text-brand transition-colors">
                    {{ t(item.titleKey) }}
                  </span>
                  <UiBaseIcon v-if="item.external" :path="mdiOpenInNew" :size="12" class="text-ink-faint" />
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
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
