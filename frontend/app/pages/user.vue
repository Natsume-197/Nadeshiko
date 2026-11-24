<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  mdiAccountOutline,
  mdiBellOutline,
  mdiBookOpenVariantOutline,
  mdiChevronRight,
  mdiCodeTags,
  mdiCogOutline,
  mdiFormatListBulletedSquare,
  mdiHistory,
  mdiLinkVariant,
  mdiMagnify,
  mdiPaletteOutline,
  mdiSync,
  mdiViewDashboardOutline,
} from '@mdi/js';
import { useDragScroll } from '~/composables/useDragScroll';
import { splitLocalePrefix } from '~/utils/routes';

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();

const store = userStore();

const tabsPreferences = computed(() => [
  { name: t('accountSettings.tabs.general'), icon: mdiCogOutline, route: '/user/settings' },
  { name: t('accountSettings.tabs.themes'), icon: mdiPaletteOutline, route: '/user/themes' },
  { name: t('accountSettings.tabs.notifications'), icon: mdiBellOutline, route: '/user/notifications' },
]);

const tabsAccount = computed(() => [
  { name: t('accountSettings.tabs.account'), icon: mdiAccountOutline, route: '/user/account' },
  { name: t('accountSettings.tabs.activity'), icon: mdiHistory, route: '/user/activity' },
  { name: t('accountSettings.tabs.connections'), icon: mdiLinkVariant, route: '/user/connections' },
]);

const tabsStudy = computed(() => [
  { name: t('accountSettings.tabs.sync'), icon: mdiSync, route: '/user/sync' },
  // Favorites, hidden titles, and hidden categories share the search-filters tab.
  { name: t('accountSettings.tabs.media'), icon: mdiMagnify, route: '/user/media' },
  { name: t('accountSettings.tabs.collections'), icon: mdiFormatListBulletedSquare, route: '/user/collections' },
  { name: t('accountSettings.tabs.dictionaries'), icon: mdiBookOpenVariantOutline, route: '/user/dictionaries' },
]);

const tabsAdvanced = computed(() => [
  { name: t('accountSettings.tabs.developer'), icon: mdiCodeTags, route: '/user/developer', trailingChevron: false },
  ...(store.isAdmin
    ? [
        {
          name: t('adminDashboard.nav.openDashboard'),
          icon: mdiViewDashboardOutline,
          route: '/admin',
          trailingChevron: true,
        },
      ]
    : []),
]);

const allTabs = computed(() => [
  ...tabsPreferences.value,
  ...tabsAccount.value,
  ...tabsStudy.value,
  ...tabsAdvanced.value,
]);

// Strip the locale prefix so tab selection is language-independent.
const activeTabRoute = computed(() => {
  const { localizedPath } = splitLocalePrefix(route.path);
  const normalized = localizedPath.replace(/\/+$/, '') || '/';
  return normalized === '/user' ? '/user/settings' : normalized;
});

const activeTab = computed(() => allTabs.value.find((tab) => tab.route === activeTabRoute.value) ?? null);

definePageMeta({
  robots: false,
  // Nuxt applies parent middleware to all /user/** children, parent first.
  // URL-specific redirects remain in the pages that own them.
  middleware: ['auth', 'locale-preference'],
});

const mobileTabsRef = ref<HTMLElement | null>(null);
useDragScroll(mobileTabsRef);

function scrollActiveTabIntoView() {
  nextTick(() => {
    const container = mobileTabsRef.value;
    if (!container) return;
    // Use the marker rather than styling so restyling cannot break active-tab scrolling.
    const activeBtn = container.querySelector<HTMLElement>('[data-active-tab]');
    if (activeBtn) {
      activeBtn.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  });
}

onMounted(scrollActiveTabIntoView);
watch(activeTabRoute, scrollActiveTabIntoView);
</script>

<template>
  <div class="nd-page px-4 md:px-0 -mt-3 -mb-20 text-ink">
    <div class="flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
      <aside
        class="hidden md:block md:w-64 md:shrink-0 md:border-e md:border-line-subtle md:pe-5 md:pt-5 md:pb-12"
      >
        <div class="md:sticky md:top-6 flex flex-col">
          <p class="px-2.5 pb-3 text-base font-semibold tracking-tight text-ink">
            {{ $t('accountSettings.menu.title') }}
          </p>

          <nav :aria-label="$t('accountSettings.menu.tabsAriaLabel')" class="flex flex-col">
            <div class="flex flex-col gap-0.5">
              <NuxtLink
                v-for="tab in tabsPreferences"
                :key="tab.route"
                :to="localePath(tab.route)"
                :class="{ active: activeTabRoute === tab.route }"
                class="nd-settings-nav-item"
              >
                <UiBaseIcon :path="tab.icon" size="18" class="shrink-0 opacity-80" />
                <span class="truncate">{{ tab.name }}</span>
              </NuxtLink>
            </div>

            <p class="px-2.5 pt-5 pb-1.5 text-xs font-medium text-ink-faint">
              {{ $t('accountSettings.menu.accountTitle') }}
            </p>
            <div class="flex flex-col gap-0.5">
              <NuxtLink
                v-for="tab in tabsAccount"
                :key="tab.route"
                :to="localePath(tab.route)"
                :class="{ active: activeTabRoute === tab.route }"
                class="nd-settings-nav-item"
              >
                <UiBaseIcon :path="tab.icon" size="18" class="shrink-0 opacity-80" />
                <span class="truncate">{{ tab.name }}</span>
              </NuxtLink>
            </div>

            <p class="px-2.5 pt-5 pb-1.5 text-xs font-medium text-ink-faint">
              {{ $t('accountSettings.menu.studyTitle') }}
            </p>
            <div class="flex flex-col gap-0.5">
              <NuxtLink
                v-for="tab in tabsStudy"
                :key="tab.route"
                :to="localePath(tab.route)"
                :class="{ active: activeTabRoute === tab.route }"
                class="nd-settings-nav-item"
              >
                <UiBaseIcon :path="tab.icon" size="18" class="shrink-0 opacity-80" />
                <span class="truncate">{{ tab.name }}</span>
              </NuxtLink>
            </div>

            <p class="px-2.5 pt-5 pb-1.5 text-xs font-medium text-ink-faint">
              {{ $t('accountSettings.menu.advancedTitle') }}
            </p>
            <div class="flex flex-col gap-0.5">
              <NuxtLink
                v-for="tab in tabsAdvanced"
                :key="tab.route"
                :to="localePath(tab.route)"
                :class="[{ active: activeTabRoute === tab.route }, tab.trailingChevron ? 'justify-between' : '']"
                class="nd-settings-nav-item"
              >
                <span class="flex items-center gap-2.5 min-w-0">
                  <UiBaseIcon :path="tab.icon" size="18" class="shrink-0 opacity-80" />
                  <span class="truncate">{{ tab.name }}</span>
                </span>
                <UiBaseIcon v-if="tab.trailingChevron" :path="mdiChevronRight" size="16" class="shrink-0 text-ink-faint" />
              </NuxtLink>
            </div>
          </nav>
        </div>
      </aside>

      <!-- Mobile horizontal tabs -->
      <div class="block md:hidden pt-3 mb-5 border-b border-line-subtle -mx-4 px-2">
        <nav
          ref="mobileTabsRef"
          :aria-label="$t('accountSettings.menu.tabsAriaLabel')"
          class="mobile-settings-tabs flex select-none overflow-x-auto"
        >
          <NuxtLink
            v-for="tab in allTabs"
            :key="tab.route"
            :to="localePath(tab.route)"
            :data-active-tab="activeTabRoute === tab.route ? '' : undefined"
            :class="[
              'mobile-settings-tab relative px-3.5 py-3 text-sm text-nowrap shrink-0 transition-colors border-b-2 cursor-pointer',
              activeTabRoute === tab.route
                ? 'text-brand font-semibold border-brand-solid'
                : 'text-ink-muted hover:text-ink border-transparent',
            ]"
          >
            {{ tab.name }}
          </NuxtLink>
        </nav>
      </div>

      <div class="flex-1 min-w-0 md:ps-8 lg:ps-10 pt-1 md:pt-5 pb-20">
        <header v-if="activeTab" class="mb-6">
          <h1 class="text-2xl font-semibold tracking-tight text-ink">
            {{ activeTab.name }}
          </h1>
        </header>
        <NuxtPage />
      </div>
    </div>
  </div>
</template>

<style>
.nd-settings-nav-item {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.45rem 0.625rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: var(--ink-muted);
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}

.nd-settings-nav-item:hover {
  background: var(--surface-lift);
  color: var(--ink);
}

.nd-settings-nav-item.active {
  background: var(--lift-strong);
  color: var(--ink);
  font-weight: 500;
}

.mobile-settings-tabs {
  scrollbar-width: none; /* Firefox */
  -webkit-overflow-scrolling: touch;
}

.mobile-settings-tabs::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Edge */
}
</style>
