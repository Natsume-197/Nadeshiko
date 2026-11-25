<script setup lang="ts">
import { mdiShieldCheckOutline, mdiShieldOffOutline } from '@mdi/js';
import type { Media } from '@brigadasos/nadeshiko-sdk';
import { useTrackerSync } from '~/composables/useTrackerSync';
import { trackerIconPath } from '~/utils/trackerIcons';

/** The reader's anime tracker on this title: their status and progress, what the spoiler guard hides, and a way to
 * see the title in full. Renders nothing for titles off the reader's list. */
const props = defineProps<{ media: Media }>();

const { t } = useI18n();
const { state, titleStatus, setTitleUnlocked } = useTrackerSync();

const status = computed(() => titleStatus(props.media.publicId));
const provider = computed(() => state.value?.connection?.provider ?? 'ANILIST');

const progressLabel = computed(() => {
  const entry = status.value;
  if (!entry || entry.progress <= 0 || entry.status === 'PLANNING') return null;
  const total = props.media.episodeCount;
  return total ? t('trackerTitle.progress', { progress: entry.progress, total }) : t('trackerTitle.progressOnly', { progress: entry.progress });
});

const hiddenLabel = computed(() => {
  const entry = status.value;
  if (!entry?.hidden) return null;
  if (entry.unlocked) return t('trackerTitle.shown');
  return entry.hidden === 'episodes' ? t('trackerTitle.hiddenAfter', { progress: entry.progress }) : t('trackerTitle.hiddenTitle');
});
</script>

<template>
  <!-- `.stop` on the button: the card toggles on any click that is not on a link or button. -->
  <p
    v-if="status"
    data-testid="media-tracker-status"
    class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-ink-muted"
  >
    <UiBaseIcon :path="trackerIconPath(provider)" size="12" class="shrink-0" aria-hidden="true" />
    <span data-testid="media-tracker-state">{{ t(`trackerTitle.status.${status.status}`) }}</span>
    <template v-if="progressLabel">
      <span aria-hidden="true">·</span>
      <span>{{ progressLabel }}</span>
    </template>
    <template v-if="hiddenLabel">
      <span aria-hidden="true">·</span>
      <UiBaseIcon
        :path="status.unlocked ? mdiShieldOffOutline : mdiShieldCheckOutline"
        size="12"
        class="shrink-0"
        :class="status.unlocked ? '' : 'text-brand'"
        aria-hidden="true"
      />
      <span data-testid="media-tracker-hidden">{{ hiddenLabel }}</span>
      <button
        type="button"
        data-testid="media-tracker-unlock"
        class="font-semibold text-ink underline-offset-2 hover:underline"
        @click.stop="setTitleUnlocked(media.publicId, !status.unlocked)"
      >
        {{ status.unlocked ? t('trackerTitle.hide') : t('trackerTitle.show') }}
      </button>
    </template>
  </p>
</template>
