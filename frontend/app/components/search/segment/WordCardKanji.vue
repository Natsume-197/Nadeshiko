<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { mdiReplay } from '@mdi/js';
import { type KanjiCardData, type KanjiCardExample, type KanjiCardWordRef, splitKunReading } from '~/utils/kanjiLookup';
import type { KanjiViewState } from '~/composables/useKanjiView';

/**
 * The word card's kanji view (task 44): what the card shows when a reader opens one of a word's kanji.
 *
 * Laid out as a dictionary entry, most useful first, each block under its own rule:
 *   1. the kanji itself: stroke order, meaning, and a row of facts (JLPT, grade, strokes);
 *   2. readings, on then kun, each with the words it is heard in;
 *   3. the words written with it that Nadeshiko's subtitles use most;
 *   4. what it is made of: radical and parts;
 *   5. related kanji, kept short.
 * Accent colour is kept for what responds to the pointer; at rest everything is ink.
 */
const props = defineProps<{
  kanji: string;
  card: KanjiCardData | null;
  state: KanjiViewState;
  /** The reader's gloss language, to say when the meanings had to fall back to English. */
  locale: 'en' | 'es';
}>();

const emit = defineEmits<{
  'open-kanji': [character: string];
  'open-word': [word: KanjiCardWordRef];
}>();

const { t } = useI18n();

/** How many words show before "Show all". */
const WORDS_SHOWN = 6;
/** How many related kanji each row shows. */
const RELATED_SHOWN = 12;

/** Bumped by the replay button: a new key remounts the strokes and restarts the animation. */
const drawing = ref(0);
const allWords = ref(false);
// Another kanji starts with its list short again.
watch(
  () => props.card?.character,
  () => {
    allWords.value = false;
  },
);

/** Seconds between strokes: half a second each, but a 29-stroke kanji still finishes in about six. */
const strokeStep = computed(() => Math.min(0.5, 6 / Math.max(props.card?.strokes.length ?? 1, 1)));

interface ReadingRow {
  key: string;
  stem: string;
  okurigana: string;
  examples: KanjiCardExample[];
}

/** Readings grouped by kind, so the on/kun label is written once per group. */
const readingGroups = computed(() => {
  const groups: Array<{ kind: 'on' | 'kun'; rows: ReadingRow[] }> = [];
  for (const entry of props.card?.readings ?? []) {
    const split = entry.kind === 'kun' ? splitKunReading(entry.reading) : { stem: entry.reading, okurigana: '' };
    let group = groups.find((candidate) => candidate.kind === entry.kind);
    if (!group) {
      group = { kind: entry.kind, rows: [] };
      groups.push(group);
    }
    group.rows.push({ key: entry.reading, ...split, examples: entry.examples });
  }
  return groups;
});

/** The facts row: short, scannable badges. */
const badges = computed(() => {
  const card = props.card;
  if (!card) return [];
  const list: Array<{ id: string; text: string; strong?: boolean }> = [];
  if (card.jlpt !== null) list.push({ id: 'jlpt', text: `N${card.jlpt}`, strong: true });
  if (card.grade !== null) {
    if (card.grade <= 6) list.push({ id: 'grade', text: t('tokenTooltip.kanjiGrade', { grade: card.grade }) });
    else if (card.grade === 8) list.push({ id: 'grade', text: t('tokenTooltip.kanjiJoyo') });
    else list.push({ id: 'grade', text: t('tokenTooltip.kanjiJinmeiyo') });
  }
  list.push({ id: 'strokes', text: t('tokenTooltip.kanjiStrokes', { count: card.strokeCount }, card.strokeCount) });
  if (card.frequency !== null) {
    list.push({ id: 'freq', text: t('tokenTooltip.kanjiNewspaper', { rank: card.frequency }) });
  }
  return list;
});

const shownWords = computed(() => (allWords.value ? props.card?.words : props.card?.words.slice(0, WORDS_SHOWN)) ?? []);

/** Related kanji, each list cut to one short row. */
const related = computed(() => {
  const card = props.card;
  if (!card) return [];
  return [
    {
      id: 'same-radical',
      label: t('tokenTooltip.kanjiSameRadical', { count: card.sameRadicalCount }),
      list: card.sameRadical,
      total: card.sameRadicalCount,
    },
    {
      id: 'contained-in',
      label: t('tokenTooltip.kanjiContainedIn', { count: card.containedInCount }),
      list: card.containedIn,
      total: card.containedInCount,
    },
  ]
    .filter((row) => row.list.length > 0)
    .map((row) => ({ ...row, list: row.list.slice(0, RELATED_SHOWN) }));
});

/** Meanings fell back to English for a reader who reads Spanish: say so with the same tag the senses use. */
const meaningsTag = computed(() =>
  props.card && props.card.meaningsLanguage !== props.locale ? props.card.meaningsLanguage.toUpperCase() : null,
);

/** A related kanji's tooltip: its reading and meaning. */
const relatedTitle = (kanji: { reading: string | null; meaning: string | null }) =>
  [kanji.reading, kanji.meaning].filter(Boolean).join(' · ');
</script>

<template>
  <div class="kanji-view">
    <p v-if="state === 'loading'" class="kanji-view__pending">
      <span class="kanji-view__spinner" aria-hidden="true" />
      <span>{{ $t('tokenTooltip.loading') }}</span>
    </p>
    <p v-else-if="state === 'missing'" class="kanji-view__pending">{{ $t('tokenTooltip.kanjiMissing') }}</p>
    <p v-else-if="state === 'unavailable'" class="kanji-view__pending">{{ $t('tokenTooltip.unavailable') }}</p>

    <template v-else-if="card">
      <!-- 1. The kanji: stroke order beside what it means. -->
      <div class="kanji-view__hero">
        <div v-if="card.strokes.length > 0" class="kanji-view__strokes">
          <svg :key="drawing" viewBox="0 0 109 109" role="img" :style="{ '--step': `${strokeStep}s` }">
            <title>{{ $t('tokenTooltip.kanjiStrokeOrder', { kanji }) }}</title>
            <g class="kanji-view__ghost">
              <path v-for="(d, i) in card.strokes" :key="`g${i}`" :d="d" />
            </g>
            <g class="kanji-view__ink">
              <path v-for="(d, i) in card.strokes" :key="`i${i}`" :d="d" pathLength="1" :style="{ '--i': i }" />
            </g>
            <g class="kanji-view__numbers" aria-hidden="true">
              <text v-for="([x, y], i) in card.strokeNumbers" :key="`n${i}`" :x="x" :y="y" :style="{ '--i': i }">{{ i + 1 }}</text>
            </g>
          </svg>
          <button
            type="button"
            class="kanji-view__replay"
            data-testid="kanji-replay"
            :aria-label="$t('tokenTooltip.kanjiReplay')"
            :title="$t('tokenTooltip.kanjiReplay')"
            @click="drawing += 1"
          >
            <UiBaseIcon :path="mdiReplay" :size="14" />
          </button>
        </div>

        <div class="kanji-view__summary">
          <p v-if="card.meanings.length > 0" class="kanji-view__meanings">
            <span v-if="meaningsTag" class="kanji-view__lang">{{ meaningsTag }}</span>{{ card.meanings.join(', ') }}
          </p>
          <div class="kanji-view__badges">
            <span
              v-for="badge in badges"
              :key="badge.id"
              class="kanji-view__badge"
              :class="{ 'is-strong': badge.strong }"
            >{{ badge.text }}</span>
          </div>
        </div>
      </div>

      <!-- 2. Readings, the label once per group, each with the words it is heard in. A reading none of our words
           uses is shown faint: it exists, but a reader of anime will rarely meet it. -->
      <section v-if="readingGroups.length > 0" class="kanji-view__section">
        <div class="kanji-view__readings">
          <template v-for="group in readingGroups" :key="group.kind">
            <template v-for="(row, ri) in group.rows" :key="`${group.kind}${row.key}`">
              <span class="kanji-view__label">{{ ri === 0 ? $t(group.kind === 'on' ? 'tokenTooltip.kanjiOn' : 'tokenTooltip.kanjiKun') : '' }}</span>
              <span
                class="kanji-view__reading-text"
                :class="{ 'is-rare': row.examples.length === 0 }"
                lang="ja"
                data-testid="kanji-reading"
              >{{ row.stem }}<span v-if="row.okurigana" class="kanji-view__okurigana">{{ row.okurigana }}</span></span>
              <span class="kanji-view__examples" lang="ja">
                <template v-for="(example, ei) in row.examples" :key="example.id">
                  <span v-if="ei > 0" class="kanji-view__sep" aria-hidden="true">、</span>
                  <button
                    type="button"
                    class="kanji-view__example"
                    :aria-label="example.reading ? `${example.headword} (${example.reading})` : example.headword"
                    @click="emit('open-word', example)"
                  ><template v-if="example.furigana.length > 0"><template v-for="(seg, si) in example.furigana" :key="si"><ruby v-if="seg.ruby">{{ seg.text }}<rt>{{ seg.ruby }}</rt></ruby><template v-else>{{ seg.text }}</template></template></template><template v-else>{{ example.headword }}</template></button>
                </template>
              </span>
            </template>
          </template>
        </div>
      </section>

      <!-- 3. Words, from our own subtitles. -->
      <section v-if="card.words.length > 0" class="kanji-view__section">
        <h4 class="kanji-view__heading">{{ $t('tokenTooltip.kanjiWords') }}</h4>
        <div class="kanji-view__words">
          <button
            v-for="word in shownWords"
            :key="word.id"
            type="button"
            class="kanji-view__word"
            data-testid="kanji-word"
            @click="emit('open-word', word)"
          >
            <span class="kanji-view__word-text" lang="ja">{{ word.headword }}</span>
            <span v-if="word.reading && word.reading !== word.headword" class="kanji-view__word-reading" lang="ja">{{ word.reading }}</span>
            <span v-if="word.gloss" class="kanji-view__word-gloss">{{ word.gloss }}</span>
          </button>
        </div>
        <button
          v-if="card.words.length > WORDS_SHOWN"
          type="button"
          class="kanji-view__more"
          data-testid="kanji-more-words"
          @click="allWords = !allWords"
        >{{ allWords ? $t('tokenTooltip.showLess') : $t('tokenTooltip.kanjiAllWords', { count: card.words.length }) }}</button>
      </section>

      <!-- 4. What it is made of. -->
      <section v-if="card.radical || card.components.length > 0" class="kanji-view__section">
        <div class="kanji-view__facts">
          <template v-if="card.radical">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiRadical') }}</span>
            <span class="kanji-view__fact" data-testid="kanji-radical">
              <button
                v-if="card.radical.character && card.radical.character !== card.character"
                type="button"
                class="kanji-view__glyph is-link"
                lang="ja"
                :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: card.radical.character })"
                @click="emit('open-kanji', card.radical.character)"
              >{{ card.radical.glyph }}</button>
              <span v-else class="kanji-view__glyph" lang="ja">{{ card.radical.glyph }}</span>
              <span class="kanji-view__note"><span lang="ja">{{ card.radical.reading }}</span> · {{ card.radical.meaning }}</span>
            </span>
          </template>
          <template v-if="card.components.length > 0">
            <span class="kanji-view__label">{{ $t('tokenTooltip.kanjiParts') }}</span>
            <span class="kanji-view__fact kanji-view__parts">
              <template v-for="part in card.components" :key="part.character">
                <button
                  v-if="part.hasCard"
                  type="button"
                  class="kanji-view__part"
                  :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: part.character })"
                  @click="emit('open-kanji', part.character)"
                ><span class="kanji-view__glyph" lang="ja">{{ part.character }}</span><span v-if="part.meaning" class="kanji-view__note">{{ part.meaning }}</span></button>
                <span v-else class="kanji-view__part is-static"><span class="kanji-view__glyph" lang="ja">{{ part.character }}</span><span v-if="part.meaning" class="kanji-view__note">{{ part.meaning }}</span></span>
              </template>
            </span>
          </template>
        </div>
      </section>

      <!-- 5. Related kanji, one short row each. -->
      <section v-if="related.length > 0" class="kanji-view__section">
        <div class="kanji-view__facts">
          <template v-for="row in related" :key="row.id">
            <span class="kanji-view__label">{{ row.label }}</span>
            <span class="kanji-view__related" :data-testid="`kanji-${row.id}`">
              <button
                v-for="other in row.list"
                :key="other.character"
                type="button"
                class="kanji-view__related-kanji"
                lang="ja"
                :title="relatedTitle(other)"
                :aria-label="$t('tokenTooltip.kanjiOpen', { kanji: other.character })"
                @click="emit('open-kanji', other.character)"
              >{{ other.character }}</button>
              <span v-if="row.total > row.list.length" class="kanji-view__note">+{{ row.total - row.list.length }}</span>
            </span>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.kanji-view__pending {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 13px;
  color: var(--ink-muted);
}

.kanji-view__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 999px;
  animation: kanji-view-spin 0.8s linear infinite;
}

@keyframes kanji-view-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Blocks: one rhythm for all of them and a hairline between, so the eye can find each. */
.kanji-view__section {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.kanji-view__heading,
.kanji-view__label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  color: var(--ink-faint);
}

.kanji-view__heading {
  margin-bottom: 4px;
}

.kanji-view__note {
  font-size: 12px;
  color: var(--ink-muted);
}

/* 1. The kanji. */
.kanji-view__hero {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 6px;
}

.kanji-view__strokes {
  position: relative;
  flex: 0 0 auto;
  width: 88px;
  height: 88px;
  border: 1px solid var(--line);
  border-radius: 10px;
}

.kanji-view__strokes svg {
  width: 100%;
  height: 100%;
}

.kanji-view__strokes path {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.kanji-view__ghost path {
  stroke: var(--line);
}

.kanji-view__ink path {
  stroke: var(--ink);
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: kanji-view-draw calc(var(--step) * 0.9) ease-out forwards;
  animation-delay: calc(var(--i) * var(--step));
}

@keyframes kanji-view-draw {
  to {
    stroke-dashoffset: 0;
  }
}

.kanji-view__numbers text {
  font-size: 8px;
  fill: var(--ink-faint);
  opacity: 0;
  animation: kanji-view-number 0.2s ease-out forwards;
  animation-delay: calc(var(--i) * var(--step));
}

@keyframes kanji-view-number {
  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .kanji-view__ink path {
    animation: none;
    stroke-dashoffset: 0;
  }

  .kanji-view__numbers text {
    animation: none;
    opacity: 1;
  }
}

.kanji-view__replay {
  position: absolute;
  right: 3px;
  bottom: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--ink-faint);
  background: transparent;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.kanji-view__replay:hover {
  background: var(--surface-lift);
  color: var(--ink);
}

.kanji-view__summary {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kanji-view__meanings {
  font-size: 16px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--ink);
}

.kanji-view__lang {
  display: inline-flex;
  margin-right: 6px;
  padding: 1px 4px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 9px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ink-muted);
  vertical-align: 2px;
}

.kanji-view__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.kanji-view__badge {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--surface-lift);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
}

.kanji-view__badge.is-strong {
  background: color-mix(in srgb, var(--accent-soft) 16%, transparent);
  color: var(--accent-soft);
}

/* 2. Readings: label | reading | words, in one grid so the columns line up. Rows leave room for the ruby over
   the examples. */
.kanji-view__readings {
  display: grid;
  grid-template-columns: auto auto 1fr;
  column-gap: 12px;
  row-gap: 6px;
  align-items: baseline;
}

.kanji-view__reading-text {
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
}

.kanji-view__reading-text.is-rare {
  color: var(--ink-faint);
}

.kanji-view__okurigana {
  color: var(--ink-faint);
}

.kanji-view__examples {
  min-width: 0;
  font-size: 13px;
  color: var(--ink-muted);
}

.kanji-view__sep {
  color: var(--ink-faint);
}

.kanji-view__example {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
}

.kanji-view__example {
  line-height: 1.9;
}

.kanji-view__example rt {
  font-size: 0.6em;
  color: var(--ink-faint);
}

.kanji-view__example:hover,
.kanji-view__example:hover rt {
  color: var(--accent-soft);
}

/* 3. Words. */
.kanji-view__words {
  display: flex;
  flex-direction: column;
}

.kanji-view__word {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 3px 6px;
  margin: 0 -6px;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.kanji-view__word:hover {
  background: var(--surface-lift);
}

.kanji-view__word-text {
  flex: 0 0 auto;
  font-size: 15px;
  color: var(--ink);
}

.kanji-view__word-reading {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--ink-muted);
}

.kanji-view__word-gloss {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-faint);
}

.kanji-view__more {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-soft);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.kanji-view__more:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* 4 and 5. Label | content rows, aligned like the readings. */
.kanji-view__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 12px;
  row-gap: 8px;
  align-items: baseline;
}

.kanji-view__fact {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.kanji-view__parts {
  gap: 4px 14px;
}

.kanji-view__glyph {
  font-size: 16px;
  color: var(--ink);
}

button.kanji-view__glyph {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

button.kanji-view__glyph:hover,
button.kanji-view__part:hover .kanji-view__glyph {
  color: var(--accent-soft);
}

.kanji-view__part {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

button.kanji-view__part {
  cursor: pointer;
}

.kanji-view__related {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px;
  min-width: 0;
}

.kanji-view__related-kanji {
  padding: 1px 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    color 0.12s ease;
}

.kanji-view__related-kanji:hover {
  background: color-mix(in srgb, var(--accent-soft) 14%, transparent);
  color: var(--accent-soft);
}

.kanji-view__word:focus-visible,
.kanji-view__part:focus-visible,
.kanji-view__replay:focus-visible,
.kanji-view__example:focus-visible,
.kanji-view__more:focus-visible,
.kanji-view__related-kanji:focus-visible,
button.kanji-view__glyph:focus-visible {
  outline: 2px solid var(--input-focus-ring);
  outline-offset: 2px;
}
</style>
