<script setup lang="ts">
import { mdiClose, mdiShieldAlertOutline } from '@mdi/js';
import type { WatchingPromptTitle } from '~/utils/trackerFilter';

const props = defineProps<{
  watchingTitles: WatchingPromptTitle[];
  planToWatchCount: number;
}>();

defineEmits<{ dismiss: [] }>();

const { t } = useI18n();
const localePath = useLocalePath();

const primary = computed(() => props.watchingTitles[0] ?? null);
const extraCount = computed(() => Math.max(0, props.watchingTitles.length - 1));
</script>

<template>
  <div
    v-if="primary"
    data-testid="tracker-spoiler-prompt"
    class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 md:px-0 py-2.5 text-sm text-white/50"
  >
    <UiBaseIcon :path="mdiShieldAlertOutline" size="16" class="shrink-0 text-brand" />
    <span>
      {{
        extraCount > 0
          ? t('trackerFilter.spoilerPromptMultiple', {
              title: primary.title,
              episode: primary.progress,
              others: extraCount,
            })
          : t('trackerFilter.spoilerPromptSingle', {
              title: primary.title,
              episode: primary.progress,
            })
      }}
    </span>
    <span aria-hidden="true" class="text-white/20">·</span>
    <NuxtLink
      :to="localePath('/supporters')"
      data-testid="tracker-spoiler-prompt-cta"
      class="font-medium text-brand hover:text-brand-hover underline underline-offset-2 transition-colors"
    >
      {{
        planToWatchCount > 0
          ? t('trackerFilter.spoilerPromptCtaWithPlanning')
          : t('trackerFilter.spoilerPromptCta')
      }}
    </NuxtLink>
    <button
      type="button"
      data-testid="tracker-spoiler-prompt-dismiss"
      :aria-label="t('trackerFilter.dismissPrompt')"
      class="ml-auto inline-flex items-center rounded p-0.5 text-white/40 hover:text-white/80 transition-colors"
      @click="$emit('dismiss')"
    >
      <UiBaseIcon :path="mdiClose" size="15" />
    </button>
  </div>
</template>
