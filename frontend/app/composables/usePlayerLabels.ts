import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { usePlayerStore } from '~/stores/player';

/** The labels the player bar and listening mode share for their transport. */
export function usePlayerLabels() {
  const { t } = useI18n();
  const { isPlaying, isBuffering } = storeToRefs(usePlayerStore());

  /**
   * A control's label with the key that does the same, for its tooltip. `AudioPlayer`'s key handler is the
   * source of truth; these only advertise it. `aria-keyshortcuts` carries the same for screen readers.
   */
  const withKey = (label: string, key: string) => t('player.controls.withShortcut', { label, key });

  /** While the clip downloads the button says so, rather than offering a play that is already on its way. */
  const playLabel = computed(() => {
    if (isBuffering.value) return t('player.controls.loading');
    return isPlaying.value ? t('player.controls.pause') : t('player.controls.play');
  });

  return { withKey, playLabel };
}
