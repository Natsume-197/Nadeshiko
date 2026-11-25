<script setup lang="ts">
import { mdiCogOutline, mdiPlaylistCheck, mdiShieldCheckOutline } from '@mdi/js';
import { useTrackerSync } from '~/composables/useTrackerSync';
import { customListMode, customListNameFromMode } from '~/utils/trackerFilter';

const { t } = useI18n();
const localePath = useLocalePath();
const { state, isConnected, filterMode, searchFilters, setFilterMode } = useTrackerSync();

const emit = defineEmits<{
  /** The filter changed; the mobile filter drawer closes on it, like Sort. */
  selected: [];
}>();

const isOn = computed(() => filterMode.value !== 'all');
const hasSpoilerProtection = computed(() => searchFilters.value.activeSpoilerProtectionCount > 0);

/** Patrons with AniList custom lists can narrow the switch to one of them. */
const customLists = computed(() => (state.value?.canUsePatronPerks ? (state.value.customLists ?? []) : []));
const selectedList = computed(() => customListNameFromMode(filterMode.value) ?? '');

function toggle() {
  emit('selected');
  setFilterMode(isOn.value ? 'all' : 'my-anime');
}

function pickList(event: Event) {
  const name = (event.target as HTMLSelectElement).value;
  emit('selected');
  setFilterMode(name ? customListMode(name) : 'my-anime');
}
</script>

<template>
  <!-- Sits under Sort in the filter panel. `text-sm` is load-bearing on desktop: the sidebar column is
       `yomitan-ignore` (font-size: 0). -->
  <div
    v-if="isConnected"
    data-testid="tracker-filter"
    class="w-full rounded-lg border bg-button-primary-main text-sm"
    :class="isOn ? 'border-brand/60' : 'border-hairline'"
  >
    <div class="flex items-stretch">
    <button
      type="button"
      role="switch"
      :aria-checked="isOn"
      data-testid="tracker-filter-switch"
      class="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-4 pr-2 text-left font-semibold text-ink hover:bg-surface-hover rounded-l-lg outline-none"
      @click="toggle()"
    >
      <UiBaseIcon :path="mdiPlaylistCheck" size="18" class="shrink-0" />
      <span class="min-w-0 flex-1">{{ t('trackerFilter.onlySeen') }}</span>
      <UiBaseIcon v-if="hasSpoilerProtection" :path="mdiShieldCheckOutline" size="16" class="shrink-0 text-brand" />
      <span
        aria-hidden="true"
        class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        :class="isOn ? 'bg-brand' : 'bg-white/15'"
      >
        <span
          class="inline-block size-3.5 rounded-full bg-white transition-transform"
          :class="isOn ? 'translate-x-[1.1rem]' : 'translate-x-[0.2rem]'"
        />
      </span>
    </button>
    <NuxtLink
      :to="localePath('/user/connections#anime-tracker')"
      :aria-label="t('trackerFilter.settings')"
      :title="t('trackerFilter.settings')"
      data-testid="tracker-filter-settings"
      class="flex shrink-0 items-center border-l border-hairline px-3 text-ink-muted hover:text-ink hover:bg-surface-hover rounded-r-lg"
    >
      <UiBaseIcon :path="mdiCogOutline" size="18" />
    </NuxtLink>
    </div>

    <div v-if="isOn && customLists.length" class="px-4 pb-3">
      <select
        :value="selectedList"
        :aria-label="t('trackerFilter.customListsHeading')"
        data-testid="tracker-filter-list"
        class="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs text-ink"
        @change="pickList"
      >
        <option value="">{{ t('trackerFilter.allLists') }}</option>
        <option v-for="name in customLists" :key="name" :value="name">{{ name }}</option>
      </select>
    </div>
  </div>
</template>
