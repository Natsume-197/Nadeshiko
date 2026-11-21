<script setup lang="ts">
import {
  mdiArrowLeft,
  mdiPlaylistPlay,
  mdiRepeat,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiSkipPrevious,
  mdiTune,
} from '@mdi/js';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { PLAYBACK_RATES, REPEAT_TIMES, SHADOW_GAPS, usePlayerStore, type ShadowGap } from '~/stores/player';
import { escapeCorpusText, segmentTextHtml } from '~/utils/safeHighlight';
import { usePlayerLabels } from '~/composables/usePlayerLabels';
import PlayerSeekIcon from './SeekIcon.vue';
import PlayerVolumeSlider from './VolumeSlider.vue';

/**
 * Listening mode: one sentence at a time, for shadowing. Built from the search page's own parts so it
 * reads as Nadeshiko rather than as a separate app: the theme's surfaces, the result card's
 * translation rows and spoilers, the EN / ES / ふ visibility controls, and the floating player's card
 * for the transport.
 *
 * Hierarchy, top to bottom: the sentence, its translation, the transport. Practice settings (speed,
 * gap, repeats) are set once per session, so they sit in a menu rather than on screen.
 *
 * The keyboard belongs to `AudioPlayer`, which opens this; the practice settings live in the player
 * store, which applies them only while this is open.
 */
const props = defineProps<{
  /** 0..100, from the player's own progress loop. */
  progress: number;
  seekStep: number;
  showVolume: boolean;
}>();

const emit = defineEmits<{
  seek: [delta: number];
  seekTo: [fraction: number];
}>();

const { t } = useI18n();
const { mediaName } = useMediaName();
const playerStore = usePlayerStore();
const {
  currentResult,
  currentIndex,
  playlist,
  isPlaying,
  isBuffering,
  autoplay,
  repeat,
  playbackRate,
  shadowGap,
  repeatTimes,
  timesPlayed,
  gap,
} = storeToRefs(playerStore);

const { modeFor } = useTranslationVisibility();
const { withKey, playLabel } = usePlayerLabels();
const { languages: translationLanguages } = useTranslationLanguages();

const imageUrl = computed(() => currentResult.value?.segment.urls.imageUrl ?? '');

const position = computed(() =>
  currentIndex.value === null ? '' : t('player.listening.position', { current: currentIndex.value + 1, total: playlist.value.length }),
);

const tokens = computed(() => (currentResult.value?.segment.textJa as { tokens?: unknown[] } | undefined)?.tokens);

const japaneseHtml = computed(() => segmentTextHtml(currentResult.value?.segment.textJa));

/**
 * The translation rows exactly as a result card has them: the reader's languages in their order,
 * each shown, behind a spoiler, or left out, per the EN / ES control in the header. A spoiler is what
 * shadowing wants -- listen first, check after -- so it needs no setting of its own here.
 */
const revealed = ref(new Set<string>());

const translations = computed(() => {
  const segment = currentResult.value?.segment;
  if (!segment) return [];
  return translationLanguages.value
    .map((language) => {
      const mode = modeFor(language);
      const text = language === 'EN' ? segment.textEn : segment.textEs;
      const spoiler = mode === 'spoiler' && !revealed.value.has(language);
      return {
        language,
        mode,
        spoiler,
        // A spoiler never shows the highlight, as on the card: the red would give the word away.
        html: spoiler ? escapeCorpusText(text?.content ?? '') : segmentTextHtml(text),
        empty: !text?.content,
      };
    })
    .filter((row) => row.mode !== 'hidden' && !row.empty);
});

const toggleReveal = (language: string) => {
  const next = new Set(revealed.value);
  if (next.has(language)) next.delete(language);
  else next.add(language);
  revealed.value = next;
};

// A new sentence comes in behind its spoilers again.
watch(
  () => currentResult.value?.segment.publicId,
  () => {
    revealed.value = new Set();
  },
);

/** T lifts every spoiler on the sentence, or puts them back. The player's own keys never use T. */
const onKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.code !== 'KeyT') return;
  const spoilers = translations.value.filter((row) => row.mode === 'spoiler');
  if (!spoilers.length) return;
  event.preventDefault();
  const anyHidden = spoilers.some((row) => row.spoiler);
  revealed.value = anyHidden ? new Set(spoilers.map((row) => row.language)) : new Set();
};

const exitButton = ref<HTMLButtonElement | null>(null);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  // Into the dialog, so Tab walks its controls rather than the page behind it.
  exitButton.value?.focus();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

const onProgressClick = (event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  emit('seekTo', (event.clientX - rect.left) / rect.width);
};

/**
 * The reader's turn, drawn as a ring filling round the play button for the length of the gap: the
 * one place their eyes already are, and no words needed. Keyed so two gaps in a row both restart it.
 */
const RING_RADIUS = 27;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const gapKey = computed(() => gap.value?.startedAt ?? 0);

/** One dot per play of the sentence, filled as they go. Only when it plays more than once. */
const playDots = computed(() => {
  if (repeat.value || repeatTimes.value <= 1) return [];
  const done = Math.min(timesPlayed.value + 1, repeatTimes.value);
  return Array.from({ length: repeatTimes.value }, (_, i) => i < done);
});

const playDotsLabel = computed(() =>
  playDots.value.length
    ? t('player.listening.playCount', { current: playDots.value.filter(Boolean).length, total: playDots.value.length })
    : '',
);

const gapLabel = (value: ShadowGap) =>
  value === 0 ? t('player.listening.gapNone') : value === 'auto' ? t('player.listening.gapAuto') : t('player.listening.seconds', { n: value });

type Option = { key: string; label: string; active: boolean; select: () => void; title?: string };

/** The practice settings, as the segmented control the title filter uses for its own order. */
const practiceGroups = computed<{ id: string; label: string; options: Option[] }[]>(() => [
  {
    id: 'speed',
    label: t('player.listening.speed'),
    options: PLAYBACK_RATES.map((rate) => ({
      key: String(rate),
      label: `${rate}×`,
      active: playbackRate.value === rate,
      select: () => playerStore.setPlaybackRate(rate),
    })),
  },
  {
    id: 'gap',
    label: t('player.listening.gap'),
    options: SHADOW_GAPS.map((value) => ({
      key: String(value),
      label: gapLabel(value),
      active: shadowGap.value === value,
      select: () => playerStore.setShadowGap(value),
      title: value === 'auto' ? t('player.listening.gapAutoHint') : undefined,
    })),
  },
  {
    id: 'repeat',
    label: t('player.listening.repeat'),
    options: [
      ...REPEAT_TIMES.map((value) => ({
        key: String(value),
        label: `${value}×`,
        active: !repeat.value && repeatTimes.value === value,
        select: () => playerStore.setRepeatTimes(value),
      })),
      {
        key: 'forever',
        label: '∞',
        active: repeat.value,
        select: () => playerStore.setRepeatTimes('forever'),
        title: t('player.listening.repeatForever'),
      },
    ],
  },
]);

/** Marks the practice button while anything differs from plain playback, so a set gap is never a mystery. */
const isPracticeTuned = computed(() => shadowGap.value !== 0 || repeatTimes.value !== 1 || repeat.value || playbackRate.value !== 1);
</script>

<template>
  <div
    v-if="currentResult"
    data-testid="listening-mode"
    role="dialog"
    aria-modal="true"
    :aria-label="t('player.listening.title')"
    class="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-background text-ink"
  >
    <!-- Laid out like the search page's tab row: what this is on the left, the reading
         controls on the right, a hairline underneath. -->
    <header class="flex h-14 shrink-0 items-center gap-3 border-b border-b-line-subtle px-4 md:px-8">
      <button
        ref="exitButton"
        type="button"
        class="nd-btn size-8 p-0"
        :aria-label="t('player.listening.exit')"
        :title="withKey(t('player.listening.exit'), 'F')"
        aria-keyshortcuts="F"
        @click="playerStore.toggleImmersive()"
      >
        <UiBaseIcon :path="mdiArrowLeft" w="w-4" h="h-4" size="16" />
      </button>
      <p lang="ja" class="min-w-0 flex-1 truncate text-sm font-semibold">{{ mediaName(currentResult.media) }}</p>
      <span v-if="position" data-testid="listening-position" class="shrink-0 text-xs tabular-nums text-ink-faint">{{ position }}</span>
      <SearchTranslationVisibilityPreferences class="shrink-0" />
      <SearchDropdownContainer
        dropdown-id="nd-listening-practice"
        teleport
        teleport-align="end"
        dropdown-container-class="z-[60] w-[17rem]"
      >
        <template #default="{ toggle, isOpen }">
          <button
            type="button"
            data-testid="listening-practice-menu"
            class="nd-btn relative size-8 p-0"
            :aria-label="t('player.listening.practice')"
            :title="t('player.listening.practice')"
            aria-haspopup="true"
            :aria-expanded="isOpen"
            @click="toggle"
          >
            <UiBaseIcon :path="mdiTune" w="w-4" h="h-4" size="16" />
            <span v-if="isPracticeTuned" class="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-brand-solid" aria-hidden="true" />
          </button>
        </template>
        <template #content>
          <div data-nd-keep-open data-testid="listening-practice" class="pb-1">
            <template v-for="group in practiceGroups" :key="group.id">
              <p class="nd-menu-header">{{ group.label }}</p>
              <fieldset class="mx-2 mb-1.5 flex gap-0.5 rounded-md border border-hairline p-0.5 text-xs">
                <legend class="sr-only">{{ group.label }}</legend>
                <button
                  v-for="option in group.options"
                  :key="option.key"
                  type="button"
                  :data-testid="`listening-${group.id}-${option.key}`"
                  class="flex-1 rounded px-1.5 py-1 tabular-nums transition-colors motion-reduce:transition-none"
                  :class="option.active ? 'bg-control-hover font-semibold text-ink shadow-sm' : 'text-ink-faint hover:text-ink'"
                  :aria-pressed="option.active"
                  :title="option.title"
                  @click="option.select()"
                >
                  {{ option.label }}
                </button>
              </fieldset>
            </template>
          </div>
        </template>
      </SearchDropdownContainer>
    </header>

    <main class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 py-6 md:px-8">
      <img
        v-if="imageUrl"
        :src="imageUrl"
        :alt="`Cover art for ${mediaName(currentResult.media)}`"
        class="block max-h-[34vh] w-auto max-w-full rounded-lg border border-hairline object-contain"
      />

      <div class="flex w-full max-w-3xl flex-col items-center gap-3">
        <h2 lang="ja" data-testid="listening-sentence" class="listening-sentence text-center text-2xl leading-relaxed md:text-3xl">
          <SearchSegmentTokenText v-if="tokens" :tokens="tokens as never" :highlight="currentResult.segment.textJa.highlight" :result="currentResult" />
          <span v-else v-html="japaneseHtml" />
        </h2>

        <!-- The result card's translation rows: badge, text, spoiler. -->
        <ul v-if="translations.length" class="m-0 flex list-none flex-col items-center gap-1.5 p-0">
          <li v-for="row in translations" :key="row.language" data-testid="listening-translation" class="flex items-center gap-2 text-base md:text-lg">
            <span class="inline-flex w-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-control px-2.5 py-1.5 text-[11px] font-semibold leading-none tracking-wide text-ink-muted">
              {{ row.language }}
            </span>
            <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: spoiler reveal; T does it from the keyboard -->
            <span
              class="group/translation"
              :class="row.mode === 'spoiler' ? 'cursor-pointer' : ''"
              :title="row.mode === 'spoiler' ? withKey(t('player.listening.reveal'), 'T') : undefined"
              @click="row.mode === 'spoiler' && toggleReveal(row.language)"
            >
              <span
                class="inline rounded-sm px-1 py-1 leading-snug transition-colors duration-200"
                :class="row.spoiler
                  ? 'nd-translation-spoiler bg-neutral-700/85 text-transparent [@media(hover:hover)]:group-hover/translation:bg-transparent [@media(hover:hover)]:group-hover/translation:text-ink-muted'
                  : 'text-ink-muted'"
                v-html="row.html"
              />
            </span>
          </li>
        </ul>

        <div v-if="playDots.length" class="flex items-center gap-1.5 pt-1" role="img" :aria-label="playDotsLabel" data-testid="listening-play-dots">
          <span v-for="(done, i) in playDots" :key="i" class="size-1.5 rounded-full" :class="done ? 'bg-ink-muted' : 'bg-[var(--line)]'" />
        </div>
      </div>
    </main>

    <!-- The floating player's card, a size up: the same controls in the same order, so nothing
         has to be learnt twice. -->
    <footer class="safe-pb mx-auto w-full max-w-3xl shrink-0 px-4 pb-4 md:px-8 md:pb-8">
      <div class="relative rounded-lg border border-hairline bg-button-primary-main shadow-xl shadow-black/20">
        <div class="pointer-events-none absolute inset-0 z-10 overflow-hidden rounded-[inherit]">
          <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: preserve pointer-only seeking -->
          <div class="group pointer-events-auto absolute inset-x-0 top-0 h-2 cursor-pointer" @click="onProgressClick">
            <div class="h-0.5 bg-[var(--line-subtle)] transition-all group-hover:h-1.5">
              <div class="h-full bg-brand-solid transition-all ease-linear" :style="{ width: `${props.progress}%` }" />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pb-3 pt-4">
          <div aria-hidden="true" />

          <div class="flex items-center gap-1 md:gap-2">
            <button
              type="button"
              class="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-hover"
              :class="autoplay ? 'text-brand' : 'text-ink-muted hover:text-ink'"
              :aria-pressed="autoplay"
              :aria-label="t('player.controls.autoplay')"
              :title="withKey(t('player.controls.autoplay'), 'L')"
              aria-keyshortcuts="L"
              @click="playerStore.toggleAutoplay()"
            >
              <UiBaseIcon :path="mdiPlaylistPlay" :size="24" />
            </button>
            <button type="button" class="hidden size-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink sm:inline-flex" :aria-label="t('player.controls.rewind')" :title="t('player.controls.rewind')" @click="emit('seek', -props.seekStep)">
              <PlayerSeekIcon direction="back" :seconds="props.seekStep" :size="24" />
            </button>
            <button type="button" class="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink" :aria-label="t('player.controls.previous')" :title="withKey(t('player.controls.previous'), '←')" aria-keyshortcuts="ArrowLeft" @click="playerStore.prev()">
              <UiBaseIcon :path="mdiSkipPrevious" :size="24" />
            </button>
            <div class="relative mx-1 flex size-14 items-center justify-center">
              <svg v-if="gap" :key="gapKey" class="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 56 56" aria-hidden="true" data-testid="listening-gap">
                <circle cx="28" cy="28" :r="RING_RADIUS" fill="none" stroke="var(--line)" stroke-width="2" />
                <circle
                  class="listening-ring"
                  cx="28"
                  cy="28"
                  :r="RING_RADIUS"
                  fill="none"
                  stroke="rgb(var(--c-brand-solid))"
                  stroke-width="2"
                  stroke-linecap="round"
                  :stroke-dasharray="RING_LENGTH"
                  :style="{ '--ring-length': RING_LENGTH, animationDuration: `${gap.ms}ms` }"
                />
              </svg>
              <button
                type="button"
                class="flex size-11 items-center justify-center rounded-full bg-ink text-background transition-transform hover:scale-105"
                :aria-label="playLabel"
                :title="withKey(playLabel, t('player.controls.spaceKey'))"
                aria-keyshortcuts="Space"
                :aria-busy="isBuffering"
                @click="playerStore.togglePlay()"
              >
                <span v-if="isBuffering" class="nd-ring-spinner size-5" aria-hidden="true" />
                <UiBaseIcon v-else :path="isPlaying ? mdiPause : mdiPlay" :size="24" />
              </button>
            </div>
            <button type="button" class="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink" :aria-label="t('player.controls.next')" :title="withKey(t('player.controls.next'), '→')" aria-keyshortcuts="ArrowRight" @click="playerStore.next()">
              <UiBaseIcon :path="mdiSkipNext" :size="24" />
            </button>
            <button type="button" class="hidden size-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink sm:inline-flex" :aria-label="t('player.controls.forward')" :title="t('player.controls.forward')" @click="emit('seek', props.seekStep)">
              <PlayerSeekIcon direction="forward" :seconds="props.seekStep" :size="24" />
            </button>
            <button
              type="button"
              class="inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-hover"
              :class="repeat ? 'text-brand' : 'text-ink-muted hover:text-ink'"
              :aria-pressed="repeat"
              :aria-label="t('player.controls.repeat')"
              :title="t('player.controls.repeat')"
              @click="playerStore.toggleRepeat()"
            >
              <UiBaseIcon :path="mdiRepeat" :size="24" />
            </button>
          </div>

          <div class="flex items-center justify-end">
            <PlayerVolumeSlider v-if="props.showVolume" class="hidden w-20 sm:block" />
          </div>
        </div>
      </div>
      <p class="sr-only" aria-live="polite">{{ gap ? t('player.listening.yourTurn') : '' }}</p>
    </footer>
  </div>
</template>

<style scoped>
/* The searched word in the brand colour, as on the result cards. */
.listening-sentence :deep(em) {
  font-style: normal;
  color: rgb(var(--c-brand));
}

.listening-ring {
  stroke-dashoffset: calc(var(--ring-length) * 1px);
  animation-name: listening-ring;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes listening-ring {
  to {
    stroke-dashoffset: 0;
  }
}
</style>
