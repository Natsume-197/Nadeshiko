import { defineStore } from 'pinia';
import { normalizeExportPercent, type ExportPercent } from '~/utils/exportMedia';

export const useExportSettingsStore = defineStore('export-settings', {
  state: (): { audioVolume: ExportPercent; imageQuality: ExportPercent } => ({
    audioVolume: normalizeExportPercent(100),
    imageQuality: normalizeExportPercent(100),
  }),
  persist: import.meta.client
    ? {
        key: 'export-settings',
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ['audioVolume', 'imageQuality'],
        afterHydrate: ({ store }) => {
          store.audioVolume = normalizeExportPercent(store.audioVolume);
          store.imageQuality = normalizeExportPercent(store.imageQuality);
        },
      }
    : false,
  actions: {
    setAudioVolume(value: unknown) {
      this.audioVolume = normalizeExportPercent(value);
    },
    setImageQuality(value: unknown) {
      this.imageQuality = normalizeExportPercent(value);
    },
    reset() {
      this.audioVolume = normalizeExportPercent(100);
      this.imageQuality = normalizeExportPercent(100);
    },
  },
});
