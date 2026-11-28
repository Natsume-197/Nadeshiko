import { defineStore } from 'pinia';
import { normalizeAudioExportVolume, type AudioExportVolume } from '~/utils/audioExport';

export const useAudioExportStore = defineStore('audio-export', {
  state: (): { volume: AudioExportVolume } => ({ volume: 100 }),
  persist: import.meta.client
    ? {
        key: 'audio-export-prefs',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['volume'],
        afterHydrate: ({ store }) => {
          store.volume = normalizeAudioExportVolume(store.volume);
        },
      }
    : false,
  actions: {
    setVolume(value: unknown) {
      this.volume = normalizeAudioExportVolume(value);
    },
  },
});
