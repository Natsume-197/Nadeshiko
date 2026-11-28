<script setup lang="ts">
import { mdiClose, mdiLinkVariant, mdiMagnify } from '@mdi/js';

interface MediaSuggestion {
  publicId: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label: string;
    initialName?: string | null;
    searchPlaceholder?: string;
    searchTestId?: string;
    optionTestIdPrefix?: string;
  }>(),
  {
    initialName: null,
    searchPlaceholder: undefined,
    searchTestId: undefined,
    optionTestIdPrefix: undefined,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const { t } = useI18n();
const sdk = useNadeshikoSdk();

/** The raw public-ID field is a fallback; it stays hidden until asked for. */
const showRawId = ref(false);

const query = ref('');
const results = ref<MediaSuggestion[]>([]);
const searching = ref(false);
const resolvedNames = reactive<Record<string, string>>({});
let timer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => [props.modelValue, props.initialName] as const,
  ([id, name]) => {
    if (id && name) resolvedNames[id] = name;
  },
  { immediate: true },
);

watch(query, (raw) => {
  clearTimeout(timer);
  const q = raw.trim();
  if (q.length < 2) {
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  timer = setTimeout(async () => {
    try {
      const res = await sdk.listMedia({ query: q, take: 6 });
      results.value = (res?.media ?? []).map((m) => ({
        publicId: m.publicId,
        label: m.nameEn || m.nameRomaji || m.nameJa || m.publicId,
      }));
    } catch {
      results.value = [];
    } finally {
      searching.value = false;
    }
  }, 250);
});

onScopeDispose(() => {
  clearTimeout(timer);
});

function selectSuggestion(suggestion: MediaSuggestion) {
  resolvedNames[suggestion.publicId] = suggestion.label;
  emit('update:modelValue', suggestion.publicId);
  clearTimeout(timer);
  query.value = '';
  results.value = [];
  searching.value = false;
}
</script>

<template>
  <div class="space-y-2">
    <span class="nd-admin-label !mb-0">{{ label }}</span>

    <div
      v-if="modelValue"
      class="flex items-center justify-between gap-2 rounded-lg border border-brand/30 bg-brand/10 px-3 py-2 text-[13px]"
    >
      <span class="flex min-w-0 items-center gap-2">
        <UiBaseIcon :path="mdiLinkVariant" :size="14" w="w-3.5" h="h-3.5" class="shrink-0 text-brand" />
        <span class="truncate">
          <span v-if="resolvedNames[modelValue]" class="font-medium text-ink">{{ resolvedNames[modelValue] }}</span>
          <span class="ml-1.5 font-mono text-xs text-ink-muted">{{ modelValue }}</span>
        </span>
      </span>
      <button
        type="button"
        class="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-surface-hover hover:text-ink"
        :aria-label="t('requests.admin.picker.clear')"
        @click="emit('update:modelValue', '')"
      >
        <UiBaseIcon :path="mdiClose" :size="14" w="w-3.5" h="h-3.5" />
      </button>
    </div>

    <div class="relative">
      <UiBaseIcon
        :path="mdiMagnify"
        :size="15"
        w="w-4"
        h="h-4"
        class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
      />
      <input
        v-model="query"
        :data-testid="searchTestId"
        class="nd-input w-full !h-8 !pl-8 !text-[13px]"
        :placeholder="searchPlaceholder ?? t('requests.admin.picker.search')"
        :aria-label="t('requests.admin.picker.search')"
      >
      <div
        v-if="results.length || searching"
        class="nd-menu absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto"
      >
        <p v-if="searching && !results.length" class="px-3 py-2 text-xs text-ink-faint">
          {{ t('requests.admin.picker.searching') }}
        </p>
        <button
          v-for="suggestion in results"
          :key="suggestion.publicId"
          type="button"
          :data-testid="optionTestIdPrefix ? `${optionTestIdPrefix}-${suggestion.publicId}` : undefined"
          class="nd-menu-item justify-between gap-2 text-[13px]"
          @click="selectSuggestion(suggestion)"
        >
          <span class="truncate font-medium text-ink">{{ suggestion.label }}</span>
          <span class="shrink-0 font-mono text-[11px] text-ink-faint">{{ suggestion.publicId }}</span>
        </button>
      </div>
    </div>

    <input
      v-if="showRawId"
      :value="modelValue"
      maxlength="32"
      class="nd-input w-full !h-8 font-mono !text-xs"
      :placeholder="t('requests.admin.picker.rawId')"
      :aria-label="t('requests.admin.picker.rawId')"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <button
      v-else
      type="button"
      class="text-xs text-ink-faint transition hover:text-ink"
      @click="showRawId = true"
    >
      {{ t('requests.admin.picker.pasteId') }}
    </button>
  </div>
</template>
