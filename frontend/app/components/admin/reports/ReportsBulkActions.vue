<script setup lang="ts">
import { mdiCheckAll, mdiDeleteOutline, mdiDotsVertical } from '@mdi/js';
import SearchDropdownContainer from '~/components/search/dropdown/DropdownContainer.vue';

defineProps<{
  isDismissing: boolean;
  isDeleting: boolean;
  hasResults: boolean;
}>();

const emit = defineEmits<{
  'dismiss-all': [];
  'delete-all': [];
}>();

const { t } = useI18n();
</script>

<template>
  <SearchDropdownContainer
    dropdown-id="nd-reports-bulk"
    teleport
    teleport-align="end"
    dropdown-container-class="min-w-[13rem]"
  >
    <template #default="{ toggle, isOpen }">
      <button
        type="button"
        data-testid="reports-bulk-menu"
        class="nd-btn !h-8 !w-8 !px-0"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        :aria-label="t('reports.admin.moreActions')"
        @click="toggle"
      >
        <span v-if="isDismissing || isDeleting" class="nd-spinner !mr-0" />
        <UiBaseIcon v-else :path="mdiDotsVertical" :size="16" w="w-4" h="h-4" />
      </button>
    </template>
    <template #content>
      <button
        type="button"
        class="nd-menu-item !gap-x-2.5 !py-1.5 !text-[13px]"
        :disabled="isDismissing || !hasResults"
        @click="emit('dismiss-all')"
      >
        <UiBaseIcon :path="mdiCheckAll" :size="16" w="w-4" h="h-4" />
        {{ isDismissing ? t('reports.admin.dismissingAll') : t('reports.admin.dismissAllMatching') }}
      </button>
      <button
        type="button"
        class="nd-menu-item is-danger !gap-x-2.5 !py-1.5 !text-[13px]"
        :disabled="isDeleting || !hasResults"
        @click="emit('delete-all')"
      >
        <UiBaseIcon :path="mdiDeleteOutline" :size="16" w="w-4" h="h-4" />
        {{ isDeleting ? t('reports.admin.deletingAll') : t('reports.admin.deleteAllMatching') }}
      </button>
    </template>
  </SearchDropdownContainer>
</template>
