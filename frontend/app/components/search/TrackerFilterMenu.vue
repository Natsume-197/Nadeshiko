<script setup lang="ts">
import { mdiCheck, mdiLockOutline, mdiShieldCheckOutline } from '@mdi/js';
import { useTrackerSync } from '~/composables/useTrackerSync';
import { customListMode, customListNameFromMode, type TrackerFilterMode } from '~/utils/trackerFilter';
import { trackerIconPath } from '~/utils/trackerIcons';

const { t } = useI18n();
const localePath = useLocalePath();
const { state, isConnected, filterMode, searchFilters, setFilterMode } = useTrackerSync();

const providerId = computed(() => state.value?.connection?.provider ?? 'ANILIST');
const providerIcon = computed(() => trackerIconPath(providerId.value));
const providerLabel = computed(() =>
  providerId.value === 'MAL' ? t('connections.tracker.malName') : t('connections.tracker.anilistName'),
);

const activeLabel = computed(() => {
  const mode = filterMode.value;
  if (mode === 'my-anime') return t('trackerFilter.myAnimeShort');
  if (mode === 'completed') return t('trackerFilter.completed');
  if (mode === 'watching') return t('trackerFilter.watching');
  const custom = customListNameFromMode(mode);
  if (custom) return custom;
  return providerLabel.value;
});

const isFiltering = computed(() => filterMode.value !== 'all');
const hasSpoilerProtection = computed(() => searchFilters.value.activeSpoilerProtectionCount > 0);

const standardOptions: ReadonlyArray<{ mode: TrackerFilterMode; labelKey: string }> = [
  { mode: 'all', labelKey: 'trackerFilter.all' },
  { mode: 'my-anime', labelKey: 'trackerFilter.myAnime' },
  { mode: 'completed', labelKey: 'trackerFilter.completed' },
  { mode: 'watching', labelKey: 'trackerFilter.watching' },
];

function select(mode: TrackerFilterMode) {
  setFilterMode(mode);
}
</script>

<template>
  <SearchDropdownContainer
    v-if="isConnected"
    dropdown-id="nd-tracker-filter"
    teleport
    teleport-align="end"
    dropdown-container-class="z-[60] w-64 max-w-[calc(100vw-2rem)] p-1.5"
  >
    <template #default="{ toggle, isOpen }">
      <button
        type="button"
        data-testid="tracker-filter-trigger"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        class="nd-btn inline-flex items-center gap-1.5 max-w-[11rem]"
        :class="isFiltering ? 'border-brand/60 text-brand' : ''"
        @click="toggle()"
      >
        <UiBaseIcon :path="providerIcon" size="16" class="shrink-0" />
        <span class="truncate">{{ activeLabel }}</span>
        <UiBaseIcon v-if="hasSpoilerProtection" :path="mdiShieldCheckOutline" size="14" class="shrink-0 text-brand" />
      </button>
    </template>

    <template #content>
      <div class="space-y-0.5" role="menu" data-testid="tracker-filter-menu">
        <p class="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {{ providerLabel }}
        </p>

        <button
          v-for="option in standardOptions"
          :key="option.mode"
          type="button"
          role="menuitemradio"
          :aria-checked="filterMode === option.mode"
          :data-testid="`tracker-filter-option-${option.mode}`"
          class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink hover:bg-white/10 transition-colors"
          :class="filterMode === option.mode ? 'bg-white/10 font-medium' : ''"
          @click="select(option.mode)"
        >
          <span class="truncate">{{ t(option.labelKey) }}</span>
          <UiBaseIcon v-if="filterMode === option.mode" :path="mdiCheck" size="14" class="shrink-0 text-brand" />
        </button>

        <!-- Custom lists (patrons) or locked hint (free) -->
        <template v-if="state?.customLists.length">
          <div class="my-1 border-t border-hairline" />
          <p class="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            {{ t('trackerFilter.customListsHeading') }}
          </p>
          <button
            v-for="listName in state.customLists"
            :key="listName"
            type="button"
            role="menuitemradio"
            :aria-checked="filterMode === customListMode(listName)"
            class="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink hover:bg-white/10 transition-colors"
            :class="filterMode === customListMode(listName) ? 'bg-white/10 font-medium' : ''"
            @click="select(customListMode(listName))"
          >
            <span class="truncate">{{ listName }}</span>
            <UiBaseIcon
              v-if="filterMode === customListMode(listName)"
              :path="mdiCheck"
              size="14"
              class="shrink-0 text-brand"
            />
          </button>
        </template>

        <template v-else-if="!state?.canUsePatronPerks && (state?.customListCount ?? 0) > 0">
          <div class="my-1 border-t border-hairline" />
          <NuxtLink
            :to="localePath('/supporters')"
            class="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted hover:bg-white/10 transition-colors"
          >
            <UiBaseIcon :path="mdiLockOutline" size="14" class="shrink-0 text-brand" />
            <span>{{ t('trackerFilter.customListsLocked', { count: state?.customListCount ?? 0 }) }}</span>
          </NuxtLink>
        </template>

        <div class="my-1 border-t border-hairline" />
        <NuxtLink
          :to="localePath('/user/connections')"
          class="block rounded-lg px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink hover:bg-white/10 transition-colors"
        >
          {{ t('trackerFilter.manage') }}
        </NuxtLink>
      </div>
    </template>
  </SearchDropdownContainer>
</template>
