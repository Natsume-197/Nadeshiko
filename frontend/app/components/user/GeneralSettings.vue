<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import { handleApiError } from '~/utils/apiError';
import { MEDIA_CARD_DEFAULTS } from '~/composables/useMediaCardDefault';
import { MOTION_LEVELS, type MotionLevel } from '~/composables/useMotionPreference';
import { normalizeTranslationLanguages, type TranslationLanguage } from '~/composables/useTranslationLanguages';
import { useToastSuccess } from '~/utils/toast';

const { t, locale } = useI18n();
const user_store = userStore();
const sdk = useNadeshikoSdk();
const posthog = usePostHog();

const savingPreferences = ref(false);

/**
 * Which way the title card starts above a title's sentences. Read through the
 * composable so this select and the card cannot disagree about what the stored
 * value means -- and note this is only a starting position: the card's own row
 * opens and closes it without touching this.
 */
const { preference: mediaCardDefault } = useMediaCardDefault();

const updatePreference = async (key: string, value: string) => {
  savingPreferences.value = true;
  try {
    await sdk.updateUserPreferences({ [key]: value });
    user_store.preferences = { ...user_store.preferences, [key]: value };
    posthog?.capture('setting_changed', { setting_name: key, value });
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:preference-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': key },
    });
  } finally {
    savingPreferences.value = false;
  }
};

const mediaNameExamples: Record<string, string> = {
  ENGLISH: 'Attack on Titan',
  JAPANESE: '進撃の巨人',
  ROMAJI: 'Shingeki no Kyojin',
};

const mediaNameLanguageLabel = computed(() => {
  const lang = user_store.preferences?.mediaNameLanguage || 'ENGLISH';
  return t(`accountSettings.account.mediaNameLanguageOptions.${lang}`);
});

const mediaNameExample = computed(() => {
  const lang = user_store.preferences?.mediaNameLanguage || 'ENGLISH';
  return mediaNameExamples[lang] ?? mediaNameExamples.ENGLISH;
});

const updateMediaNameLanguage = (value: string) => updatePreference('mediaNameLanguage', value);

const translationLanguageSelection = computed(() =>
  normalizeTranslationLanguages(user_store.preferences?.translationLanguages, locale.value).join(','),
);

const updateTranslationLanguages = async (value: string) => {
  const languages = value
    .split(',')
    .filter((language): language is TranslationLanguage => language === 'EN' || language === 'ES');
  if (languages.length === 0) return;

  savingPreferences.value = true;
  try {
    await sdk.updateUserPreferences({ translationLanguages: languages });
    user_store.preferences = { ...user_store.preferences, translationLanguages: languages };
    posthog?.capture('setting_changed', { setting_name: 'translationLanguages', value: languages.join(',') });
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:translation-languages-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
      context: { 'preference.key': 'translationLanguages' },
    });
  } finally {
    savingPreferences.value = false;
  }
};

const { preference: motionPreference, setPreference: setMotionPreference } = useMotionPreference();
</script>

<template>
  <section class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('accountSettings.general.displaySectionTitle') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.mediaNameLanguage') }}</p>
            <p class="nd-settings-row-desc">
              {{ $t('accountSettings.account.mediaNameLanguageDescription', { language: mediaNameLanguageLabel }) }}
              <span lang="ja" class="text-ink/80 italic">{{ mediaNameExample }}</span>
            </p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.mediaNameLanguage')"
            :value="user_store.preferences?.mediaNameLanguage || 'ENGLISH'"
            :disabled="savingPreferences"
            class="nd-select"
            @change="updateMediaNameLanguage(($event.target as HTMLSelectElement).value)"
          >
            <option value="ENGLISH">{{ $t('accountSettings.account.mediaNameLanguageOptions.ENGLISH') }}</option>
            <option value="JAPANESE">{{ $t('accountSettings.account.mediaNameLanguageOptions.JAPANESE') }}</option>
            <option value="ROMAJI">{{ $t('accountSettings.account.mediaNameLanguageOptions.ROMAJI') }}</option>
          </select>
        </div>
      </div>

      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.translationLanguages') }}</p>
            <p class="nd-settings-row-desc">{{ $t('accountSettings.account.translationLanguagesDescription') }}</p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.translationLanguages')"
            data-testid="translation-languages"
            :value="translationLanguageSelection"
            :disabled="savingPreferences"
            class="nd-select"
            @change="updateTranslationLanguages(($event.target as HTMLSelectElement).value)"
          >
            <option value="EN">{{ $t('accountSettings.account.translationLanguageOptions.EN') }}</option>
            <option value="ES">{{ $t('accountSettings.account.translationLanguageOptions.ES') }}</option>
            <option value="EN,ES">{{ $t('accountSettings.account.translationLanguageOptions.EN_ES') }}</option>
            <option value="ES,EN">{{ $t('accountSettings.account.translationLanguageOptions.ES_EN') }}</option>
          </select>
        </div>
      </div>

      <!-- The title card above a title's own search results. A starting
           position only -- the card's row opens and closes it either way, and
           that is deliberately not stored. -->
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.mediaCard') }}</p>
            <p class="nd-settings-row-desc">{{ $t(`accountSettings.account.mediaCardHint_${mediaCardDefault}`) }}</p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.mediaCard')"
            data-testid="media-card-default"
            :value="mediaCardDefault"
            :disabled="savingPreferences"
            class="nd-select"
            @change="updatePreference('mediaCardDefault', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in MEDIA_CARD_DEFAULTS" :key="option" :value="option">
              {{ $t(`accountSettings.account.mediaCardOptions.${option}`) }}
            </option>
          </select>
        </div>
      </div>

      <!-- Motion lives in a cookie rather than the stored preferences, so it
           applies the moment it is picked and needs no round trip -- and so it
           is already right in the server's first render. `savingPreferences`
           therefore does not gate it. -->
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.motion') }}</p>
            <p class="nd-settings-row-desc">{{ $t(`accountSettings.account.motionHint_${motionPreference}`) }}</p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.motion')"
            data-testid="motion-preference"
            :value="motionPreference"
            class="nd-select"
            @change="setMotionPreference(($event.target as HTMLSelectElement).value as MotionLevel)"
          >
            <option v-for="option in MOTION_LEVELS" :key="option" :value="option">
              {{ $t(`accountSettings.account.motionOptions.${option}`) }}
            </option>
          </select>
        </div>
      </div>
    </div>
  </section>
</template>
