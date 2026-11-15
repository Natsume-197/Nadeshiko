<script setup lang="ts">
import { mdiPlus } from '@mdi/js';
import { useI18n } from 'vue-i18n';

import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { useToastSuccess } from '~/utils/toast';
import {
  BASE_INK,
  CUSTOM_THEME_PRESETS,
  type CustomTheme,
  type CustomThemePresetId,
  customThemeVariables,
  isCustomTheme,
} from '~/utils/customTheme';
import CustomThemeEditor from '~/components/user/CustomThemeEditor.vue';
import ThemePreviewTile, { type ThemePreviewPalette } from '~/components/user/ThemePreviewTile.vue';

/**
 * The Themes section of the settings, as pictures rather than menus: Dark, Light or Match my device for everyone,
 * applied the moment one is clicked; below, the patron themes, the ready-made ones and your own.
 *
 * The everyday choice lives in a cookie (see useThemePreference) so the server's first render is already in it. A
 * patron theme is also saved on the account, which is where patron status is checked: a reader who is not a patron
 * is told how to become one instead of getting a theme the next page load would drop.
 */
const { t } = useI18n();
const userStoreInstance = userStore();
const { preference, setPreference, customTheme, setCustomTheme, clearCustomTheme } = useThemePreference();

/** The site's own two themes, drawn with their real tokens (tailwind.css and themePalette.js). */
const DARK: ThemePreviewPalette = {
  background: '#1d1d1d',
  surface: '#252526',
  header: '#ef5552',
  ink: '#e8e8e8',
  accent: '#ef5552',
  line: '#3c3c3c',
};
const LIGHT: ThemePreviewPalette = {
  background: '#f5f5f7',
  surface: '#ffffff',
  header: '#ffffff',
  ink: '#1f1f1f',
  accent: '#d63c39',
  line: '#e3e3e8',
};

const APPEARANCE: Array<{ id: 'dark' | 'light' | 'system'; palette: ThemePreviewPalette; split?: ThemePreviewPalette }> =
  [
    { id: 'dark', palette: DARK },
    { id: 'light', palette: LIGHT },
    { id: 'system', palette: DARK, split: LIGHT },
  ];

const PRESET_IDS = Object.keys(CUSTOM_THEME_PRESETS) as CustomThemePresetId[];

function paletteOf(theme: CustomTheme): ThemePreviewPalette {
  const vars = customThemeVariables(theme);
  return {
    background: theme.background,
    surface: vars['--surface'] ?? theme.background,
    header: vars['--header-background'] ?? theme.accent,
    ink: BASE_INK[theme.base],
    accent: theme.accent,
    line: vars['--line'] ?? theme.background,
  };
}

const sameColours = (a: CustomTheme | null | undefined, b: CustomTheme) =>
  !!a &&
  a.base === b.base &&
  a.accent.toLowerCase() === b.accent.toLowerCase() &&
  a.background.toLowerCase() === b.background.toLowerCase();

/** The theme on the account, if the server returned one (it does only while the reader may have it). */
const saved = computed<CustomTheme | null>(() => {
  const value = userStoreInstance.preferences?.customTheme;
  return isCustomTheme(value) ? value : null;
});

/** A theme the reader made themselves, shown as its own tile next to the ready-made ones. */
const ownTheme = computed<CustomTheme | null>(() => {
  const theme = saved.value ?? customTheme.value;
  if (!theme) return null;
  return PRESET_IDS.some((id) => sameColours(theme, CUSTOM_THEME_PRESETS[id])) ? null : theme;
});

const isActive = (theme: CustomTheme) => preference.value === 'custom' && sameColours(customTheme.value, theme);

const saving = ref(false);
const needsPatron = ref(false);
const editing = ref(false);

async function applyCustom(theme: CustomTheme) {
  if (saving.value) return;
  saving.value = true;
  needsPatron.value = false;
  const value: CustomTheme = { ...theme };
  try {
    await useNadeshikoSdk().updateUserPreferences({ customTheme: value });
    userStoreInstance.preferences = { ...userStoreInstance.preferences, customTheme: value };
    setCustomTheme(value);
    editing.value = false;
    useToastSuccess(t('accountSettings.account.customTheme.saved'));
  } catch (error) {
    if (apiErrorStatus(error) === 403) {
      needsPatron.value = true;
    } else {
      handleApiError('account:custom-theme-save-failed', error, {
        toastKey: 'accountSettings.account.preferenceError',
      });
    }
  } finally {
    saving.value = false;
  }
}

async function removeCustom() {
  if (saving.value) return;
  saving.value = true;
  try {
    await useNadeshikoSdk().updateUserPreferences({ customTheme: null });
    userStoreInstance.preferences = { ...userStoreInstance.preferences, customTheme: null };
    clearCustomTheme();
    useToastSuccess(t('accountSettings.account.customTheme.removed'));
  } catch (error) {
    handleApiError('account:custom-theme-remove-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
    });
  } finally {
    saving.value = false;
  }
}

/** Your own theme is already saved, so picking its tile again needs no round trip. */
function useOwnTheme(theme: CustomTheme) {
  if (saved.value && sameColours(saved.value, theme)) {
    setCustomTheme(saved.value);
    return;
  }
  applyCustom(theme);
}

const editorStart = computed<CustomTheme>(() => ownTheme.value ?? saved.value ?? { ...CUSTOM_THEME_PRESETS.midnight });
</script>

<template>
  <div class="nd-settings-card" data-testid="theme-settings">
    <h3 class="nd-settings-title">{{ t('accountSettings.themes.title') }}</h3>
    <p class="mt-1 text-sm text-gray-400">{{ t('accountSettings.themes.description') }}</p>

    <h4 class="mt-6 text-sm font-semibold text-white">{{ t('accountSettings.themes.appearance') }}</h4>
    <div class="mt-3 flex flex-wrap gap-3 sm:gap-4" data-testid="theme-appearance">
      <ThemePreviewTile
        class="w-[8.5rem] sm:w-[9.5rem]"
        v-for="option in APPEARANCE"
        :key="option.id"
        :palette="option.palette"
        :split="option.split"
        :label="t(`accountSettings.account.themeOptions.${option.id}`)"
        :selected="preference === option.id"
        :data-testid="`theme-option-${option.id}`"
        @select="setPreference(option.id)"
      />
    </div>

    <div class="mt-8 flex items-center gap-2">
      <h4 class="text-sm font-semibold text-white">{{ t('accountSettings.themes.patronThemes') }}</h4>
      <span class="rounded bg-[#ff424d] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-on-accent">
        {{ t('accountSettings.account.customTheme.patronBadge') }}
      </span>
    </div>
    <p class="mt-1 text-sm text-gray-400">{{ t('accountSettings.account.customTheme.description') }}</p>

    <div class="mt-3 flex flex-wrap gap-3 sm:gap-4" data-testid="theme-patron">
      <ThemePreviewTile
        class="w-[8.5rem] sm:w-[9.5rem]"
        v-for="id in PRESET_IDS"
        :key="id"
        :palette="paletteOf(CUSTOM_THEME_PRESETS[id])"
        :label="t(`accountSettings.account.customTheme.presetNames.${id}`)"
        :selected="isActive(CUSTOM_THEME_PRESETS[id])"
        :data-testid="`custom-theme-preset-${id}`"
        @select="applyCustom(CUSTOM_THEME_PRESETS[id])"
      />
      <ThemePreviewTile
        class="w-[8.5rem] sm:w-[9.5rem]"
        v-if="ownTheme"
        :palette="paletteOf(ownTheme)"
        :label="t('accountSettings.themes.yourTheme')"
        :selected="isActive(ownTheme)"
        data-testid="custom-theme-own"
        @select="useOwnTheme(ownTheme)"
      />
      <ThemePreviewTile
        class="w-[8.5rem] sm:w-[9.5rem]"
        :palette="DARK"
        :label="t('accountSettings.themes.createOwn')"
        :selected="editing"
        dashed
        data-testid="custom-theme-create"
        @select="editing = !editing"
      >
        <span class="absolute inset-0 grid place-items-center text-gray-400 group-hover:text-white" aria-hidden="true">
          <UiBaseIcon :path="mdiPlus" size="28" />
        </span>
      </ThemePreviewTile>
    </div>

    <p
      v-if="needsPatron"
      class="mt-4 rounded-lg border border-hairline bg-surface-lift p-3 text-sm text-gray-300"
      data-testid="custom-theme-needs-patron"
    >
      {{ t('accountSettings.account.customTheme.needsPatron') }}
    </p>

    <CustomThemeEditor
      v-if="editing"
      :key="JSON.stringify(editorStart)"
      :initial="editorStart"
      :saving="saving"
      @save="applyCustom"
      @cancel="editing = false"
    />

    <button
      v-if="saved"
      type="button"
      class="mt-4 text-sm text-gray-400 underline-offset-4 hover:text-white hover:underline"
      :disabled="saving"
      data-testid="custom-theme-remove"
      @click="removeCustom"
    >
      {{ t('accountSettings.account.customTheme.remove') }}
    </button>
  </div>
</template>
