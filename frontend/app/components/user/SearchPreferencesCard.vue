<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import type { Category, UserPreferences } from '@brigadasos/nadeshiko-sdk';

import { apiErrorStatus, handleApiError } from '~/utils/apiError';
import { ALL_CATEGORIES, CATEGORY_LABEL_KEYS } from '~/utils/categories';
import { useToastSuccess } from '~/utils/toast';
import { resolveContextResponse } from '~/utils/resolvers';
import { reportError } from '~/utils/reportError';

const { t } = useI18n();
const user_store = userStore();
const sdk = useNadeshikoSdk();
const posthog = usePostHog();

const savingPreferences = ref(false);

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

// Curated preview segments can be retired. Ignore 404s and omit the decorative card; report other failures.
const PREVIEW_SEGMENT_UUID = 'skU_sjEmsvrE';
const { data: previewData } = await useLazyAsyncData('content-rating-preview', () =>
  sdk
    .getSegmentContext({ segmentPublicId: PREVIEW_SEGMENT_UUID, take: 1 })
    .then((r) => resolveContextResponse(r))
    // Decorative preview for the content-rating setting: the panel renders fine
    // without it, so a failure must not interrupt the settings page.
    .catch((error: unknown) => {
      const retired = apiErrorStatus(error) === 404;
      if (!retired) {
        reportError('account:content-rating-preview-failed', error);
      }
      return null;
    }),
);
const previewSegment = computed(() => previewData.value?.segments?.[0] ?? null);

const questionableMode = computed(() => user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR');

const contentRatingDescription = () => {
  const value = user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR';
  return t(`accountSettings.account.contentRatingHint_${value.toLowerCase()}`);
};

const { storedDefault: defaultSearchCategory, isDefaultCategoryHidden } = useDefaultSearchCategory();
const { isCategoryHidden } = useHiddenCategories();

const categoryLabel = (category: Category) => t(CATEGORY_LABEL_KEYS[category]);

// A category hidden wholesale is still offered and still stores: refusing the
// choice here would read as a broken select rather than as a consequence of
// Hide Categories. It is labelled as hidden, and picking one only means
// searches open on All until it is shown again.
const defaultCategoryOptionLabel = (category: Category) =>
  isCategoryHidden(category)
    ? t('accountSettings.account.defaultSearchCategoryHiddenOption', { category: categoryLabel(category) })
    : categoryLabel(category);

const hiddenDefaultCategoryNotice = computed(() => {
  const stored = defaultSearchCategory.value;
  if (stored === 'ALL' || !isDefaultCategoryHidden.value) return null;
  return t('accountSettings.account.defaultSearchCategoryHiddenNotice', { category: categoryLabel(stored) });
});

const updateDefaultSearchCategory = (value: string) => updatePreference('defaultSearchCategory', value);

type NsfwMode = NonNullable<NonNullable<UserPreferences['contentRatingPreferences']>['nsfw']>;

const updateContentRatingPreference = async (value: NsfwMode) => {
  savingPreferences.value = true;
  try {
    const current = user_store.preferences?.contentRatingPreferences ?? {};
    const updated = { ...current, nsfw: value };
    await sdk.updateUserPreferences({ contentRatingPreferences: updated });
    user_store.preferences = { ...user_store.preferences, contentRatingPreferences: updated };
    useToastSuccess(t('accountSettings.account.preferenceSaved'));
  } catch (error) {
    handleApiError('account:content-rating-update-failed', error, {
      toastKey: 'accountSettings.account.preferenceError',
    });
  } finally {
    savingPreferences.value = false;
  }
};
</script>

<template>
  <section class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ $t('accountSettings.general.searchSectionTitle') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.defaultSearchCategory') }}</p>
            <p class="nd-settings-row-desc">{{ $t('accountSettings.account.defaultSearchCategoryDescription') }}</p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.defaultSearchCategory')"
            data-testid="default-search-category"
            :value="defaultSearchCategory"
            :disabled="savingPreferences"
            class="nd-select"
            @change="updateDefaultSearchCategory(($event.target as HTMLSelectElement).value)"
          >
            <option value="ALL">{{ $t('searchContainer.categoryAll') }}</option>
            <option v-for="category in ALL_CATEGORIES" :key="category" :value="category">
              {{ defaultCategoryOptionLabel(category) }}
            </option>
          </select>
        </div>
        <p v-if="hiddenDefaultCategoryNotice" class="text-amber-300/80 text-sm mt-2">{{ hiddenDefaultCategoryNotice }}</p>
      </div>

      <div class="nd-settings-item">
        <div class="nd-settings-row">
          <div class="min-w-0 flex-1">
            <p class="nd-settings-row-title">{{ $t('accountSettings.account.questionableContent') }}</p>
            <p class="nd-settings-row-desc">
              {{ contentRatingDescription() }}
            </p>
          </div>
          <select
            :aria-label="$t('accountSettings.account.questionableContent')"
            :value="user_store.preferences?.contentRatingPreferences?.nsfw || 'BLUR'"
            :disabled="savingPreferences"
            class="nd-select"
            @change="updateContentRatingPreference(($event.target as HTMLSelectElement).value as NsfwMode)"
          >
            <option value="SHOW">{{ $t('accountSettings.account.contentRatingShow') }}</option>
            <option value="BLUR">{{ $t('accountSettings.account.contentRatingBlur') }}</option>
            <option value="HIDE">{{ $t('accountSettings.account.contentRatingHide') }}</option>
          </select>
        </div>
        <div v-if="previewSegment" class="mt-3.5 rounded-lg border border-line-subtle bg-lift overflow-hidden">
          <div v-if="questionableMode === 'HIDE'" class="flex items-center justify-center py-6 px-4 bg-surface-soft">
            <span class="text-ink-faint text-sm">{{ $t('accountSettings.account.contentRatingHiddenDesc') }}</span>
          </div>
          <div v-else class="flex flex-col sm:flex-row items-stretch">
            <div class="relative h-36 sm:h-auto sm:w-48 shrink-0 overflow-hidden">
              <img
                :src="previewSegment.segment.urls.imageUrl"
                :alt="$t('accountSettings.account.contentRatingPreviewAlt')"
                class="h-full w-full object-cover object-center transition-all duration-300"
                :class="questionableMode === 'BLUR' ? 'blur-[42px] scale-125' : ''"
              />
            </div>
            <div class="flex-1 px-4 py-3 flex flex-col justify-center gap-1.5">
              <p lang="ja" class="text-ink text-sm leading-snug">{{ previewSegment.segment.textJa.content }}</p>
              <p class="text-ink-muted text-xs leading-snug">{{ previewSegment.segment.textEn.content }}</p>
              <p class="text-ink-faint text-xs mt-1">{{ $t('accountSettings.account.contentRatingPreview') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
