<script setup lang="ts">
import { mdiClose } from '@mdi/js';
import type { ConjugatedForm, ConjugationTable } from '~/utils/japaneseConjugator';
import { buildWordSearchPath } from '~/utils/routes';

defineProps<{
  open: boolean;
  table: ConjugationTable;
}>();

const emit = defineEmits<{
  close: [];
}>();

const localePath = useLocalePath();
const wordPath = (word: string) => localePath(buildWordSearchPath(word));

const cols = ['plainAff', 'plainNeg', 'politeAff', 'politeNeg'] as const;
function cellOf(row: Record<(typeof cols)[number], ConjugatedForm | null>, col: (typeof cols)[number]) {
  return row[col];
}
</script>

<template>
  <CommonBaseModal
    data-testid="conjugations-modal"
    :open="open"
    z-index-class="z-[70]"
    overlay-class="items-center justify-center bg-fixed-black/60 p-3 sm:p-5"
    panel-class="bg-card-background border border-hairline rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
    labelledby="nd-conjugations-modal-title"
    @close="emit('close')"
  >
    <!-- Header -->
    <div class="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
      <div class="space-y-1.5 min-w-0">
        <div class="flex flex-wrap items-center gap-2.5">
          <h3 id="nd-conjugations-modal-title" class="text-lg font-bold text-ink">
            {{ $t('wordEntry.conjugations.title', { word: table.headword }) }}
          </h3>
          <span class="rounded-md bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">
            {{ $t(`wordEntry.conjugations.classes.${table.classKey}`) }}
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span class="inline-flex items-center gap-1.5">
            <span class="conj-dot-stem h-2 w-2 rounded-full" aria-hidden="true" />
            {{ $t('wordEntry.conjugations.stem') }}
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
            {{ $t('wordEntry.conjugations.ending') }}
          </span>
          <span class="text-ink-faint">· {{ $t('wordEntry.conjugations.clickHint') }}</span>
        </div>
      </div>

      <button
        type="button"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-lift hover:text-ink transition-colors"
        :aria-label="$t('common.close')"
        @click="emit('close')"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path :d="mdiClose" />
        </svg>
      </button>
    </div>

    <!-- Matrix -->
    <div class="overflow-auto px-5 py-4">
      <table class="conj-table w-full border-collapse text-sm">
        <thead>
          <tr class="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
            <th class="w-44 pb-1 text-left" scope="col" />
            <th class="pb-1 text-left" colspan="2" scope="colgroup">{{ $t('wordEntry.conjugations.plain') }}</th>
            <th class="pb-1 text-left" colspan="2" scope="colgroup">{{ $t('wordEntry.conjugations.polite') }}</th>
          </tr>
          <tr class="border-b border-hairline text-xs font-semibold text-ink-muted">
            <th class="pb-2.5 text-left" scope="col" />
            <th class="pb-2.5 pr-3 text-left" scope="col">{{ $t('wordEntry.conjugations.affirmative') }}</th>
            <th class="pb-2.5 pr-3 text-left" scope="col">{{ $t('wordEntry.conjugations.negative') }}</th>
            <th class="pb-2.5 pr-3 text-left" scope="col">{{ $t('wordEntry.conjugations.affirmative') }}</th>
            <th class="pb-2.5 text-left" scope="col">{{ $t('wordEntry.conjugations.negative') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in table.groups" :key="group.key">
            <tr class="conj-group-row">
              <th
                colspan="5"
                scope="rowgroup"
                class="pt-4 pb-1.5 text-left text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint"
              >
                {{ $t(`wordEntry.conjugations.groups.${group.key}`) }}
              </th>
            </tr>
            <tr v-for="row in group.rows" :key="row.key" class="border-t border-hairline/60">
              <th class="py-2 pr-3 text-left align-middle font-medium text-ink" scope="row">
                <span class="block text-[13px] leading-tight">{{ $t(`wordEntry.conjugations.rows.${row.key}`) }}</span>
              </th>
              <td v-for="col in cols" :key="col" class="py-2 pr-3 align-middle">
                <NuxtLink
                  v-if="cellOf(row, col)"
                  :to="wordPath(cellOf(row, col)?.full ?? '')"
                  class="conj-link"
                  lang="ja"
                  @click="emit('close')"
                >
                  <span>{{ cellOf(row, col)?.stem }}</span><span class="conj-ending">{{ cellOf(row, col)?.ending }}</span>
                </NuxtLink>
                <span v-else class="text-xs text-ink-faint">—</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </CommonBaseModal>
</template>

<style scoped>
.conj-link {
  display: inline-block;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 6px;
  color: var(--ink);
  font-size: 14px;
  white-space: nowrap;
  transition: background-color 0.12s ease;
}

.conj-link:hover {
  background: var(--surface-lift);
}

.conj-ending {
  color: var(--accent-soft);
  font-weight: 600;
}

.conj-dot-stem {
  background: var(--ink-muted);
}
</style>
