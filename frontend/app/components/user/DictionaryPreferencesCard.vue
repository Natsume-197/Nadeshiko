<script setup lang="ts">
import { mdiCheck } from '@mdi/js';
import { useI18n } from 'vue-i18n';

import { handleApiError } from '~/utils/apiError';
import { useToastSuccess } from '~/utils/toast';
import { DEFINITION_SIZES, definitionSize } from '~/utils/wordPopup';

const { t } = useI18n();
const user_store = userStore();
const sdk = useNadeshikoSdk();
const posthog = usePostHog();

const savingPreferences = ref(false);

/** How large the word card prints its definitions. See `~/utils/wordPopup`. */
const definitionTextSize = computed(() => definitionSize(user_store.preferences?.wordPopup?.definitionSize));

const updateDefinitionSize = async (value: string) => {
  const size = definitionSize(value);

  savingPreferences.value = true;
  try {
    await sdk.updateUserPreferences({ wordPopup: { definitionSize: size } });
    user_store.preferences = {
      ...user_store.preferences,
      wordPopup: { ...user_store.preferences?.wordPopup, definitionSize: size },
    };
    posthog?.capture('setting_changed', { setting_name: 'wordPopup.definitionSize', value: size });
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:definition-size-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': 'wordPopup.definitionSize' },
    });
  } finally {
    savingPreferences.value = false;
  }
};

const { presets: dictionaryPresets, isDictionaryEnabled, setDictionaryEnabled } = useDictionaryLinks();
</script>

<template>
  <section class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('accountSettings.general.readingSectionTitle') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.definitionSize') }}</p>
            <p class="nd-settings-row-desc">{{ $t('accountSettings.account.definitionSizeDescription') }}</p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.definitionSize')"
            data-testid="definition-size"
            :value="definitionTextSize"
            :disabled="savingPreferences"
            class="nd-select"
            @change="updateDefinitionSize(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="size in DEFINITION_SIZES" :key="size" :value="size">
              {{ $t(`accountSettings.account.definitionSizeOptions.${size}`) }}
            </option>
          </select>
        </div>
      </div>

      <div class="nd-settings-item">
        <p class="nd-settings-row-title">{{ $t('accountSettings.account.dictionaryLinks') }}</p>
        <p class="nd-settings-row-desc">{{ $t('accountSettings.account.dictionaryLinksDescription') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <label
            v-for="preset in dictionaryPresets"
            :key="preset.id"
            :class="[
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm cursor-pointer transition-colors select-none focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand/60',
              isDictionaryEnabled(preset.id)
                ? 'nd-accent-bg-faint border-brand/50 text-ink font-medium'
                : 'border-line-subtle bg-transparent text-ink-muted hover:border-hairline hover:bg-lift hover:text-ink',
            ]"
          >
            <input
              type="checkbox"
              :checked="isDictionaryEnabled(preset.id)"
              class="sr-only"
              @change="setDictionaryEnabled(preset.id, ($event.target as HTMLInputElement).checked)"
            />
            <UiBaseIcon
              v-if="isDictionaryEnabled(preset.id)"
              :path="mdiCheck"
              size="15"
              class="shrink-0 text-brand"
              aria-hidden="true"
            />
            <span>{{ preset.label }}</span>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
