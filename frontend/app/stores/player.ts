import { defineStore } from 'pinia';
import type { ClipWindow, SearchResult } from '~/types/search';
import { trackPlayActivity } from '~/utils/playActivity';
import { reportError } from '~/utils/reportError';
import { firstNonBlank } from '~/utils/strings';

function isYoutube(result: SearchResult | null): boolean {
  return !!result && result.media.category === 'YOUTUBE' && !!result.segment.externalVideoId;
}

/**
 * Resolve on every play: expansion or revert can change the audio source after the element was
 * built.
 */
export function resolveAudioSource(result: SearchResult): string {
  return result.blobAudioUrl ?? result.segment.urls.audioUrl;
}

/**
 * Resolve the clip window on every play. Expansions update expandedWindow, not the segment's
 * original timestamps.
 */
export function resolveClipWindow(result: SearchResult): ClipWindow {
  return result.expandedWindow ?? { startMs: result.segment.startTimeMs, endMs: result.segment.endTimeMs };
}

/**
 * Drop user-aborted loads and autoplay-policy refusals, but keep decode failures such as
 * NotSupportedError actionable.
 */
export function isUnactionablePlaybackError(error: unknown): boolean {
  // Match the standardized name, not Error or DOMException identity: playback rejection
  // prototypes vary across browsers.
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/** `MediaError.code` values, named so PostHog breakdowns read without a lookup table. */
const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

/**
 * Element and connection state at the moment play() was refused. Every browser
 * surfaces a failed download as `NotSupportedError` ("no supported sources",
 * iOS: "The operation is not supported."), so the rejection alone cannot tell
 * a broken file from a dropped connection. The element's own `MediaError` and
 * the reader's connectivity can.
 */
export function describePlaybackFailure(
  audio: Pick<HTMLMediaElement, 'error' | 'networkState' | 'readyState'>,
  nav: { onLine?: boolean; connection?: { effectiveType?: string } } | undefined,
): Record<string, string> {
  const code = audio.error?.code;
  return {
    'media.error_code': code === undefined ? 'none' : (MEDIA_ERROR_NAMES[code] ?? String(code)),
    'media.error_message': audio.error?.message ?? '',
    'audio.network_state': String(audio.networkState),
    'audio.ready_state': String(audio.readyState),
    'network.online': nav?.onLine === undefined ? 'unknown' : String(nav.onLine),
    'network.effective_type': nav?.connection?.effectiveType ?? '',
  };
}

/** Bound the follow-up check so a stalled connection cannot hold the report back indefinitely. */
export const AUDIO_PROBE_TIMEOUT_MS = 5000;

/**
 * Re-request a failed CDN clip and say what came back: an HTTP status,
 * `network-error`, `timeout`, or `skipped` for sources that are not CDN
 * objects (an expansion's blob url). Done after the failure, so a `200` means
 * the object is fine now and the failure was transient or on the reader's side;
 * an error status points at the CDN or R2. HEAD keeps it a CORS simple request
 * and avoids downloading the clip again.
 */
export async function probeAudioSource(
  source: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = AUDIO_PROBE_TIMEOUT_MS,
): Promise<string> {
  if (!/^https?:\/\//i.test(source)) return 'skipped';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(source, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
    return String(response.status);
  } catch {
    return controller.signal.aborted ? 'timeout' : 'network-error';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every superseding playback intent takes a new token, so stale play() settlements cannot alter
 * state or analytics. Module scope is safe because audio exists only on the client.
 */
let playbackToken = 0;

/**
 * Why a clip started, on every `segment_played`. One event per play carries what used to take
 * two (`search_result_clicked` before the play, `segment_navigated` after next/prev), which keeps
 * PostHog under its free event allowance. See docs: plans/posthog-event-budget.md.
 *
 * - `click`    -- the reader picked this result in the search list (`setPlaylist`).
 * - `next`, `prev` -- the player's own controls or keys.
 * - `autoplay` -- the previous clip ended, or was unplayable, with autoplay on.
 * - `repeat`   -- repeat mode looping, or a restart that had to rebuild the element.
 * - `resume`   -- play pressed on a clip whose element was gone or stale.
 */
type PlayTrigger = 'click' | 'next' | 'prev' | 'autoplay' | 'repeat' | 'resume';

/**
 * A search-result click whose play has not been reported yet. A click normally reports itself
 * as `segment_played` with `trigger: 'click'`. When its play never starts (the clip fails, or
 * another play supersedes it while buffering) the click is sent as `search_result_clicked`
 * instead, so click counts stay exactly what they were when every click sent that event.
 *
 * `token` is null until the click's own play takes a playback token; any later token means the
 * click's play was superseded.
 */
let pendingClick: { properties: Record<string, unknown>; token: number | null } | null = null;

function flushPendingClick(transport?: 'sendBeacon'): void {
  if (!pendingClick) return;
  const { properties } = pendingClick;
  pendingClick = null;
  const posthog = usePostHog();
  if (transport) posthog?.capture('search_result_clicked', properties, { transport });
  else posthog?.capture('search_result_clicked', properties);
}

let pagehideHooked = false;

/**
 * Send a still-pending click when the page goes away: a reader who clicks and leaves while the
 * clip buffers made a click, and before this change that click was already on its way. Hooked on
 * the first click, so SSR and pages without a player add no listener. By then posthog-js has
 * flushed its own queue on `pagehide`, so the click goes by beacon, as posthog-js sends its own
 * `$pageleave`.
 */
function flushPendingClickOnPagehide(): void {
  if (pagehideHooked || typeof window === 'undefined') return;
  pagehideHooked = true;
  window.addEventListener('pagehide', () => flushPendingClick('sendBeacon'));
}

/** Take a new playback token, settling a pending click that this supersedes. */
function bumpPlaybackToken(): number {
  playbackToken++;
  if (pendingClick) {
    if (pendingClick.token === null) pendingClick.token = playbackToken;
    else if (pendingClick.token !== playbackToken) flushPendingClick();
  }
  return playbackToken;
}

/**
 * Client-only DOM handle kept outside store state. Retaining it keeps the prefetch alive;
 * source identifies stale downloads.
 */
let prefetched: { source: string; audio: HTMLAudioElement } | null = null;

/** `HTMLMediaElement.HAVE_ENOUGH_DATA` -- enough buffered to reach the end. */
const HAVE_ENOUGH_DATA = 4;

/** Bound the wait because canplaythrough may never fire on a stalled connection. */
export const PLAYABLE_WAIT_MS = 2000;

/**
 * Resolve once `audio` can play through without stalling, or once waiting for
 * that stops being worth it.
 *
 * Also resolves on `error`, rather than hanging: a clip the CDN has lost should
 * reach `play()` and reject there, which is the path that reports it.
 */
export function whenPlayable(audio: HTMLAudioElement, timeoutMs: number = PLAYABLE_WAIT_MS): Promise<void> {
  if (audio.readyState >= HAVE_ENOUGH_DATA) return Promise.resolve();

  // A prefetched element may already have emitted error; do not wait for an event that will not
  // fire again.
  if (audio.error) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      audio.removeEventListener('canplaythrough', done);
      audio.removeEventListener('error', done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    audio.addEventListener('canplaythrough', done);
    audio.addEventListener('error', done);
  });
}

/**
 * Set preload=auto before src so downloading starts immediately rather than stopping at
 * metadata.
 */
function buildAudio(source: string): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = source;
  return audio;
}

/** Abandon the prefetched download, if there is one. */
function dropPrefetch() {
  if (!prefetched) return;
  prefetched.audio.src = '';
  prefetched.audio.load();
  prefetched = null;
}

/** The element already downloading `source`, or a fresh one. */
function takeAudio(source: string): HTMLAudioElement {
  if (prefetched?.source === source) {
    const { audio } = prefetched;
    prefetched = null;
    return audio;
  }
  return buildAudio(source);
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

/**
 * Listening mode's practice settings (shadowing). They only act while listening mode is open: the bar
 * keeps playing back to back, so a gap set for practice never surprises someone mining from the list.
 *
 * - Gap: silence after a clip, for the reader to say it back. `auto` is the clip's own length at the
 *   current speed, the usual shadowing rule of thumb.
 * - Repeat times: plays of each sentence before moving on. Forever is the existing `repeat` flag.
 *
 * When the translation and furigana show is not a setting of its own: listening mode follows the same
 * show / spoiler / hide preferences as the result cards.
 */
export const SHADOW_GAPS = [0, 2, 4, 'auto'] as const;
export type ShadowGap = (typeof SHADOW_GAPS)[number];

export const REPEAT_TIMES = [1, 2, 3] as const;
export type RepeatTimes = (typeof REPEAT_TIMES)[number];

/** The shortest `auto` gap: a 0.4s interjection still deserves a moment to answer. */
const MIN_AUTO_GAP_MS = 1000;

const normalizeShadowGap = (value: unknown): ShadowGap =>
  (SHADOW_GAPS as readonly unknown[]).includes(value) ? (value as ShadowGap) : 0;

const normalizeRepeatTimes = (value: unknown): RepeatTimes =>
  (REPEAT_TIMES as readonly unknown[]).includes(value) ? (value as RepeatTimes) : 1;

/**
 * The pending step after a gap. Module scope like the playback token: a timer is a client-only handle,
 * not state, and only one gap can be pending at a time.
 */
let gapTimer: ReturnType<typeof setTimeout> | null = null;
let gapContinuation: (() => void) | null = null;

/**
 * Whether `playlist` is the start of `results`: the same list, or the same list with more pages
 * appended. Compared by id, since every page builds a new array of new objects.
 */
export function isPlaylistPrefix(playlist: readonly SearchResult[], results: readonly SearchResult[]): boolean {
  if (!playlist.length || results.length < playlist.length) return false;
  return playlist.every((result, i) => results[i]?.segment.publicId === result.segment.publicId);
}

const DEFAULT_PLAYBACK_RATE = 1;
const DEFAULT_VOLUME = 1;

/**
 * Volume as a 0..1 fraction, with anything unusable falling back to full.
 *
 * Non-numbers are rejected rather than coerced: `Number(null)` is 0, so a
 * missing or null-shaped persisted value would come back as silence -- which
 * reads as broken audio, not as a remembered preference.
 */
export function clampVolume(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * The nearest offered rate to `value`.
 *
 * Snapped rather than clamped because both consumers are restricted to the
 * list: the button only ever cycles through it, and YouTube's IFrame API
 * ignores a `setPlaybackRate` outside `getAvailablePlaybackRates()`. Letting an
 * off-list number through would leave the two players at different speeds.
 */
export function normalizePlaybackRate(value: unknown): number {
  // Same reasoning as `clampVolume`: coercion would turn a null into 0, which
  // snaps to the slowest rate instead of falling back to normal speed.
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PLAYBACK_RATE;
  return PLAYBACK_RATES.reduce((best, rate) => (Math.abs(rate - value) < Math.abs(best - value) ? rate : best));
}

/**
 * What a start of the audio element should be reported as.
 *
 * - `play`   -- a clip the reader reached: the thing every per-play rate counts.
 * - `repeat` -- the same clip again, from `repeat` mode or a manual restart.
 * - `none`   -- resuming a pause, which was never a new play to begin with.
 */
type TrackedPlay = 'play' | 'repeat' | 'none';

interface PlayerState {
  playlist: SearchResult[];
  currentIndex: number | null;
  isPlaying: boolean;
  /**
   * A play was asked for and the clip is still downloading. The play button shows it, so a slow
   * connection reads as loading rather than as a press that did nothing. Cleared by whatever
   * supersedes the wait (`releaseAudio`, `pause`) as well as by the play settling.
   */
  isBuffering: boolean;
  showPlayer: boolean;
  currentAudio: HTMLAudioElement | null;
  /** The url `currentAudio` was built from, so a stale element can be spotted. */
  currentSource: string | null;
  autoplay: boolean;
  repeat: boolean;
  isImmersive: boolean;
  /** 0..1, mirrored onto `HTMLAudioElement.volume`. Remembered across sessions. */
  volume: number;
  /** One of `PLAYBACK_RATES`. Remembered across sessions. */
  playbackRate: number;
  /** Listening mode practice settings; see `SHADOW_GAPS`. Remembered across sessions. */
  shadowGap: ShadowGap;
  repeatTimes: RepeatTimes;
  /** Times the current sentence has played to the end. Reset when another sentence starts. */
  timesPlayed: number;
  /**
   * The gap in progress, for the "your turn" countdown: its length, and when it started (a fresh
   * number per gap, so the countdown restarts even for two gaps of the same length).
   */
  gap: { ms: number; startedAt: number } | null;
  /**
   * The reader stepped past the last loaded sentence (by hand or by autoplay), and the step is held
   * for the page that may follow. The search page sees it, loads that page, and settles it: taken if
   * the page brought more, dropped if not. No timer: the load itself decides.
   */
  wantsMore: 'next' | 'autoplay' | null;
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({
    playlist: [],
    currentIndex: null,
    isPlaying: false,
    isBuffering: false,
    showPlayer: false,
    currentAudio: null,
    currentSource: null,
    autoplay: false,
    repeat: false,
    isImmersive: false,
    volume: DEFAULT_VOLUME,
    playbackRate: DEFAULT_PLAYBACK_RATE,
    shadowGap: 0,
    repeatTimes: 1,
    timesPlayed: 0,
    gap: null,
    wantsMore: null,
  }),

  // Persist only preferences, not a live playlist or element. Normalize again after
  // hydration to tolerate edited or older storage.
  persist: import.meta.client
    ? {
        key: 'player-prefs',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['volume', 'playbackRate', 'shadowGap', 'repeatTimes'],
        afterHydrate: (ctx) => {
          const store = ctx.store as unknown as PlayerState;
          store.volume = clampVolume(store.volume);
          store.playbackRate = normalizePlaybackRate(store.playbackRate);
          store.shadowGap = normalizeShadowGap(store.shadowGap);
          store.repeatTimes = normalizeRepeatTimes(store.repeatTimes);
        },
      }
    : false,

  getters: {
    currentResult(state): SearchResult | null {
      if (state.currentIndex !== null) {
        const result = state.playlist[state.currentIndex];
        if (result) {
          return result;
        }
      }
      return null;
    },

    /**
     * Whether the built element no longer matches what the current result should
     * play. Resuming it would replay the pre-expansion clip -- the reader expands
     * a segment, presses play, and hears the sentence they already had.
     */
    isCurrentAudioStale(): boolean {
      const result = this.currentResult;
      if (!result || !this.currentAudio) return false;
      return this.currentSource !== resolveAudioSource(result);
    },
  },

  actions: {
    setPlaylist(results: SearchResult[], startIndex: number) {
      this.playlist = results;
      this.currentIndex = startIndex;
      this.showPlayer = true;
      this.isImmersive = false;

      // An earlier click whose play never started still counts as a click.
      flushPendingClick();
      const result = results[startIndex];
      if (result && import.meta.client) {
        pendingClick = {
          properties: {
            media_id: result.media.publicId,
            media_name: result.media.nameRomaji,
            result_position: startIndex,
          },
          token: null,
        };
        flushPendingClickOnPagehide();
      }

      this.playCurrent({ trigger: 'click' });
    },

    handleEnded() {
      this.timesPlayed++;
      // Practice settings act only in listening mode; outside it the gap is 0 and every branch
      // below runs straight away, as it always has.
      const practicing = this.isImmersive;
      const replay = () => this.playCurrent({ repeat: true, trigger: 'repeat' });

      if (this.repeat) {
        this.afterGap(replay);
      } else if (practicing && this.timesPlayed < this.repeatTimes) {
        this.afterGap(replay);
      } else if (this.autoplay) {
        this.afterGap(() => this.next('autoplay'));
      } else {
        this.isPlaying = false;
      }
    },

    /** The gap to leave after the current clip, in ms. 0 outside listening mode. */
    gapMs(): number {
      if (!this.isImmersive || this.shadowGap === 0) return 0;
      if (this.shadowGap !== 'auto') return this.shadowGap * 1000;
      const result = this.currentResult;
      if (!result) return 0;
      const clip = resolveClipWindow(result);
      return Math.max(MIN_AUTO_GAP_MS, (clip.endMs - clip.startMs) / this.playbackRate);
    },

    /**
     * Run `step` after the shadowing gap, or now when there is none. While waiting the player still
     * counts as playing -- the session is running, and the button offers pause, which ends the gap.
     */
    afterGap(step: () => void) {
      this.cancelGap();
      const ms = this.gapMs();
      if (ms <= 0) {
        step();
        return;
      }
      this.gap = { ms, startedAt: Date.now() };
      gapContinuation = step;
      gapTimer = setTimeout(() => {
        gapTimer = null;
        gapContinuation = null;
        this.gap = null;
        step();
      }, ms);
    },

    /** Drop a pending gap without running what it was waiting to do. */
    cancelGap() {
      if (gapTimer) clearTimeout(gapTimer);
      gapTimer = null;
      gapContinuation = null;
      this.gap = null;
    },

    /** End a pending gap now and run what it was waiting to do. */
    skipGap() {
      const step = gapContinuation;
      this.cancelGap();
      step?.();
    },

    setShadowGap(value: ShadowGap) {
      this.shadowGap = normalizeShadowGap(value);
    },

    setRepeatTimes(value: RepeatTimes | 'forever') {
      if (value === 'forever') {
        this.repeat = true;
        return;
      }
      this.repeat = false;
      this.repeatTimes = normalizeRepeatTimes(value);
    },

    /**
     * Do not treat an unplayable video as ended: repeat would retry forever. Autoplay may still
     * advance past it.
     */
    handleClipUnplayable() {
      if (this.autoplay) {
        this.next('autoplay');
        return;
      }
      this.isPlaying = false;
    },

    /**
     * @param isRepeat Marks a loop or rebuilt restart as a re-listen, not a newly reached
     * sentence, while retaining engagement telemetry.
     * @param trigger Why this clip started; see `PlayTrigger`.
     */
    trackPlay(isRepeat = false, trigger: PlayTrigger = 'resume') {
      // The click's play started, so `segment_played` reports it; nothing is left to flush.
      if (trigger === 'click') pendingClick = null;

      const posthog = usePostHog();
      posthog?.capture('segment_played', {
        media_id: this.currentResult?.media.publicId,
        media_name: this.currentResult?.media.nameRomaji,
        media_category: this.currentResult?.media.category ?? null,
        segment_id: this.currentResult?.segment.publicId,
        playlist_position: this.currentIndex,
        playlist_size: this.playlist.length,
        is_autoplay: this.autoplay,
        is_repeat: isRepeat,
        trigger,
        // Listening mode's use and settings ride on the play itself rather than on events of
        // their own, which keeps PostHog under its free allowance (plans/posthog-event-budget.md).
        listening_mode: this.isImmersive,
        ...(this.isImmersive
          ? {
              shadow_gap: this.shadowGap,
              repeat_times: this.repeat ? 'forever' : this.repeatTimes,
            }
          : {}),
      });

      // Deliberate plays only, where deliberate means the reader chose this
      // clip: `this.autoplay` is the same flag the event above carries, so the
      // counter and the analytics agree on what a play is.
      //
      // `isRepeat` is deliberately NOT folded in here. A loop is not a sentence
      // reached for analytics, but it is still time spent on the site, which is
      // what the nudge counts -- so the two part company on purpose, and the
      // event carries both flags so either definition can be recovered.
      if (!this.autoplay) useSignupNudge().recordPlay();

      const user = userStore();
      if (user.isLoggedIn) {
        const sdk = useNadeshikoSdk();
        // Fire-and-forget telemetry: never let it interrupt or warn about audio
        // that is already playing.
        void trackPlayActivity(sdk, {
          activityType: 'SEGMENT_PLAY',
          segmentPublicId: this.currentResult?.segment.publicId,
          mediaPublicId: this.currentResult?.media.publicId,
          // Not `media.nameRomaji` on its own: rows without a romaji title sent
          // `''`, which the API stored and later refused to serialize back.
          // Locale-independent order -- a store action has no `useI18n` context,
          // and this name is stored metadata rather than something rendered now.
          mediaName: firstNonBlank(
            this.currentResult?.media.nameRomaji,
            this.currentResult?.media.nameEn,
            this.currentResult?.media.nameJa,
          ),
          japaneseText: this.currentResult?.segment.textJa.content,
        });
      }
    },

    /**
     * Start under a fresh token after buffering; discard superseded settlements. Track only the
     * successful start: new play, repeat, or unreported pause resume.
     */
    startAudio(audio: HTMLAudioElement, track: TrackedPlay, trigger: PlayTrigger = 'resume') {
      const token = bumpPlaybackToken();

      const started = () => {
        if (token !== playbackToken) return;
        this.isBuffering = false;
        this.isPlaying = true;
        if (track !== 'none') this.trackPlay(track === 'repeat', trigger);
      };

      const failed = (error: unknown) => {
        if (token !== playbackToken) return;
        this.isBuffering = false;
        this.isPlaying = false;
        // A click whose clip failed is still a click.
        flushPendingClick();

        // Note this is not the teardown case: `releaseIfSource`, `hidePlayer`
        // and every `playCurrent` branch bump `playbackToken` before releasing,
        // so a play() we cancelled ourselves is already discarded by the guard
        // above and never reaches here.
        if (isUnactionablePlaybackError(error)) return;

        // What survives is a clip that would not load or decode. The source
        // goes on the report because the segment id alone does not say which
        // url was tried: an expansion plays a blob built in the browser, and
        // it fails for reasons a CDN object never would.
        //
        // The element state is read now, before anything can reset it; the
        // probe runs after, and the report waits for it (bounded by
        // AUDIO_PROBE_TIMEOUT_MS) so one event carries the whole picture.
        const attributes = {
          'segment.publicId': this.currentResult?.segment.publicId ?? '',
          'audio.source': audio.src,
          ...describePlaybackFailure(audio, typeof navigator === 'undefined' ? undefined : navigator),
        };
        void probeAudioSource(audio.src).then((status) => {
          reportError('player:audio-play-failed', error, { ...attributes, 'audio.probe_status': status });
        });
      };

      // Buffered already -- which, with `prefetchNext` keeping a clip ahead, is
      // every play in a playlist but the first.
      if (audio.readyState >= HAVE_ENOUGH_DATA) {
        audio.play().then(started, failed);
        return;
      }

      // Prime play/pause synchronously inside the iOS gesture before awaiting buffering.
      // Pausing keeps it inaudible without muted playback reaching ended or gesture-less
      // unmuting stopping autoplay.
      this.isBuffering = true;
      const resumeAt = audio.currentTime;
      // Ignore the priming play's expected AbortError without changing isPlaying. The later,
      // token-guarded attempt reports the real outcome.
      audio.play().catch(() => {});
      audio.pause();

      whenPlayable(audio).then(() => {
        if (token !== playbackToken) return;
        // Back to where the priming left off: the element has not moved, but a
        // resume arrives here with the reader's position on it, and a clip
        // stopped halfway is rarely buffered to the end either.
        if (audio.currentTime !== resumeAt) audio.currentTime = resumeAt;
        audio.play().then(started, failed);
      });
    },

    /**
     * Detach the current media element: stop the download, drop the `onended`
     * closure holding this store, and let it be collected. Blob URLs are *not*
     * revoked here — they belong to `useSegmentConcatenation`, which still needs
     * them for the download/revert actions.
     */
    releaseAudio() {
      this.currentSource = null;
      this.isBuffering = false;
      const audio = this.currentAudio;
      if (!audio) return;
      audio.pause();
      audio.onended = null;
      audio.src = '';
      audio.load();
      this.currentAudio = null;
    },

    /**
     * Release the element if it is playing `source`, so the caller can revoke it.
     *
     * `useSegmentConcatenation` revokes an expansion's blob URL when the reader
     * reverts or expands again. Revoking one the player still holds leaves the
     * element pointed at an address that no longer resolves, which fails the next
     * seek or replay with no error the reader can act on.
     */
    releaseIfSource(source: string) {
      // Including the one being downloaded ahead: an element left pointed at a
      // revoked blob url fails on the play it was prefetched for.
      if (prefetched?.source === source) dropPrefetch();

      if (this.currentSource !== source) return;
      bumpPlaybackToken();
      this.releaseAudio();
      this.isPlaying = false;
    },

    /**
     * Move the player onto `result`'s clip window after an expansion changed it.
     *
     * Only the YouTube path needs telling. A media element re-reads its source
     * through `resolveAudioSource` on its next play, but the iframe was handed a
     * start and an end when the clip was loaded and holds them until something
     * says otherwise -- so an expansion made while the clip is up, or paused
     * part-way through, would keep playing the window it started with.
     */
    retimeCurrentClip(result: SearchResult) {
      if (this.currentResult !== result || !isYoutube(result)) return;
      const yt = useYoutubeSegmentPlayer();
      // Not the clip on the player: it finished, or another card took it over.
      // The next play reads the window fresh, so there is nothing to move.
      if (yt.activeSegmentId.value !== result.segment.publicId) return;

      const clip = resolveClipWindow(result);
      yt.retimeClip(clip.startMs, clip.endMs);
    },

    /**
     * @param repeat Whether this is the same clip starting over rather than a
     *               new one being reached. Threaded in by the callers that know
     *               -- `handleEnded` under `repeat` mode, and the `restart` path
     *               that has to rebuild a stale element -- because by the time
     *               `trackPlay` runs there is nothing left to tell them apart:
     *               a loop rebuilds the element exactly as a fresh play does.
     */
    playCurrent({ repeat = false, trigger = 'resume' }: { repeat?: boolean; trigger?: PlayTrigger } = {}) {
      // Whatever a gap or the end of the page was waiting to do, this play replaces it.
      this.cancelGap();
      this.wantsMore = null;
      // A replay is the same sentence again; anything else is a sentence starting fresh.
      if (!repeat) this.timesPlayed = 0;
      this.releaseAudio();

      const result = this.currentResult;
      if (!result) {
        bumpPlaybackToken();
        // Nothing to play, so nothing is playing. Without this the flag keeps
        // whatever the previous clip left on it and the transport sits showing
        // a pause button over silence -- `releaseAudio` above has already
        // detached the element, so there is not even anything to press it on.
        // Reachable through an out-of-range `startIndex` into `setPlaylist`.
        this.isPlaying = false;
        return;
      }

      const yt = useYoutubeSegmentPlayer();

      if (isYoutube(result)) {
        bumpPlaybackToken();
        const seg = result.segment;
        const clip = resolveClipWindow(result);
        yt.play(seg.publicId, seg.externalVideoId ?? '', clip.startMs, clip.endMs, {
          onEnded: () => this.handleEnded(),
          onFailed: () => this.handleClipUnplayable(),
        });
        yt.setVolume(this.volume);
        yt.setPlaybackRate(this.playbackRate);
        this.isPlaying = true;
        this.trackPlay(repeat, trigger);
        this.prefetchNext();
        return;
      }

      yt.stop();
      const audioUrl = resolveAudioSource(result);
      // markRaw: the media element is a DOM handle, not state to make reactive or
      // serialize into the SSR payload.
      const audio = markRaw(takeAudio(audioUrl));
      this.currentAudio = audio;
      this.stampPlaybackSettings(audio);
      // Remembered so a later play can tell this element apart from what the
      // result should be playing by then -- see `isCurrentAudioStale`.
      this.currentSource = audioUrl;
      // Leave crossOrigin unset so ordinary playback does not depend on permissive CDN CORS.
      // Expansion's extra fetch keeps any CORS failure confined to expansion.

      this.startAudio(audio, repeat ? 'repeat' : 'play', trigger);

      audio.onended = () => this.handleEnded();

      this.prefetchNext();
    },

    /**
     * Prefetch only the next clip to hide buffering without wasting bandwidth on skipped
     * tracks. YouTube streams through its own player.
     */
    prefetchNext() {
      if (!import.meta.client) return;

      const next = this.currentIndex === null ? null : this.playlist[this.currentIndex + 1];
      if (!next || isYoutube(next)) {
        dropPrefetch();
        return;
      }

      // Read through `resolveAudioSource` like every other play: a segment the
      // reader expanded before reaching it must not be prefetched as its
      // pre-expansion clip -- `takeAudio` would then miss and the download would
      // have been for nothing.
      const source = resolveAudioSource(next);

      // Do not prefetch local expansion blobs: it saves no request and holds another decoded
      // copy. Drop any stale plain-clip prefetch.
      if (source.startsWith('blob:')) {
        dropPrefetch();
        return;
      }

      if (prefetched?.source === source) return;

      dropPrefetch();
      prefetched = { source, audio: buildAudio(source) };
    },

    play() {
      // Replaying the sentence at hand drops a step held for the next page.
      this.wantsMore = null;
      if (isYoutube(this.currentResult)) {
        const yt = useYoutubeSegmentPlayer();
        if (yt.activeSegmentId.value === this.currentResult?.segment.publicId) {
          bumpPlaybackToken();
          yt.resume();
        } else {
          this.playCurrent();
        }
        this.isPlaying = true;
      } else if (this.currentAudio && !this.isCurrentAudioStale) {
        this.startAudio(this.currentAudio, 'none');
        this.isPlaying = true;
      } else {
        this.playCurrent();
      }
    },

    pause() {
      // Pausing in a gap stops the session there, rather than letting the next clip start.
      this.cancelGap();
      this.wantsMore = null;
      if (isYoutube(this.currentResult)) {
        bumpPlaybackToken();
        useYoutubeSegmentPlayer().pause();
        this.isPlaying = false;
      } else if (this.currentAudio) {
        bumpPlaybackToken();
        this.currentAudio.pause();
        this.isBuffering = false;
        this.isPlaying = false;
      }
    },

    togglePlay() {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    },

    /**
     * Copy the remembered volume and speed onto a media element.
     *
     * Needed on every element rather than once, because both live on the
     * element and not on the source: `playCurrent` builds a fresh `Audio` per
     * clip, so an unstamped one silently reverts to 1x at full volume. In a
     * mining run that is every few seconds.
     */
    stampPlaybackSettings(audio: HTMLAudioElement) {
      audio.volume = this.volume;
      audio.playbackRate = this.playbackRate;
      // Slowing a line must not transpose it -- 0.5x without this is an octave
      // down, which is useless for hearing how a word is actually pronounced.
      // True by default everywhere current, set anyway so the intent is on the
      // record rather than inherited.
      audio.preservesPitch = true;
    },

    /** Push the current volume and speed onto whatever is playing right now. */
    applyPlaybackSettings() {
      if (this.currentAudio) this.stampPlaybackSettings(this.currentAudio);
      if (isYoutube(this.currentResult)) {
        const yt = useYoutubeSegmentPlayer();
        yt.setVolume(this.volume);
        yt.setPlaybackRate(this.playbackRate);
      }
    },

    setVolume(value: number) {
      this.volume = clampVolume(value);
      this.applyPlaybackSettings();
    },

    /**
     * Capture the slider's change event, not each input step, so one adjustment produces one
     * event.
     */
    trackVolumeChange() {
      const posthog = usePostHog();
      posthog?.capture('player_volume_changed', { volume: Math.round(this.volume * 100) });
    },

    setPlaybackRate(value: number) {
      this.playbackRate = normalizePlaybackRate(value);
      this.applyPlaybackSettings();
      const posthog = usePostHog();
      posthog?.capture('playback_rate_changed', { rate: this.playbackRate });
    },

    toggleAutoplay() {
      this.autoplay = !this.autoplay;
      const posthog = usePostHog();
      posthog?.capture('autoplay_toggled', { enabled: this.autoplay });
    },

    toggleRepeat() {
      this.repeat = !this.repeat;
    },

    toggleImmersive() {
      // Gaps belong to listening mode. Leaving mid-gap carries on at once, as the bar would have.
      if (this.isImmersive && this.gap) {
        this.isImmersive = false;
        this.skipGap();
      } else {
        this.isImmersive = !this.isImmersive;
      }
      const posthog = usePostHog();
      posthog?.capture('immersive_mode_toggled', { enabled: this.isImmersive });
    },

    /** @param trigger `autoplay` when the previous clip ended on its own. */
    next(trigger: 'next' | 'autoplay' = 'next') {
      if (this.currentIndex !== null && this.currentIndex < this.playlist.length - 1) {
        this.currentIndex++;
        this.playCurrent({ trigger });
      } else {
        this.isPlaying = false;
        // The end of what is loaded, not necessarily of the results: hold the step for the next
        // page, which the search page loads on seeing this.
        if (this.currentIndex !== null) this.wantsMore = trigger;
      }
    },

    /**
     * Take a longer result list without losing the place in it. Infinite scroll appends by building
     * a new array, so the playlist handed over on the click went on ending where the first page did:
     * "next" past it did nothing, and autoplay stopped there.
     *
     * Only an extension counts. A different search keeps the playlist the reader is listening to.
     */
    syncPlaylist(results: SearchResult[]) {
      if (results === this.playlist || results.length <= this.playlist.length) return;
      if (!isPlaylistPrefix(this.playlist, results)) return;
      this.playlist = results;
    },

    /**
     * Settle a held step once the page it waited for has loaded, or failed to: take it if the
     * playlist now goes further, drop it otherwise. Anything the reader did in between (another
     * sentence, a pause, closing) has already dropped it.
     */
    settleWantsMore() {
      const trigger = this.wantsMore;
      this.wantsMore = null;
      if (!trigger || !this.showPlayer || this.currentIndex === null) return;
      if (this.currentIndex < this.playlist.length - 1) this.next(trigger);
    },

    prev() {
      if (this.currentIndex !== null && this.currentIndex > 0) {
        this.currentIndex--;
        this.playCurrent({ trigger: 'prev' });
      }
    },

    restart() {
      this.cancelGap();
      if (isYoutube(this.currentResult)) {
        bumpPlaybackToken();
        useYoutubeSegmentPlayer().restart();
        this.isPlaying = true;
      } else if (this.currentAudio && !this.isCurrentAudioStale) {
        this.currentAudio.currentTime = 0;
        this.startAudio(this.currentAudio, 'none');
        this.isPlaying = true;
      } else if (this.currentResult) {
        // Rebuilt rather than rewound, because the element is gone or stale --
        // but it is still the reader asking for the same sentence again, so it
        // reports as a repeat. Marked here and not in the branch above because
        // that one never reaches `trackPlay` at all: rewinding a live element
        // was never a play to take back out.
        this.playCurrent({ repeat: true, trigger: 'repeat' });
      } else {
        return;
      }
      const posthog = usePostHog();
      posthog?.capture('segment_replayed', {
        media_id: this.currentResult?.media.publicId,
        segment_id: this.currentResult?.segment.publicId,
      });
    },

    hidePlayer() {
      this.cancelGap();
      this.wantsMore = null;
      bumpPlaybackToken();
      this.releaseAudio();
      dropPrefetch();
      useYoutubeSegmentPlayer().stop();
      this.showPlayer = false;
      this.playlist = [];
      this.currentIndex = null;
      this.isPlaying = false;
      this.isImmersive = false;
    },
  },
});
