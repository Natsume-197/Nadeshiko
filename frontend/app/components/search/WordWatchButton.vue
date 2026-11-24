<script setup lang="ts">
import { mdiBellOutline, mdiBellRing, mdiBellPlusOutline } from '@mdi/js';
import { useWordWatches, wordWatchErrorKey, type WordWatch, type WordWatchMatchMode, type WordWatchMode } from '~/composables/useWordWatches';
import { apiErrorStatus } from '~/utils/apiError';

/**
 * The word-alert button on a search (task 52). `FIRST` is the full-width card on an empty search ("Notify me when it
 * appears"); `NEW_SENTENCES` is the small chip in the word entry ("Follow this word"). Signed out, it opens sign-in.
 * Pressing it again removes the alert.
 */
const props = withDefaults(
  defineProps<{
    query: string;
    mode: WordWatchMode;
    matchMode?: WordWatchMatchMode;
  }>(),
  { matchMode: 'WORD' },
);

const { t } = useI18n();
const { formatNumber } = useFormat();
const store = userStore();
const { openLoginModal } = useLoginModal();
const watches = useWordWatches();

const current = ref<WordWatch | null>(null);
const busy = ref(false);
/** Set after following a word the API calls very common: how many sentences it already has, for the warning line. */
const commonCount = ref<number | null>(null);

const isOn = computed(() => current.value?.status === 'ACTIVE' && current.value.mode === props.mode);

async function loadState() {
  current.value = null;
  commonCount.value = null;
  if (!store.isLoggedIn || !props.query) return;
  try {
    current.value = await watches.check(props.query, props.matchMode);
  } catch {
    // Without the state the button still works: pressing it sets the alert.
  }
}

onMounted(loadState);
watch(() => [props.query, props.matchMode, store.isLoggedIn], loadState);

async function toggle() {
  if (!store.isLoggedIn) {
    openLoginModal('word_alert');
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    if (isOn.value && current.value) {
      await watches.remove(current.value.id);
      current.value = null;
      commonCount.value = null;
      return;
    }
    const result = await watches.set(props.query, props.mode, props.matchMode);
    current.value = result.watch;
    commonCount.value = result.commonWord ? result.sentenceCount : null;
    usePostHog()?.capture('word_alert_set', { mode: props.mode, match_mode: props.matchMode });
  } catch (caught) {
    useToastError(t(wordWatchErrorKey(apiErrorStatus(caught), props.mode)));
  } finally {
    busy.value = false;
  }
}

const label = computed(() => {
  if (props.mode === 'FIRST') return isOn.value ? t('notifications.watch.notifyOn') : t('notifications.watch.notify');
  return isOn.value ? t('notifications.watch.following') : t('notifications.watch.follow');
});
</script>

<template>
  <div v-if="mode === 'FIRST'" class="mt-4 w-full" data-testid="word-watch-card">
    <button
      type="button"
      class="flex w-full items-center gap-3.5 rounded-xl bg-surface px-5 py-4 text-left transition-colors hover:bg-surface-hover disabled:opacity-60"
      :aria-pressed="isOn"
      :disabled="busy"
      data-testid="word-watch-button"
      @click="toggle"
    >
      <UiBaseIcon
        :path="isOn ? mdiBellRing : mdiBellPlusOutline"
        :size="26"
        w="w-[26px]"
        h="h-[26px]"
        class="shrink-0 text-brand"
        aria-hidden="true"
      />
      <span class="text-sm font-semibold text-white">{{ label }}</span>
    </button>
  </div>

  <span v-else class="word-watch-chip-wrap">
    <button
      type="button"
      class="word-watch-chip"
      :class="{ 'is-on': isOn }"
      :aria-pressed="isOn"
      :disabled="busy"
      data-testid="word-watch-button"
      @click="toggle"
    >
      <UiBaseIcon :path="isOn ? mdiBellRing : mdiBellOutline" :size="13" w="w-[13px]" h="h-[13px]" aria-hidden="true" />
      {{ label }}
    </button>
    <span v-if="commonCount" class="word-watch-common" role="status">
      {{ $t('notifications.watch.commonWarning', { word: query, count: formatNumber(commonCount) }) }}
    </span>
  </span>
</template>

<style scoped>
.word-watch-chip-wrap {
  display: inline-block;
}

/* Same shape as the word entry's badges (SearchWordEntry.vue), which are scoped there. */
.word-watch-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 2px 8px;
  border: 0;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
  background: color-mix(in srgb, var(--ink) 10%, var(--surface));
  color: var(--ink-muted);
}

.word-watch-chip:hover {
  color: var(--ink);
}

.word-watch-chip.is-on {
  background: color-mix(in srgb, var(--accent-soft) 18%, var(--surface));
  color: var(--accent-soft);
}

.word-watch-chip:disabled {
  opacity: 0.6;
  cursor: default;
}

.word-watch-common {
  display: block;
  margin-top: 0.35rem;
  font-size: 0.75rem;
  color: var(--ink-muted, #a8a8a8);
}
</style>
