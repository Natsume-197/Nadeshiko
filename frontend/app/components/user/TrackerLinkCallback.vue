<script setup lang="ts">
import { mdiCheckBold } from '@mdi/js';
import { useTrackerSync } from '~/composables/useTrackerSync';
import { handleApiError } from '~/utils/apiError';
import type { TrackerProviderId } from '~/utils/trackerFilter';

/** Shared OAuth return page for anime trackers: completes the link and reports catalog coverage. */
const props = defineProps<{ provider: TrackerProviderId }>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const localePath = useLocalePath();
const { completeLink } = useTrackerSync();

const state = ref<'working' | 'done' | 'failed'>('working');
const message = ref('');
const matchedCount = ref(0);
const totalCount = ref(0);

const isMal = computed(() => props.provider === 'MAL');

onMounted(async () => {
  const code = String(route.query.code ?? '');
  const sealed = String(route.query.state ?? '');
  const error = String(route.query.error ?? '');
  const failed = isMal.value ? t('trackerCallback.malFailed') : t('trackerCallback.failed');
  if (error || !code || !sealed) {
    state.value = 'failed';
    const declined = isMal.value ? t('trackerCallback.malDeclined') : t('trackerCallback.declined');
    message.value = error === 'access_denied' ? declined : failed;
    return;
  }

  try {
    const tracker = await completeLink(props.provider, code, sealed);
    matchedCount.value = tracker.coverage?.inCatalog ?? 0;
    totalCount.value = tracker.coverage?.total ?? 0;
    await router.replace({ path: route.path, query: {} });
    state.value = 'done';
  } catch (caught) {
    state.value = 'failed';
    message.value = failed;
    handleApiError('trackerConnection.callback', caught, { toastKey: false });
  }
});
</script>

<template>
  <div
    class="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center text-white"
    :data-testid="isMal ? 'mal-callback' : 'anilist-callback'"
  >
    <span v-if="state === 'working'" class="nd-spinner" />
    <template v-else-if="state === 'done'">
      <div class="flex size-16 items-center justify-center rounded-full bg-green-500/15 text-green-300">
        <UiBaseIcon :path="mdiCheckBold" size="30" />
      </div>
      <h1 class="mt-5 text-3xl font-bold">
        {{ isMal ? t('trackerCallback.malDone') : t('trackerCallback.done') }}
      </h1>
      <p class="mt-2 text-white/50">
        {{ t('trackerCallback.doneBody', { inCatalog: matchedCount, total: totalCount }) }}
      </p>
      <div class="mt-6 flex flex-wrap justify-center gap-3">
        <NuxtLink
          :to="localePath('/')"
          class="nd-btn-accent"
          :data-testid="isMal ? 'mal-callback-search' : 'anilist-callback-search'"
        >
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
