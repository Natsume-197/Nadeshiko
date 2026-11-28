<script setup lang="ts">
import {
  mdiArrowRight,
  mdiBellRing,
  mdiBullhornOutline,
  mdiCheckCircleOutline,
  mdiEmailOutline,
  mdiTextBoxSearchOutline,
  mdiThumbUpOutline,
} from '@mdi/js';
import {
  isOfficialEntry,
  notificationTarget,
  wordPath,
  type NotificationEntry,
  type NotificationWord,
} from '~/composables/useNotifications';

/**
 * One entry of the notification panel: what happened, when, and where it leads.
 * - Single word or request: whole row is one stretched link.
 * - Several words: each word is its own link.
 * - Official notices (`site-announcement` / `admin-message`): pinned with an accent border; clicking expands the full
 *   message inline and marks it read without navigating away, showing an explicit link button when `linkUrl` is set.
 */
const props = defineProps<{ entry: NotificationEntry }>();
const emit = defineEmits<{ open: [entry: NotificationEntry]; read: [entry: NotificationEntry] }>();

const { t } = useI18n();
const { formatRelativeTime, formatNumber } = useFormat();
const localePath = useLocalePath();

const expanded = ref(false);
const official = computed(() => isOfficialEntry(props.entry));
const words = computed(() => props.entry.payload.words ?? []);
const target = computed(() => notificationTarget(props.entry));

const safeOfficialLink = computed(() => {
  const raw = props.entry.payload.linkUrl?.trim() ?? '';
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
});

const text = computed(() => {
  const entry = props.entry;
  if (official.value) {
    return entry.payload.title ?? t('notifications.kinds.officialFallback');
  }
  if (entry.kind === 'report-resolved') {
    const count = entry.payload.count ?? entry.groupCount ?? 1;
    return count > 1
      ? t('notifications.kinds.reportResolvedMany', { count })
      : t('notifications.kinds.reportResolved');
  }
  if (entry.kind === 'request-update') {
    if (entry.payload.status === 'RELEASED') {
      return t('notifications.kinds.requestReleased', { title: entry.payload.title ?? '' });
    }
    if (entry.payload.status === 'DECLINED') {
      return t('notifications.kinds.requestDeclined', { title: entry.payload.title ?? '' });
    }
    if (entry.payload.status === 'MERGED') {
      return t('notifications.kinds.requestMerged', {
        title: entry.payload.title ?? '',
        target: entry.payload.mergedIntoTitle ?? '',
      });
    }
    return t('notifications.kinds.requestInProgress', { title: entry.payload.title ?? '' });
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

/** Secondary line for single-word notices or declined request reasons. */
const subtitle = computed(() => {
  if (props.entry.kind === 'request-update' && props.entry.payload.status === 'DECLINED' && props.entry.payload.reason) {
    return props.entry.payload.reason;
  }
  return words.value.length === 1 ? (words.value[0]?.titles ?? []).slice(0, 3).join(', ') : '';
});

const icon = computed(() => {
  if (props.entry.kind === 'site-announcement') return mdiBullhornOutline;
  if (props.entry.kind === 'admin-message') return mdiEmailOutline;
  if (props.entry.kind === 'report-resolved') return mdiCheckCircleOutline;
  if (props.entry.kind === 'request-update') return mdiThumbUpOutline;
  return props.entry.kind === 'word-available' ? mdiBellRing : mdiTextBoxSearchOutline;
});

function wordCount(word: NotificationWord): string {
  const digest = props.entry.kind === 'word-digest';
  const count = digest ? word.newSentences : word.sentences;
  if (typeof count !== 'number') return '';
  return `${digest ? '+' : ''}${formatNumber(count)}`;
}

function toggleOfficial() {
  expanded.value = !expanded.value;
  if (!props.entry.read) {
    emit('read', props.entry);
  }
}

function onReportClick() {
  if (!props.entry.read) emit('read', props.entry);
}
</script>

<template>
  <div
    class="relative flex items-start gap-3 px-4 py-3 transition-colors"
    :class="[
      !entry.read ? 'bg-brand/[0.05]' : '',
      official ? 'border-l-2 border-brand hover:bg-surface-lift' : '',
      target ? 'hover:bg-surface-lift' : '',
      entry.kind === 'report-resolved' && !entry.read ? 'hover:bg-surface-lift' : '',
    ]"
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
    <button
      v-else-if="official || (entry.kind === 'report-resolved' && !entry.read)"
      type="button"
      class="absolute inset-0 cursor-pointer"
      :aria-label="text"
      @click="official ? toggleOfficial() : onReportClick()"
    />
    <span
      class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand"
      aria-hidden="true"
    >
      <UiBaseIcon :path="icon" :size="16" w="w-4" h="h-4" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex items-baseline justify-between gap-3">
        <span class="text-sm leading-snug" :class="entry.read ? 'text-ink-muted' : 'font-semibold text-ink'">
          {{ text }}
        </span>
        <span class="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-faint">
          <span
            v-if="!entry.read"
            class="size-1.5 rounded-full bg-brand"
            :aria-label="$t('notifications.bell.unreadDot')"
          />
          {{ formatRelativeTime(entry.createdAt) }}
        </span>
      </span>

      <span
        v-if="official && entry.payload.message"
        class="mt-1 block whitespace-pre-line text-xs leading-relaxed text-ink-muted"
        :class="expanded ? '' : 'line-clamp-2'"
        data-testid="notification-official-message"
      >
        {{ entry.payload.message }}
      </span>

      <span v-if="official && safeOfficialLink" class="relative mt-2 inline-block">
        <NuxtLink
          :to="safeOfficialLink"
          class="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          data-testid="notification-official-link"
          @click.stop="emit('open', entry)"
        >
          <span>{{ entry.payload.linkLabel || $t('notifications.bell.openLink') }}</span>
          <UiBaseIcon :path="mdiArrowRight" :size="13" w="w-3.5" h="h-3.5" aria-hidden="true" />
        </NuxtLink>
      </span>

      <span v-if="subtitle" class="mt-0.5 block truncate text-xs text-ink-faint">{{ subtitle }}</span>

      <span
        v-if="!target && words.length > 0"
        class="relative mt-2 flex flex-wrap gap-1.5"
        data-testid="notification-words"
      >
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
