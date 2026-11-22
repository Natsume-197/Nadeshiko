<script setup lang="ts">
import { mdiClose } from '@mdi/js';

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
    sideBySide?: boolean;
  }>(),
  {
    initialName: null,
    searchPlaceholder: 'Search Nadeshiko media…',
    searchTestId: undefined,
    optionTestIdPrefix: undefined,
    sideBySide: false,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const sdk = useNadeshikoSdk();

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
    <span class="block text-xs font-semibold uppercase tracking-wider text-ink-faint">
      {{ label }}
    </span>

    <div
      v-if="modelValue"
      class="flex items-center justify-between gap-2 rounded-lg border border-brand/30 bg-brand/10 px-3 py-1.5 text-xs"
    >
      <span class="truncate text-ink">
        <strong v-if="resolvedNames[modelValue]">{{ resolvedNames[modelValue] }} · </strong>
        <span class="font-mono text-ink-muted">{{ modelValue }}</span>
      </span>
      <button
        type="button"
        class="shrink-0 text-ink-faint hover:text-ink"
        aria-label="Clear linked media"
        @click="emit('update:modelValue', '')"
      >
        <UiBaseIcon :path="mdiClose" w="w-3.5" h="h-3.5" size="14" />
      </button>
    </div>

    <div :class="sideBySide ? 'grid gap-2 sm:grid-cols-2' : 'space-y-2'">
      <div class="relative">
        <input
          v-model="query"
          :data-testid="searchTestId"
          class="nd-input w-full"
          :placeholder="searchPlaceholder"
          aria-label="Search Nadeshiko media"
        >
        <div
          v-if="results.length || searching"
          class="nd-menu absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto"
        >
          <p v-if="searching && !results.length" class="px-3 py-2 text-xs text-ink-faint">Searching…</p>
          <button
            v-for="suggestion in results"
            :key="suggestion.publicId"
            type="button"
            :data-testid="optionTestIdPrefix ? `${optionTestIdPrefix}-${suggestion.publicId}` : undefined"
            class="nd-menu-item justify-between gap-2 text-xs"
            @click="selectSuggestion(suggestion)"
          >
            <span class="truncate font-medium text-ink">{{ suggestion.label }}</span>
            <span class="shrink-0 font-mono text-[10px] text-ink-faint">{{ suggestion.publicId }}</span>
          </button>
        </div>
      </div>

      <input
        :value="modelValue"
        maxlength="32"
        class="nd-input w-full font-mono text-xs"
        placeholder="Or paste media public ID"
        aria-label="Media public id"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      >
    </div>
  </div>
</template>
