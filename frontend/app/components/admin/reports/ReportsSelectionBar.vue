<script setup lang="ts">
import { mdiChevronDown, mdiClose, mdiDeleteOutline } from '@mdi/js';
import SearchDropdownContainer from '~/components/search/dropdown/DropdownContainer.vue';
import { ALL_STATUSES, statusDot } from './reportHelpers';

defineProps<{
  count: number;
  isUpdating: boolean;
}>();

const emit = defineEmits<{
  update: [status: string];
  delete: [];
  clear: [];
}>();

const { t } = useI18n();
const { formatNumber } = useFormat();
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-1.5"
    data-testid="reports-selection-bar"
  >
    <span class="text-[13px] font-medium tabular-nums text-ink">
      {{ t('reports.admin.selectedGroups', { count: formatNumber(count) }) }}
    </span>
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <span v-if="isUpdating" class="nd-spinner text-ink-faint" />
      <SearchDropdownContainer
        dropdown-id="nd-reports-batch-status"
        teleport
        teleport-align="end"
        dropdown-container-class="min-w-[11rem]"
      >
        <template #default="{ toggle, isOpen }">
          <button
            type="button"
            class="nd-btn !h-8 !text-[13px]"
            aria-haspopup="menu"
            :aria-expanded="isOpen"
            :disabled="isUpdating"
            @click="toggle"
          >
            {{ t('reports.admin.setStatus') }}
            <UiBaseIcon :path="mdiChevronDown" :size="16" w="w-4" h="h-4" class="text-ink-faint" />
          </button>
        </template>
        <template #content>
          <button
            v-for="status in ALL_STATUSES"
            :key="status"
            type="button"
            class="nd-menu-item !gap-x-2.5 !py-1.5 !text-[13px]"
            :disabled="isUpdating"
            @click="emit('update', status)"
          >
            <span class="size-1.5 rounded-full" :class="statusDot(status)" />
            {{ t(`reports.statuses.${status}`) }}
          </button>
        </template>
      </SearchDropdownContainer>
      <button type="button" class="nd-btn-danger !h-8 !px-3 !text-[13px]" :disabled="isUpdating" @click="emit('delete')">
        <UiBaseIcon :path="mdiDeleteOutline" :size="16" w="w-4" h="h-4" />
        {{ t('reports.admin.delete') }}
      </button>
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-hover hover:text-ink"
        :aria-label="t('reports.admin.clearSelection')"
        @click="emit('clear')"
      >
        <UiBaseIcon :path="mdiClose" :size="16" w="w-4" h="h-4" />
      </button>
    </div>
  </div>
</template>
