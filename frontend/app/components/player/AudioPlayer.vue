<script setup lang="ts">
import {
  mdiSkipPrevious,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiPlaylistPlay,
  mdiRepeat,
  mdiClose,
  mdiHeadphones,
  mdiCogOutline,
  mdiCheck,
  mdiVolumeHigh,
  mdiVolumeMedium,
  mdiVolumeLow,
  mdiVolumeOff,
} from '@mdi/js';
import { PLAYBACK_RATES, resolveClipWindow, usePlayerStore } from '~/stores/player';
import { splitLocalePrefix } from '~/utils/routes';
import { usePlayerBarHeight } from '~/composables/usePlayerAnchor';
import PlayerSeekIcon from './SeekIcon.vue';
import PlayerListeningMode from './ListeningMode.vue';
import PlayerVolumeSlider from './VolumeSlider.vue';
import { usePlayerLabels } from '~/composables/usePlayerLabels';
import { watch, ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { onClickOutside, useMediaQuery, useResizeObserver } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { segmentTextHtml } from '~/utils/safeHighlight';

const route = useRoute();

const { t } = useI18n();
const playerStore = usePlayerStore();
const ytPlayer = useYoutubeSegmentPlayer();
const { mediaName } = useMediaName();
const {
  currentResult,
  isPlaying,
  isBuffering,
  showPlayer,
  autoplay,
  repeat,
  isImmersive,
  currentAudio,
  volume,
  playbackRate,
} = storeToRefs(playerStore);

const { scrollBehavior } = useMotionPreference();
const { openDropdownId, isTokenTooltipOpen } = useDropdownState();

const progress = ref(0);
const animationFrameId = ref<number | null>(null);
let lastScrollTime = 0;

const handleGlobalKeydown = (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  if (!showPlayer.value) return;

  // This window capture handler runs before menu buttons. Roles identify keys that must reach their own
  // controls. Keep Escape available for the player's innermost layer rather than returning early for every
  // key.
  // `.nd-menu` too: listening mode's practice panel is a menu of toggle buttons, not of menu items, and
  // its Escape must close the panel rather than leave listening mode under it.
  const inMenu = target.closest('[role="menu"], .nd-menu') !== null;
  const opensMenu = target.closest('[aria-haspopup="menu"]') !== null;

  // Disable shortcuts inside menus except Escape for our open speed menu. Layout-changing shortcuts would
  // unmount the focused item; taking another menu's Escape would hide the player before that menu could
  // dismiss itself.
  if (inMenu && !(event.code === 'Escape' && rateMenuOpen.value)) return;

  switch (event.code) {
    case 'Space':
      // Not `inMenu` -- that is handled above. This is the trigger itself,
      // which needs Space to open the menu it owns. Capturing it here meant the
      // speed button answered Space by toggling playback and never opening.
      if (opensMenu) return;
      event.preventDefault();
      playerStore.togglePlay();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      playerStore.prev();
      break;
    case 'ArrowRight':
      event.preventDefault();
      playerStore.next();
      break;
    case 'KeyR':
      event.preventDefault();
      playerStore.restart();
      break;
    case 'KeyF':
      event.preventDefault();
      playerStore.toggleImmersive();
      break;
    case 'KeyL':
      event.preventDefault();
      playerStore.toggleAutoplay();
      break;
    case 'Escape': {
      // Yield Escape to an open word card or dropdown (e.g. a word card over Listening mode,
      // or Listening mode's Practice/display menus) so Esc always dismisses the innermost layer first.
      if (!rateMenuOpen.value && (openDropdownId.value !== null || isTokenTooltipOpen.value)) return;
      // Before the modal: a player open over Context is a layer on top of
      // the dialog, so the first Escape dismisses it and the next one
      // closes the dialog. Immersive is a layer on the player, and the speed
      // menu is a layer on both -- innermost first, so Escape never closes
      // something the reader can still see an open menu in front of.
      event.preventDefault();
      event.stopPropagation();
      if (rateMenuOpen.value) rateMenuOpen.value = false;
      else if (isImmersive.value) playerStore.toggleImmersive();
      else playerStore.hidePlayer();
      break;
    }
  }
};

watch(
  () => route.path,
  (newPath) => {
    const { localizedPath } = splitLocalePrefix(newPath);
    if (showPlayer.value && !localizedPath.startsWith('/search') && !localizedPath.startsWith('/sentence')) {
      playerStore.hidePlayer();
    }
  },
);

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown, true);
});

const waitForElement = async (selector: string, retries = 5, delay = 100) => {
  for (let i = 0; i < retries; i++) {
    const element = document.getElementById(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
};

const scrollMainView = async () => {
  const now = Date.now();
  const timeSinceLastScroll = now - lastScrollTime;
  lastScrollTime = now;
  const behavior = timeSinceLastScroll < 300 ? 'instant' : scrollBehavior();

  const result = currentResult.value;
  if (!result) return;

  const mainPageElement = await waitForElement(result.segment.publicId);
  if (mainPageElement) {
    mainPageElement.scrollIntoView({ behavior, block: 'center' });
  }
};

const animationLoop = () => {
  if (!playerStore.currentAudio) return;
  updateProgress();
  animationFrameId.value = requestAnimationFrame(animationLoop);
};

const startProgressAnimation = () => {
  if (animationFrameId.value) {
    cancelAnimationFrame(animationFrameId.value);
  }
  animationFrameId.value = requestAnimationFrame(animationLoop);
};

const stopProgressAnimation = () => {
  if (animationFrameId.value) {
    cancelAnimationFrame(animationFrameId.value);
    animationFrameId.value = null;
  }
};

const onAudioEnded = () => {
  stopProgressAnimation();
  if (!repeat.value) {
    progress.value = 100;
  }
};

const SEEK_STEP = 1;

const isYoutubeActive = () => currentResult.value?.media.category === 'YOUTUBE';

const seek = (delta: number) => {
  const result = currentResult.value;
  if (isYoutubeActive() && result) {
    // Read through the resolver, not off the segment: the step is a fraction of
    // the clip, so on an expanded segment the segment's own span would move the
    // playhead by the wrong amount in both directions.
    const clip = resolveClipWindow(result);
    const span = (clip.endMs - clip.startMs) / 1000;
    if (span <= 0) return;
    const next = Math.min(Math.max(ytPlayer.clipProgress.value + delta / span, 0), 1);
    ytPlayer.seekToClipFraction(next);
    return;
  }
  const audio = playerStore.currentAudio;
  if (!audio || Number.isNaN(audio.duration)) return;

  const nextTime = Math.min(Math.max(audio.currentTime + delta, 0), audio.duration);

  audio.currentTime = nextTime;
  updateProgress();
};

const seekBackward = () => seek(-SEEK_STEP);
const seekForward = () => seek(SEEK_STEP);

/** Bring the playing sentence back into view, for a reader who scrolled away from it. */
const showCurrentSentence = () => {
  scrollMainView();
};

const { withKey, playLabel } = usePlayerLabels();
const spaceKey = computed(() => t('player.controls.spaceKey'));

/**
 * Media Session: hardware media keys, headphone buttons and the OS media panel (lock screen,
 * notification shade) drive the same store actions as the bar, and show the sentence and its cover.
 *
 * Only meaningful for our own `<audio>`: a YouTube clip plays inside its iframe, which owns its own
 * session, so ours steps aside while one is on. Cleared when the player closes, or the OS keeps
 * offering controls for a player that is gone.
 */
const hasMediaSession = () => import.meta.client && typeof navigator !== 'undefined' && 'mediaSession' in navigator;

const MEDIA_SESSION_ACTIONS: [MediaSessionAction, MediaSessionActionHandler][] = [
  ['play', () => playerStore.play()],
  ['pause', () => playerStore.pause()],
  ['previoustrack', () => playerStore.prev()],
  ['nexttrack', () => playerStore.next()],
  ['seekbackward', (details) => seek(-(details.seekOffset ?? SEEK_STEP))],
  ['seekforward', (details) => seek(details.seekOffset ?? SEEK_STEP)],
  ['stop', () => playerStore.hidePlayer()],
];

const setMediaSessionHandlers = (active: boolean) => {
  for (const [action, handler] of MEDIA_SESSION_ACTIONS) {
    // Browsers throw on actions they do not support rather than ignoring them.
    try {
      navigator.mediaSession.setActionHandler(action, active ? handler : null);
    } catch {
      // Unsupported action: nothing to register.
    }
  }
};

const clearMediaSession = () => {
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  setMediaSessionHandlers(false);
};

const syncMediaSession = () => {
  if (!hasMediaSession()) return;
  const result = currentResult.value;
  if (!showPlayer.value || !result || isYoutubeActive()) {
    clearMediaSession();
    return;
  }

  const imageUrl = getAnimeImage(result);
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: result.segment.textJa.content,
      artist: mediaName(result.media),
      album: 'Nadeshiko',
      artwork: imageUrl ? [{ src: imageUrl }] : [],
    });
  } catch {
    // An artwork url the browser refuses must not take the controls down with it.
    navigator.mediaSession.metadata = null;
  }
  setMediaSessionHandlers(true);
};

watch([currentResult, showPlayer], syncMediaSession);

watch([isPlaying, showPlayer], () => {
  if (!hasMediaSession() || !showPlayer.value || isYoutubeActive()) return;
  navigator.mediaSession.playbackState = isPlaying.value ? 'playing' : 'paused';
});

onMounted(syncMediaSession);

onBeforeUnmount(() => {
  if (hasMediaSession()) clearMediaSession();
});

const seekToPercent = (percent: number) => {
  if (isYoutubeActive()) {
    ytPlayer.seekToClipFraction(percent);
    return;
  }
  const audio = playerStore.currentAudio;
  if (!audio || Number.isNaN(audio.duration)) return;

  const clamped = Math.min(Math.max(percent, 0), 1);
  audio.currentTime = audio.duration * clamped;
  updateProgress();
};

const onProgressClick = (event: MouseEvent) => {
  const target = event.currentTarget as HTMLElement;
  if (!target) return;

  const rect = target.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const percent = clickX / rect.width;

  seekToPercent(percent);
};

watch(
  currentAudio,
  (newAudio, oldAudio) => {
    if (oldAudio) {
      oldAudio.removeEventListener('play', startProgressAnimation);
      oldAudio.removeEventListener('pause', stopProgressAnimation);
      oldAudio.removeEventListener('ended', onAudioEnded);
    }
    if (newAudio) {
      progress.value = 0;
      newAudio.addEventListener('play', startProgressAnimation);
      newAudio.addEventListener('pause', stopProgressAnimation);
      newAudio.addEventListener('ended', onAudioEnded);
    }

    if (currentResult.value && oldAudio !== newAudio) {
      nextTick(() => {
        scrollMainView();
      });
    }
  },
  { immediate: false },
);

const updateProgress = () => {
  if (playerStore.currentAudio) {
    const currentTime = playerStore.currentAudio.currentTime;
    const duration = playerStore.currentAudio.duration;
    if (!Number.isNaN(duration) && duration > 0) {
      progress.value = (currentTime / duration) * 100;
    }
  }
};

watch(ytPlayer.clipProgress, (p) => {
  if (currentResult.value && currentResult.value.media.category === 'YOUTUBE') {
    progress.value = p * 100;
  }
});

const getAnimeImage = (result: any) => {
  if (!result) return '';
  return result.segment.urls.imageUrl;
};

/**
 * Where the bar lives: fixed across the whole window at its bottom edge, a classic player bar. The page
 * keeps room for it at its end (a spacer after the footer, in the layout), so the footer scrolls clear of
 * it, and the title filter stops short of it (`usePlayerBarHeight`).
 */

/** The bar's height for the title filter beside it (see `usePlayerBarHeight`): resize-driven, not scroll. */
const barRef = ref<HTMLElement | null>(null);
const playerBarHeight = usePlayerBarHeight();
useResizeObserver(barRef, (entries) => {
  const entry = entries[0];
  if (!entry) return;
  const box = entry.borderBoxSize?.[0];
  playerBarHeight.value = box ? box.blockSize : (entry.target as HTMLElement).offsetHeight;
});
watch(barRef, (el) => {
  if (!el) playerBarHeight.value = 0;
});
onBeforeUnmount(() => {
  playerBarHeight.value = 0;
});

/** Use pointer capability, not viewport width: landscape phones still use hardware volume keys. */
const hasFinePointer = useMediaQuery('(hover: hover) and (pointer: fine)');

/** iOS/iPadOS silently ignore volume assignments, even with a fine pointer. Probe by writing and reading back
 * on mount. SSR has no Audio and omits the slider, so hydration agrees.
 */
const canSetVolume = ref(false);

onMounted(() => {
  try {
    const probe = new Audio();
    probe.volume = 0.5;
    canSetVolume.value = probe.volume === 0.5;
  } catch {
    canSetVolume.value = false;
  }
});

/** Both halves have to hold: usable input, and a volume that actually moves. */
const showVolumeSlider = computed(() => hasFinePointer.value && canSetVolume.value);

const volumeIcon = computed(() => {
  if (volume.value === 0) return mdiVolumeOff;
  if (volume.value < 0.34) return mdiVolumeLow;
  if (volume.value < 0.67) return mdiVolumeMedium;
  return mdiVolumeHigh;
});

const rateMenuOpen = ref(false);
const rateMenuBarRef = ref<HTMLElement | null>(null);

// A hidden player takes its menu with it. Without this the flag survives the
// close -- a route change or Escape hides the bar with the menu still open, and
// the next clip the reader plays brings the player back up with a speed menu
// hanging off it that nobody asked for. Listening mode hides the bar too, and has
// its own speed control.
watch([showPlayer, isImmersive], ([visible, immersive]) => {
  if (!visible || immersive) rateMenuOpen.value = false;
});

onClickOutside(rateMenuBarRef, () => {
  rateMenuOpen.value = false;
});

const rateMenuItems = () => {
  const wrapper = rateMenuBarRef.value;
  return wrapper ? [...wrapper.querySelectorAll<HTMLElement>('[role="menuitemradio"]')] : [];
};

const rateMenuTrigger = () => rateMenuBarRef.value?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;

/** Move focus into the open menu. Restore it only if still inside on close, so outside clicks keep their chosen
 * focus.
 */
watch(rateMenuOpen, async (open) => {
  const trigger = rateMenuTrigger();
  if (open) {
    await nextTick();
    const items = rateMenuItems();
    const checked = items.find((item) => item.getAttribute('aria-checked') === 'true');
    (checked ?? items[0])?.focus();
    return;
  }

  if (rateMenuBarRef.value?.contains(document.activeElement)) trigger?.focus();
});

/** Wrap Arrow/Home/End navigation through speeds; leave Space/Enter activation to the buttons. */
const onRateMenuKeydown = (event: KeyboardEvent) => {
  const items = rateMenuItems();
  if (items.length === 0) return;

  const current = items.indexOf(document.activeElement as HTMLElement);

  const focusAt = (index: number) => {
    event.preventDefault();
    items[(index + items.length) % items.length]?.focus();
  };

  switch (event.code) {
    case 'ArrowDown':
      focusAt(current + 1);
      break;
    case 'ArrowUp':
      focusAt(current - 1);
      break;
    case 'Home':
      focusAt(0);
      break;
    case 'End':
      focusAt(items.length - 1);
      break;
    case 'Tab':
      // Close on Tab, focusing the trigger synchronously before items unmount. Do not prevent Tab: the browser
      // must continue from the trigger to the next control, not restart at body.
      rateMenuTrigger()?.focus();
      rateMenuOpen.value = false;
      break;
  }
};

const selectPlaybackRate = (rate: number) => {
  playerStore.setPlaybackRate(rate);
  rateMenuOpen.value = false;
};
</script>

<template>
        <div v-if="showPlayer && currentResult">

            <transition name="zoom-fade">
                <PlayerListeningMode v-if="isImmersive" :progress="progress" :seek-step="SEEK_STEP"
                    :show-volume="showVolumeSlider" @seek="seek" @seek-to="seekToPercent" />
            </transition>

            <transition name="player-float" appear>
            <div v-if="!isImmersive" ref="barRef" data-testid="player-bar"
                class="fixed inset-x-0 bottom-0 player-surface z-[70] text-ink border-t safe-pb"
                >
                <!-- Clipped by a layer the card's own shape rather than `overflow-hidden` on the
                     card: the speed menu opens upward out of the card and would be cut off. A
                     `rounded-t` on the line itself does not work -- on an element 2px tall the
                     browser scales the radius down to nothing and the corners poke out. -->
                <div class="absolute inset-0 z-10 rounded-[inherit] overflow-hidden pointer-events-none">
                    <!-- Taller than the line so it is easy to hit; the line grows on hover. -->
                    <!-- biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: preserve pointer-only seeking -->
                    <div class="pointer-events-auto absolute inset-x-0 top-0 h-2 group cursor-pointer" @click="onProgressClick">
                        <div class="h-0.5 group-hover:h-1.5 bg-[var(--line-subtle)] transition-all">
                            <div class="bg-brand-solid h-full transition-all ease-linear" :style="{ width: `${progress}%` }"></div>
                        </div>
                    </div>
                </div>
                <!-- What plays here is a line, not a song, so there is no centred transport: the sentence
                     has the left to itself, and every control sits in one block on the right, in three
                     groups -- playing and moving between sentences (the 1s steps on the outside, past previous and next), the
                     modes and speed, the view. -->
                <div class="relative flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 md:px-6">
                    <div class="flex min-w-0 flex-1 basis-60 items-center">
                        <!-- One button for the cover and the text: clicking what is playing brings it back
                         into view. Spans, not paragraphs -- a button only takes phrasing content. -->
                    <button type="button" data-testid="player-show-sentence"
                        class="flex items-center gap-2.5 min-w-0 -my-1 -ml-1 p-1 rounded-md text-left hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                        :title="t('player.controls.showSentence')" @click="showCurrentSentence">
                        <img :src="getAnimeImage(currentResult)"
                            :alt="`Cover art for ${mediaName(currentResult.media)}`"
                            class="w-[45px] h-[45px] shrink-0 object-cover rounded-md bg-surface-hover" />
                        <span class="flex-grow min-w-0">
                            <span lang="ja" data-testid="player-sentence" class="block font-bold text-[17.3px] leading-snug truncate pr-2" v-html="segmentTextHtml(currentResult.segment.textJa)">
                            </span>
                            <span lang="ja" class="block text-[13.5px] leading-tight text-ink-muted truncate">{{ mediaName(currentResult.media) }}</span>
                        </span>
                    </button>
                        <!-- On a phone, close sits up here, away from the transport the thumb works:
                             the one control that ends the session is the one not to hit by accident. -->
                        <button type="button" @click="playerStore.hidePlayer()" data-testid="player-close-compact"
                            class="ml-auto inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors md:hidden"
                            :aria-label="t('player.controls.close')" :title="withKey(t('player.controls.close'), 'Esc')">
                            <UiBaseIcon :path="mdiClose" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                    </div>

                    <!-- On a phone: the transport centred in the thumb's reach, "more" at the right end; the
                         empty first cell keeps the transport centred. -->
                    <div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-1.5 md:flex md:w-auto md:justify-end">
                        <span class="md:hidden" aria-hidden="true" />
                        <div class="flex items-center gap-3 md:gap-1.5">
                        <button type="button" @click="seekBackward" class="size-[40px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors hidden sm:inline-flex" :aria-label="t('player.controls.rewind')" :title="t('player.controls.rewind')">
                            <PlayerSeekIcon direction="back" :seconds="SEEK_STEP" :size="24.5" class="transition-colors" />
                        </button>
                        <button type="button" @click="playerStore.prev()" data-testid="player-prev"
                            class="inline-flex size-[44px] md:size-[40px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                            :aria-label="t('player.controls.previous')" :title="withKey(t('player.controls.previous'), '←')" aria-keyshortcuts="ArrowLeft">
                            <UiBaseIcon :path="mdiSkipPrevious" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                        <button type="button" @click="playerStore.togglePlay()" data-testid="player-play"
                            class="mx-0.5 inline-flex size-[52px] md:size-[40px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                            :aria-label="playLabel" :title="withKey(playLabel, spaceKey)" aria-keyshortcuts="Space" :aria-busy="isBuffering">
                            <span v-if="isBuffering" class="nd-ring-spinner w-[20px] h-[20px]" aria-hidden="true" />
                            <!-- No fill behind it, the same colour as every other control; a size up. -->
                            <UiBaseIcon v-else :path="isPlaying ? mdiPause : mdiPlay" :size="31" w="w-[31px]" h="h-[31px]" />
                        </button>
                        <button type="button" @click="playerStore.next()" data-testid="player-next"
                            class="inline-flex size-[44px] md:size-[40px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                            :aria-label="t('player.controls.next')" :title="withKey(t('player.controls.next'), '→')" aria-keyshortcuts="ArrowRight">
                            <UiBaseIcon :path="mdiSkipNext" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                        <button type="button" @click="seekForward" class="size-[40px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors hidden sm:inline-flex" :aria-label="t('player.controls.forward')" :title="t('player.controls.forward')">
                            <PlayerSeekIcon direction="forward" :seconds="SEEK_STEP" :size="24.5" class="transition-colors" />
                        </button>
                        </div>
                        <span class="mx-2 hidden h-5 w-px bg-[var(--line)] md:block" aria-hidden="true" />
                        <!-- Modes and speed: in the "more" menu below `md`, so a phone shows only what is used
                             all the time. -->
                        <div class="hidden items-center gap-1.5 md:flex">
                        <button type="button" @click="playerStore.toggleAutoplay()" data-testid="player-autoplay"
                            class="inline-flex size-[40px] shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                            :class="{ 'text-brand': autoplay, 'text-ink-muted': !autoplay }"
                            :aria-label="t('player.controls.autoplay')" :title="withKey(t('player.controls.autoplay'), 'L')" aria-keyshortcuts="L" :aria-pressed="autoplay">
                            <UiBaseIcon :path="mdiPlaylistPlay" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                        <button type="button" @click="playerStore.toggleRepeat()" data-testid="player-repeat"
                            class="inline-flex size-[40px] shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                            :class="{ 'text-brand': repeat, 'text-ink-muted': !repeat }"
                            :aria-label="t('player.controls.repeat')" :title="t('player.controls.repeat')" :aria-pressed="repeat">
                            <UiBaseIcon :path="mdiRepeat" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                        <div ref="rateMenuBarRef" class="relative">
                            <button type="button" @click="rateMenuOpen = !rateMenuOpen"
                                class="inline-flex h-[40px] items-center px-2 rounded-full hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors text-xs font-bold tabular-nums"
                                :class="playbackRate === 1 ? 'text-ink-muted' : 'text-brand'"
                                :aria-label="t('player.controls.speed', { rate: playbackRate })" :title="t('player.controls.speed', { rate: playbackRate })"
                                aria-haspopup="menu" :aria-expanded="rateMenuOpen">
                                {{ playbackRate }}×
                            </button>
                            <!-- Opens upward: the player is pinned to the bottom of the viewport, so
                                 a menu below the button would be off-screen. -->
                            <div v-if="rateMenuOpen" role="menu" :aria-label="t('player.controls.speedMenu')"
                                    @keydown="onRateMenuKeydown"
                                class="absolute bottom-full right-0 mb-2 py-1 min-w-[4.5rem] rounded-lg bg-button-primary-main text-ink border border-hairline shadow-xl overflow-hidden">
                                <button type="button" v-for="rate in PLAYBACK_RATES" :key="rate" role="menuitemradio" tabindex="-1"
                                    :aria-checked="playbackRate === rate" @click="selectPlaybackRate(rate)"
                                    class="w-full px-3 py-1.5 text-left text-xs font-bold tabular-nums hover:bg-surface-hover transition-colors"
                                    :class="playbackRate === rate ? 'text-brand' : 'text-ink-muted'">
                                    {{ rate }}×
                                </button>
                            </div>
                        </div>
                        <div v-if="showVolumeSlider" class="flex items-center gap-2 px-1">
                            <UiBaseIcon :path="volumeIcon" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" class="text-ink-muted" />
                            <PlayerVolumeSlider class="w-[81px]" />
                        </div>
                        </div>
                        <span class="mx-2 hidden h-5 w-px bg-[var(--line)] md:block" aria-hidden="true" />
                        <div class="flex items-center justify-end gap-1.5">
                        <button type="button" @click="playerStore.toggleImmersive()" data-testid="player-listening-mode"
                            class="hidden md:inline-flex size-[40px] shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors text-ink-muted hover:text-ink"
                            :aria-label="t('player.listening.enter')" :title="withKey(t('player.listening.enter'), 'F')" aria-keyshortcuts="F">
                            <UiBaseIcon :path="mdiHeadphones" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                        <!-- Below `md`: the less-used controls, behind a settings button instead of a row of buttons. -->
                        <SearchDropdownContainer class="md:hidden" dropdown-id="nd-player-settings" teleport teleport-align="end"
                            dropdown-container-class="z-[80] w-60">
                            <template #default="{ toggle, isOpen }">
                                <button type="button" data-testid="player-settings" @click="toggle"
                                    class="inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors"
                                    :aria-label="t('player.controls.settings')" :title="t('player.controls.settings')"
                                    aria-haspopup="menu" :aria-expanded="isOpen">
                                    <UiBaseIcon :path="mdiCogOutline" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                                </button>
                            </template>
                            <template #content>
                                <div data-nd-keep-open data-testid="player-settings-menu" class="pb-1">
                                    <button type="button" class="nd-menu-item" :aria-pressed="autoplay" @click="playerStore.toggleAutoplay()">
                                        <UiBaseIcon :path="mdiPlaylistPlay" w="w-4" h="h-4" size="16" aria-hidden="true" />
                                        <span class="flex-1 text-left">{{ t('player.controls.autoplay') }}</span>
                                        <UiBaseIcon v-if="autoplay" :path="mdiCheck" w="w-3.5" h="h-3.5" size="14" class="text-accent-soft" aria-hidden="true" />
                                    </button>
                                    <button type="button" class="nd-menu-item" :aria-pressed="repeat" @click="playerStore.toggleRepeat()">
                                        <UiBaseIcon :path="mdiRepeat" w="w-4" h="h-4" size="16" aria-hidden="true" />
                                        <span class="flex-1 text-left">{{ t('player.controls.repeat') }}</span>
                                        <UiBaseIcon v-if="repeat" :path="mdiCheck" w="w-3.5" h="h-3.5" size="14" class="text-accent-soft" aria-hidden="true" />
                                    </button>
                                    <p class="nd-menu-header">{{ t('player.controls.speedMenu') }}</p>
                                    <fieldset class="mx-2 mb-1.5 flex gap-0.5 rounded-md border border-hairline p-0.5 text-xs">
                                        <legend class="sr-only">{{ t('player.controls.speedMenu') }}</legend>
                                        <button v-for="rate in PLAYBACK_RATES" :key="rate" type="button"
                                            class="flex-1 rounded px-1.5 py-1 tabular-nums transition-colors motion-reduce:transition-none"
                                            :class="playbackRate === rate ? 'bg-control-hover font-semibold text-ink shadow-sm' : 'text-ink-faint hover:text-ink'"
                                            :aria-pressed="playbackRate === rate" @click="playerStore.setPlaybackRate(rate)">
                                            {{ rate }}×
                                        </button>
                                    </fieldset>
                                    <div class="nd-menu-divider" />
                                    <button type="button" class="nd-menu-item" @click="playerStore.toggleImmersive()">
                                        <UiBaseIcon :path="mdiHeadphones" w="w-4" h="h-4" size="16" aria-hidden="true" />
                                        <span class="flex-1 text-left">{{ t('player.listening.enter') }}</span>
                                    </button>
                                </div>
                            </template>
                        </SearchDropdownContainer>
                        <button type="button" @click="playerStore.hidePlayer()" data-testid="player-close"
                            class="hidden md:inline-flex size-[40px] shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] transition-colors text-ink-muted hover:text-ink"
                            :aria-label="t('player.controls.close')" :title="withKey(t('player.controls.close'), 'Esc')" aria-keyshortcuts="Escape">
                            <UiBaseIcon :path="mdiClose" :size="24.5" w="w-[24.5px]" h="h-[24.5px]" />
                        </button>
                        </div>
                    </div>
                </div>
            </div>
            </transition>
        </div>
</template>

<style scoped>
/*
 * A step below the page (`--background` darkened), where the title filter beside it is a step above:
 * the two read as different pieces, the bar sunk rather than raised. Built from the theme's own
 * background, so light and custom themes get a darker shade of theirs. Opaque, so the results
 * scrolling underneath do not show through.
 */
.player-surface {
  background: color-mix(in srgb, var(--background) 82%, black);
  border-color: var(--line);
}

/* The bar slides up into place from the bottom edge. */
.player-float-enter-active,
.player-float-leave-active {
  transition:
    opacity 200ms ease,
    translate 250ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.player-float-enter-from,
.player-float-leave-to {
  opacity: 0;
  translate: 0 1rem;
}

@media (prefers-reduced-motion: reduce) {
  .player-float-enter-active,
  .player-float-leave-active {
    transition: opacity 150ms ease;
  }

  .player-float-enter-from,
  .player-float-leave-to {
    translate: none;
  }
}
</style>
