<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { mdiArrowLeft } from '@mdi/js';
import { splitLocalePrefix } from '~/utils/routes';

const { t } = useI18n();
const localePath = useLocalePath();
const route = useRoute();

definePageMeta({
  robots: false,
  middleware: ['auth', 'locale-preference', 'require-admin'],
});

const isHome = computed(() => {
  const { localizedPath } = splitLocalePrefix(route.path);
  return (localizedPath.replace(/\/+$/, '') || '/') === '/admin';
});
</script>

<template>
  <div class="nd-page px-4 md:px-0 pb-10 text-ink min-h-screen">
    <div v-if="!isHome" class="mb-4">
      <NuxtLink
        :to="localePath('/admin')"
        data-testid="admin-back-home"
        class="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <UiBaseIcon :path="mdiArrowLeft" :size="15" />
        <span>{{ t('adminDashboard.nav.home') }}</span>
      </NuxtLink>
    </div>

    <div class="min-w-0">
      <NuxtPage />
    </div>
  </div>
</template>
