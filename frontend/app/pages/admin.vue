<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { mdiAlertOutline, mdiBullhornOutline, mdiRefresh, mdiShieldCrownOutline, mdiViewDashboardOutline } from '@mdi/js';
import { ADMIN_CATEGORIES, ADMIN_DIRECTORY_ITEMS, ADMIN_LIVE_INTERNAL_ITEMS, type AdminCategoryId } from '~/composables/useAdminOverview';
import { splitLocalePrefix } from '~/utils/routes';

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();

const { overview, isLoading, ensureLoaded, refresh } = useAdminOverview();

definePageMeta({
  robots: false,
  middleware: [
    defineNuxtRouteMiddleware(() => {
      const store = userStore();
      if (!store.isLoggedIn) {
        return navigateTo(useLocalePath()('/'), { replace: true });
      }
    }),
    'locale-preference',
    defineNuxtRouteMiddleware(() => {
      const store = userStore();
      if (!store.isAdmin) {
        return navigateTo(useLocalePath()('/user/settings'), { replace: true });
      }
    }),
  ],
});

const activePath = computed(() => {
  const { localizedPath } = splitLocalePrefix(route.path);
  return localizedPath.replace(/\/+$/, '') || '/';
});

const isHome = computed(() => activePath.value === '/admin');

const activeCategory = computed<AdminCategoryId | null>(() => {
  const raw = typeof route.query.section === 'string' ? route.query.section : null;
  if (raw && ADMIN_CATEGORIES.some((cat) => cat.id === raw)) {
    return raw as AdminCategoryId;
  }
  return null;
});

function categoryCount(id: AdminCategoryId): number {
  return ADMIN_DIRECTORY_ITEMS.filter((item) => item.category === id).length;
}

function selectCategory(id: AdminCategoryId) {
  if (isHome.value && activeCategory.value === id) {
    return navigateTo(localePath('/admin'));
  }
  return navigateTo({ path: localePath('/admin'), query: { section: id } });
}

function onQuickJump(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!value) return;
  navigateTo(localePath(value));
}

onMounted(() => {
  ensureLoaded();
});
</script>

<template>
  <div class="nd-page px-4 md:px-0 pb-10 text-ink min-h-screen">
    <!-- Jiten-inspired compact admin command bar -->
    <div
      data-testid="admin-command-bar"
      class="mb-6 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-hairline bg-card-background px-3 py-2.5"
    >
      <div class="flex flex-wrap items-center gap-2 min-w-0">
        <NuxtLink
          :to="localePath('/admin')"
          data-testid="admin-nav-home"
          :class="[
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
            isHome && !activeCategory
              ? 'bg-brand-solid text-white shadow-sm'
              : 'border border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
          ]"
        >
          <UiBaseIcon :path="mdiViewDashboardOutline" :size="16" />
          <span>{{ t('adminDashboard.nav.home') }}</span>
        </NuxtLink>

        <span class="hidden sm:inline-block h-5 w-px bg-hairline" aria-hidden="true" />

        <label class="sr-only" for="admin-quick-jump">{{ t('adminDashboard.nav.jumpLabel') }}</label>
        <select
          id="admin-quick-jump"
          data-testid="admin-quick-jump"
          :value="isHome ? '' : activePath"
          class="nd-select appearance-none h-8 py-1 pr-8 text-xs min-w-[210px]"
          @change="onQuickJump"
        >
          <option value="">
            {{ t('adminDashboard.nav.jumpPlaceholder', { count: ADMIN_LIVE_INTERNAL_ITEMS.length }) }}
          </option>
          <option
            v-for="item in ADMIN_LIVE_INTERNAL_ITEMS"
            :key="item.id"
            :value="item.to"
          >
            {{ t(item.titleKey) }}
          </option>
        </select>

        <div class="hidden xl:flex items-center gap-1.5">
          <button
            v-for="cat in ADMIN_CATEGORIES"
            :key="cat.id"
            type="button"
            :data-testid="`admin-cat-${cat.id}`"
            :class="[
              'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
              isHome && activeCategory === cat.id
                ? 'border-brand-solid bg-brand/15 text-brand font-semibold'
                : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
            ]"
            @click="selectCategory(cat.id)"
          >
            {{ t(cat.labelKey) }} ({{ categoryCount(cat.id) }})
          </button>
        </div>

        <NuxtLink
          :to="localePath('/admin/reports')"
          data-testid="admin-nav-review-queue"
          :class="[
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
            activePath === '/admin/reports'
              ? 'border-brand-solid bg-brand/15 text-brand font-semibold'
              : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover hover:text-ink',
          ]"
        >
          <UiBaseIcon :path="mdiShieldCrownOutline" :size="15" />
          <span>{{ t('adminDashboard.nav.reviewQueue') }}</span>
          <span
            v-if="overview && overview.reports.open > 0"
            data-testid="admin-reports-badge"
            class="rounded-full bg-brand-solid px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
          >
            {{ overview.reports.open }}
          </span>
        </NuxtLink>
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <NuxtLink
          v-if="overview?.announcement.active"
          :to="localePath('/admin/announcement')"
          class="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25"
        >
          <UiBaseIcon :path="mdiBullhornOutline" :size="14" />
          <span>{{ t('adminDashboard.status.bannerActive') }}</span>
        </NuxtLink>

        <span
          v-if="overview && overview.queues.failed > 0"
          data-testid="admin-failed-jobs-pill"
          class="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-300"
        >
          <UiBaseIcon :path="mdiAlertOutline" :size="14" />
          <span>{{ t('adminDashboard.status.failedJobs', { count: overview.queues.failed }) }}</span>
        </span>

        <button
          type="button"
          data-testid="admin-refresh-overview"
          :disabled="isLoading"
          :aria-label="t('adminDashboard.nav.refresh')"
          :title="t('adminDashboard.nav.refresh')"
          class="inline-flex size-8 items-center justify-center rounded-lg border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          @click="refresh"
        >
          <UiBaseIcon :path="mdiRefresh" :size="16" :class="{ 'animate-spin': isLoading }" />
        </button>
      </div>
    </div>

    <div class="min-w-0">
      <NuxtPage />
    </div>
  </div>
</template>
