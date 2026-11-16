import '@config/boot';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { config } from '@config/config';
import { AppDataSource } from '@config/database';
import { type DictionaryCandidate, identifyWord } from '@app/services/dictionary/identify';

/**
 * Shadow comparison of the word card (task 40, parity gate): for tokens readers can click, asks Shirabe's
 * `words/identify` (as the card does for an unlinked reader: service key, JMdict only) and our `identifyWord`, and
 * reports how often the card would show the same word and the same content. Writes nothing to the database.
 *
 * Shirabe's answers are cached in `--cache` and reused on later runs, so tuning ours never calls Shirabe twice for the
 * same token. Calls go 50 tokens at a time, paced, like ordinary card traffic.
 *
 *   node --env-file=.env --import tsx scripts/shadow-card.ts [--top 700] [--tail 300] [--cache file] [--samples file]
 *
 * The sample is the `--top` most frequent clickable tokens plus `--tail` random ones from the rest; results are given
 * both per token and weighted by how often readers meet the token.
 */

const { values } = parseArgs({
  options: {
    top: { type: 'string', default: '700' },
    tail: { type: 'string', default: '300' },
    cache: { type: 'string', default: 'shadow-card-cache.json' },
    samples: { type: 'string' },
    locale: { type: 'string', default: 'en' },
  },
});
const LOCALE = values.locale === 'es' ? 'es' : 'en';
const BATCH = 50;
const PAUSE_MS = 1500;
const INCLUDE = ['pitch', 'frequency', 'furigana', 'jlpt', 'forms', 'notes', 'parts'];

interface Query {
  lemma: string;
  surface: string;
  reading?: string;
  pos?: string;
  count: number;
}

type Card = Partial<DictionaryCandidate> & { matchedHeadword?: string | null };

const keyOf = (q: Pick<Query, 'lemma' | 'surface' | 'reading' | 'pos'>) =>
  [q.lemma, q.surface, q.reading ?? '', q.pos ?? '', LOCALE].join('\u0000');

async function sample(): Promise<Query[]> {
  // Clickable tokens are the ones the card opens on: a dictionary form, not punctuation or bare symbols.
  const rows: Query[] = await AppDataSource.query(
    `WITH t AS (
       SELECT x->>'d' AS lemma, x->>'s' AS surface, x->>'r' AS reading, x->>'pt' AS pos, count(*)::int AS count
         FROM "Segment", jsonb_array_elements(tokens) x
        WHERE coalesce(x->>'d', '') <> '' AND coalesce(x->>'kind', '') NOT IN ('punct', 'symbol')
        GROUP BY 1, 2, 3, 4
     ), ranked AS (SELECT *, row_number() OVER (ORDER BY count DESC, lemma) AS n FROM t)
     (SELECT lemma, surface, reading, pos, count FROM ranked WHERE n <= $1)
     UNION ALL
     (SELECT lemma, surface, reading, pos, count FROM ranked WHERE n > $1 ORDER BY md5(lemma || surface) LIMIT $2)`,
    [Number(values.top), Number(values.tail)],
  );
  return rows;
}

async function shirabe(queries: Query[], cache: Record<string, Card[]>): Promise<void> {
  const missing = queries.filter((q) => !(keyOf(q) in cache));
  if (missing.length > 0 && !config.SHIRABE_API_KEY) throw new Error('SHIRABE_API_KEY is needed for uncached tokens');
  const base = config.SHIRABE_API_BASE.replace(/\/$/, '');

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const tokens = batch.map((q) => ({
      lemma: q.lemma,
      surface: q.surface,
      ...(q.reading ? { reading: q.reading } : {}),
      ...(q.pos ? { pos: q.pos } : {}),
    }));
    const url = `${base}/api/v1/words/identify?locale=${LOCALE}&${encodeURIComponent('dictionaries[]')}=jmdict`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.SHIRABE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tokens, include: INCLUDE }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Shirabe answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const { words } = (await response.json()) as { words: Array<{ candidates: Card[] } | null> };
    batch.forEach((q, j) => {
      cache[keyOf(q)] = words[j]?.candidates ?? [];
    });
    process.stderr.write(`shirabe ${Math.min(i + BATCH, missing.length)}/${missing.length}\n`);
    if (i + BATCH < missing.length) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
}

// What the card draws, field by field, following frontend/app/utils/wordCard.ts and useWordCardContent.ts. Each
// returns a comparable string; undefined means "nothing drawn".
const SENSE_LIMIT = 6;
const definitionsIn = (sense: { definitions?: Array<{ lang: string; text: string }> }) =>
  (sense.definitions ?? []).filter((d) => d.lang === LOCALE).map((d) => d.text);
/** The senses the card prints: those with a definition in the reader's language, first six. */
const shownSenses = (c: Card) =>
  (c.entries?.[0]?.senses ?? []).filter((s) => definitionsIn(s).length > 0).slice(0, SENSE_LIMIT);
/** Ruby the card prints over the headword: only when the segments spell it (`headwordFurigana`). */
const shownRuby = (c: Card) => {
  const segments = (c.furigana ?? []).filter((f) => f.text);
  return segments.length > 0 && segments.map((f) => f.text).join('') === c.headword ? segments : [];
};
const FIELDS = {
  word: (c: Card) => c.sourceId ?? c.id,
  headword: (c: Card) => c.headword,
  /** The reading printed beside the headword when there is no ruby (`headReading`). */
  headReading: (c: Card) => (shownRuby(c).length > 0 || !c.reading || c.reading === c.headword ? undefined : c.reading),
  ruby: (c: Card) =>
    shownRuby(c)
      .map((f) => `${f.text}${f.ruby ? `(${f.ruby})` : ''}`)
      .join('') || undefined,
  /** The picker chip: name, and the reading when it differs. */
  picker: (c: Card) => {
    const name = c.matchedHeadword || c.headword;
    return c.reading && c.reading !== name ? `${name} ${c.reading}` : name;
  },
  common: (c: Card) => String(Boolean(c.common)),
  jlpt: (c: Card) => c.jlpt ?? undefined,
  /** The card draws the first two patterns. */
  pitch: (c: Card) =>
    c.pitch?.length
      ? c.pitch
          .slice(0, 2)
          .map((p) => p.downstep)
          .join(',')
      : undefined,
  /** `cardForms`: up to four spellings, without the headword and reading already printed. */
  forms: (c: Card) => {
    const seen = new Set([c.headword ?? '', c.reading ?? '']);
    const out: string[] = [];
    for (const f of c.forms ?? []) {
      const text = f.text?.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length === 4) break;
    }
    return out.join('、') || undefined;
  },
  senses: (c: Card) => String(shownSenses(c).length),
  definitions: (c: Card) =>
    shownSenses(c)
      .map((s) => definitionsIn(s).join(' / '))
      .join(' | ') || undefined,
  gloss1: (c: Card) => (shownSenses(c)[0] ? definitionsIn(shownSenses(c)[0]!).join(' / ') : undefined),
  pos: (c: Card) =>
    shownSenses(c)
      .map((s) =>
        (s.tags ?? [])
          .filter((t) => t.category === 'partOfSpeech')
          .map((t) => t.code)
          .sort()
          .join(','),
      )
      .join('|') || undefined,
  name: (c: Card) => String(Boolean(c.name)),
  /** The parts row: the pieces that resolve to a word (`id`), as the card filters them. */
  parts: (c: Card) =>
    ((c as { parts?: Array<{ text: string; id?: string }> }).parts ?? [])
      .filter((part) => part.id)
      .map((part) => part.text)
      .join('+') || undefined,
} as const;
type Field = keyof typeof FIELDS;

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const queries = await sample();
  const cache: Record<string, Card[]> = existsSync(values.cache) ? JSON.parse(readFileSync(values.cache, 'utf8')) : {};
  try {
    await shirabe(queries, cache);
  } finally {
    writeFileSync(values.cache, JSON.stringify(cache));
  }

  const tally = { tokens: 0, weight: 0 };
  type Pair = [number, number];
  const outcome: Record<'bothEmpty' | 'onlyTheirs' | 'onlyOurs' | 'same' | 'inOurTop3', Pair> = {
    bothEmpty: [0, 0],
    onlyTheirs: [0, 0],
    onlyOurs: [0, 0],
    same: [0, 0],
    inOurTop3: [0, 0],
  };
  // The candidate row on the same word: how many of Shirabe's other candidates (up to four, as the row shows) we offer
  // too, and how many rows have none on one side and some on the other.
  const row = { theirs: 0, shared: 0, rowsBoth: 0, rowsOnlyTheirs: 0, rowsOnlyOurs: 0 };
  const fieldSame = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, [0, 0, 0, 0]])) as Record<
    Field,
    [number, number, number, number]
  >;
  const samples: string[] = [];

  for (const q of queries) {
    const theirs = cache[keyOf(q)] ?? [];
    const ours = (await identifyWord(AppDataSource, {
      lemma: q.lemma,
      surface: q.surface,
      reading: q.reading,
      pos: q.pos,
      locale: LOCALE,
    })) as Card[];
    tally.tokens++;
    tally.weight += q.count;
    const add = (slot: Pair) => {
      slot[0]++;
      slot[1] += q.count;
    };
    const t = theirs[0];
    const o = ours[0];
    const label = `${q.surface}〔${q.lemma}${q.reading ? ` ${q.reading}` : ''}${q.pos ? ` ${q.pos}` : ''}〕×${q.count}`;

    if (!t && !o) add(outcome.bothEmpty);
    else if (!o) {
      add(outcome.onlyTheirs);
      samples.push(`ONLY SHIRABE ${label}: ${t?.headword} ${t?.reading ?? ''} — ${FIELDS.gloss1(t as Card)}`);
    } else if (!t) {
      add(outcome.onlyOurs);
      samples.push(`ONLY OURS ${label}: ${o.headword} ${o.reading ?? ''} — ${FIELDS.gloss1(o)}`);
    } else if (FIELDS.word(t) === FIELDS.word(o)) {
      add(outcome.same);
      const others = (list: Card[]) => new Set(list.slice(1, 5).map((c) => FIELDS.word(c)));
      const theirOthers = others(theirs);
      const ourOthers = new Set(ours.slice(1, 8).map((c) => FIELDS.word(c)));
      row.theirs += theirOthers.size;
      row.shared += [...theirOthers].filter((id) => ourOthers.has(id)).length;
      if (theirOthers.size > 0 && ourOthers.size > 0) row.rowsBoth++;
      else if (theirOthers.size > 0) {
        row.rowsOnlyTheirs++;
        samples.push(
          `ROW ONLY SHIRABE ${label}: ${theirs
            .slice(1, 5)
            .map((c) => c.headword)
            .join('、')}`,
        );
      } else if (ourOthers.size > 0) row.rowsOnlyOurs++;
      for (const field of Object.keys(FIELDS) as Field[]) {
        const slot = fieldSame[field];
        slot[2]++;
        slot[3] += q.count;
        const a = FIELDS[field](t);
        const b = FIELDS[field](o);
        if (a === b) {
          slot[0]++;
          slot[1] += q.count;
        } else if (field !== 'word') {
          samples.push(`FIELD ${field} ${label}: shirabe ${a ?? '∅'} | ours ${b ?? '∅'}`);
        }
      }
    } else {
      if (ours.slice(0, 3).some((c) => FIELDS.word(c) === FIELDS.word(t))) add(outcome.inOurTop3);
      samples.push(
        `WORD ${label}: shirabe ${t.headword} ${t.reading ?? ''} [${FIELDS.word(t)}] | ours ${o.headword} ${o.reading ?? ''} [${FIELDS.word(o)}]`,
      );
    }
  }

  const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
  const line = (name: string, slot: number[]) =>
    `${name.padEnd(12)} ${pct(slot[0] ?? 0, tally.tokens).padStart(7)} of tokens  ${pct(slot[1] ?? 0, tally.weight).padStart(7)} weighted`;
  console.log(`${tally.tokens} tokens (${tally.weight} occurrences), locale ${LOCALE}`);
  console.log(line('same word', outcome.same));
  console.log(
    line('other word', [
      tally.tokens - outcome.same[0]! - outcome.bothEmpty[0]! - outcome.onlyOurs[0]! - outcome.onlyTheirs[0]!,
      tally.weight - outcome.same[1]! - outcome.bothEmpty[1]! - outcome.onlyOurs[1]! - outcome.onlyTheirs[1]!,
    ]),
  );
  console.log(line(' …in our top3', outcome.inOurTop3));
  console.log(line('only Shirabe', outcome.onlyTheirs));
  console.log(line('only ours', outcome.onlyOurs));
  console.log(line('both empty', outcome.bothEmpty));
  console.log(
    `
Candidate row (same word): ${pct(row.shared, row.theirs)} of Shirabe's other candidates offered too; rows on both ${row.rowsBoth}, only Shirabe ${row.rowsOnlyTheirs}, only ours ${row.rowsOnlyOurs}`,
  );
  console.log('\nOn the same word, field agreement (tokens / weighted):');
  for (const field of Object.keys(FIELDS) as Field[]) {
    if (field === 'word') continue;
    const [same, sameW, all, allW] = fieldSame[field];
    console.log(`  ${field.padEnd(9)} ${pct(same!, all!).padStart(7)}  ${pct(sameW!, allW!).padStart(7)}`);
  }
  if (values.samples) writeFileSync(values.samples, samples.join('\n'));
}

main()
  .then(async () => {
    await AppDataSource.destroy();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    process.exit(1);
  });
