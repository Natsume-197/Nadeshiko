<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { useTrackerSync } from '~/composables/useTrackerSync';
import { handleApiError } from '~/utils/apiError';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();
const { completeLink } = useTrackerSync();

const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');
const matchedCount = ref(0);
const totalCount = ref(0);

onMounted(async () => {
  const code = String(route.query.code ?? '');
  const sealed = String(route.query.state ?? '');
  const error = String(route.query.error ?? '');
  if (error || !code || !sealed) {
    state.value = 'failed';
    message.value = error === 'access_denied' ? t('trackerCallback.declined') : t('trackerCallback.failed');
    return;
  }

  try {
    const tracker = await completeLink('ANILIST', code, sealed);
    matchedCount.value = tracker.coverage?.inCatalog ?? 0;
    totalCount.value = tracker.coverage?.total ?? 0;
    await router.replace({ path: route.path, query: {} });
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    message.value = t('trackerCallback.failed');
    handleApiError('trackerConnection.callback', caught, { toastKey: false });
  }
});
</script>

<template>
  <div
    class="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center text-white"
    data-testid="anilist-callback"
  >
    <span v-if="state === 'working'" class="nd-spinner" />
    <template v-else-if="state === 'done'">
      <div class="flex size-16 items-center justify-center rounded-full bg-green-500/15 text-green-300">
        <UiBaseIcon :path="mdiCheckBold" size="30" />
      </div>
      <h1 class="mt-5 text-3xl font-bold">{{ t('trackerCallback.done') }}</h1>
      <p class="mt-2 text-white/50">
        {{ t('trackerCallback.doneBody', { inCatalog: matchedCount, total: totalCount }) }}
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-3">
        <NuxtLink :to="localePath('/')" class="nd-btn-accent" data-testid="anilist-callback-search">
          {{ t('trackerCallback.startSearching') }}
        </NuxtLink>
        <NuxtLink :to="localePath('/user/connections')" class="nd-btn">
          {{ t('trackerCallback.backToSettings') }}
        </NuxtLink>
      </div>
    </template>
    <template v-else>
      <h1 class="text-3xl font-bold">{{ message }}</h1>
      <NuxtLink :to="localePath('/user/connections')" class="mt-5 text-brand hover:text-brand-hover">
        {{ t('trackerCallback.backToSettings') }}
      </NuxtLink>
    </template>
  </div>
</template>
