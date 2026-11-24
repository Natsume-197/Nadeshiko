<script setup lang="ts">
import { mdiBellRing, mdiTextBoxSearchOutline, mdiThumbUpOutline } from '@mdi/js';
import { notificationTarget, wordPath, type NotificationEntry, type NotificationWord } from '~/composables/useNotifications';

/**
 * One entry of the notification panel: what happened, when, and where it leads. A single word or a request makes the
 * whole row one link (a stretched link over the row); several words list each word as its own link.
 */
const props = defineProps<{ entry: NotificationEntry }>();
const emit = defineEmits<{ open: [entry: NotificationEntry] }>();

const { t } = useI18n();
const { formatRelativeTime, formatNumber } = useFormat();
const localePath = useLocalePath();

const words = computed(() => props.entry.payload.words ?? []);
const target = computed(() => notificationTarget(props.entry));

const text = computed(() => {
  const entry = props.entry;
  if (entry.kind === 'request-update') {
    return t(entry.payload.status === 'RELEASED' ? 'notifications.kinds.requestReleased' : 'notifications.kinds.requestInProgress', {
      title: entry.payload.title ?? '',
    });
  }
  const first = words.value[0];
  if (entry.kind === 'word-available') {
    return words.value.length === 1 && first
      ? t('notifications.kinds.wordAvailable', { word: first.query })
      : t('notifications.kinds.wordAvailableMany', { count: words.value.length });
  }
  return words.value.length === 1 && first
    ? t('notifications.kinds.wordDigest', { word: first.query, count: first.newSentences ?? 0 })
    : t('notifications.kinds.wordDigestMany', { count: words.value.length });
});

/** The titles the sentences come from, for a single word. */
const titles = computed(() => (words.value.length === 1 ? (words.value[0]?.titles ?? []).slice(0, 3).join(', ') : ''));

const icon = computed(() => {
  if (props.entry.kind === 'request-update') return mdiThumbUpOutline;
  return props.entry.kind === 'word-available' ? mdiBellRing : mdiTextBoxSearchOutline;
});

/** "+12" new sentences in a digest; the sentence count of a first appearance. */
function wordCount(word: NotificationWord): string {
  const digest = props.entry.kind === 'word-digest';
  const count = digest ? word.newSentences : word.sentences;
  if (typeof count !== 'number') return '';
  return `${digest ? '+' : ''}${formatNumber(count)}`;
}
</script>

<template>
  <div
    class="relative flex items-start gap-3 px-4 py-3 transition-colors"
    :class="[!entry.read ? 'bg-brand/[0.05]' : '', target ? 'hover:bg-surface-lift' : '']"
    data-testid="notification-entry"
  >
    <NuxtLink
      v-if="target"
      :to="localePath(target)"
      class="absolute inset-0"
      :aria-label="text"
      data-testid="notification-link"
      @click="emit('open', entry)"
    />
    <span class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand" aria-hidden="true">
      <UiBaseIcon :path="icon" :size="16" w="w-4" h="h-4" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-baseline justify-between gap-3">
        <span class="text-sm leading-snug" :class="entry.read ? 'text-ink-muted' : 'font-semibold text-ink'">{{ text }}</span>
        <span class="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint">
          <span v-if="!entry.read" class="size-1.5 rounded-full bg-brand" :aria-label="$t('notifications.bell.unreadDot')" />
          {{ formatRelativeTime(entry.createdAt) }}
        </span>
      </span>
      <span v-if="titles" class="mt-0.5 block truncate text-xs text-ink-faint">{{ titles }}</span>
      <span v-if="!target && words.length > 0" class="relative mt-2 flex flex-wrap gap-1.5" data-testid="notification-words">
        <NuxtLink
          v-for="word in words"
          :key="word.query"
          :to="localePath(wordPath(word))"
          class="inline-flex items-baseline gap-1 rounded-md border border-hairline px-2 py-0.5 text-sm text-ink transition-colors hover:border-brand/50 hover:text-brand"
          data-testid="notification-word"
          @click="emit('open', entry)"
        >
          <span lang="ja">{{ word.query }}</span>
          <span v-if="wordCount(word)" class="text-[11px] text-ink-faint">{{ wordCount(word) }}</span>
        </NuxtLink>
      </span>
    </span>
  </div>
</template>
