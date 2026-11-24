<script setup lang="ts">
import type { Category } from '@brigadasos/nadeshiko-sdk';
import { ALL_CATEGORIES, CATEGORY_LABEL_KEYS, CATEGORY_SLUG_BY_API } from '~/utils/categories';
import { useToastSuccess } from '~/utils/toast';

const { t } = useI18n();
const { isCategoryHidden, canToggleCategory, toggleCategory } = useHiddenCategories();
const posthog = usePostHog();

const categories = ALL_CATEGORIES;
const hasLockedCategory = computed(() => categories.some((category) => !canToggleCategory(category)));

const categoryLabel = (category: Category): string => t(CATEGORY_LABEL_KEYS[category]);

const categoryDescription = (category: Category): string =>
  t(`accountSettings.account.hiddenCategoryDescriptions.${CATEGORY_SLUG_BY_API[category]}`);

// Confirm by name only after the toggle reports success; failures already report and roll back the switch.
const onToggle = async (category: Category) => {
  const wasHidden = isCategoryHidden(category);
  const saved = await toggleCategory(category);
  if (!saved) return;

  posthog?.capture('category_visibility_changed', {
    action: wasHidden ? 'unhidden' : 'hidden',
    category,
  });
  useToastSuccess(
    t(wasHidden ? 'accountSettings.account.categoryShownToast' : 'accountSettings.account.categoryHiddenToast', {
      name: categoryLabel(category),
    }),
  );
};
</script>

<template>
  <section class="nd-settings-section">
    <h2 class="nd-settings-section-label">{{ t('accountSettings.account.hiddenCategories') }}</h2>

    <div class="nd-settings-group">
      <div class="nd-settings-item">
        <p class="nd-settings-row-desc !mt-0">{{ t('accountSettings.account.hiddenCategoriesDescription') }}</p>
      </div>

      <ul class="divide-y divide-line-subtle border-t border-line-subtle">
        <li
          v-for="category in categories"
          :key="category"
          class="flex items-center justify-between gap-4 px-5 py-3.5"
          data-testid="hidden-category-row"
        >
          <div class="min-w-0">
            <p class="nd-settings-row-title">{{ categoryLabel(category) }}</p>
            <p class="nd-settings-row-desc">{{ categoryDescription(category) }}</p>
          </div>

          <div class="flex items-center gap-3 shrink-0">
            <span class="text-xs" :class="isCategoryHidden(category) ? 'text-ink-faint' : 'text-ink-muted'">
              {{ isCategoryHidden(category) ? t('accountSettings.account.hiddenCategoryHidden') : t('accountSettings.account.hiddenCategoryShown') }}
            </span>
            <!-- biome-ignore lint/a11y/noLabelWithoutControl: named by the bound aria-label -->
            <label
              class="relative inline-flex items-center"
              :class="canToggleCategory(category) ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
              :title="canToggleCategory(category) ? undefined : t('accountSettings.account.hiddenCategoriesLastVisible')"
            >
              <input
                type="checkbox"
                class="sr-only peer"
                :checked="!isCategoryHidden(category)"
                :disabled="!canToggleCategory(category)"
                :aria-label="categoryLabel(category)"
                :data-testid="`hidden-category-toggle-${CATEGORY_SLUG_BY_API[category]}`"
                @change="onToggle(category)"
              />
              <div
                class="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-button-accent-main transition-colors after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full"
              />
            </label>
          </div>
        </li>
      </ul>

      <div v-if="hasLockedCategory" class="nd-settings-item border-t border-line-subtle !py-3">
        <p class="text-xs text-ink-faint">{{ t('accountSettings.account.hiddenCategoriesLastVisible') }}</p>
      </div>
    </div>
  </section>
</template>
