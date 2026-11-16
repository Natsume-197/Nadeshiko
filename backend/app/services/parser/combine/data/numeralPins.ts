/*
 * Numeral reading tables (`HourPins`, `TemporalDurationPins`, `TemporalAnchorTexts`; Apache-2.0 data, see
 * ../../NOTICE), copied as data with the upstream comments. Word ids are
 * JMdict sequence numbers (our `dict.word.id`); a reading index is the form index (our `dict.form.idx`).
 */

/** Clock hours force native readings (四時=よじ, 九時=くじ) that Sudachi's per-token onyomi can't produce. */
export const HOUR_PINS: ReadonlyMap<string, { wordId: number; reading: string }> = new Map([
  // 一時 is absent: numeral context can't separate いちじ/いっとき/ひととき, and scoring handles o'clock.
  ['二時', { wordId: 2612170, reading: 'ニジ' }],
  ['三時', { wordId: 1300520, reading: 'サンジ' }],
  ['四時', { wordId: 1307230, reading: 'ヨジ' }],
  ['五時', { wordId: 2845367, reading: 'ゴジ' }],
  ['六時', { wordId: 2583620, reading: 'ロクジ' }],
  ['七時', { wordId: 2845363, reading: 'シチジ' }],
  ['八時', { wordId: 2845368, reading: 'ハチジ' }],
  ['九時', { wordId: 2845349, reading: 'クジ' }],
  ['十時', { wordId: 2845369, reading: 'ジュウジ' }],
  ['十一時', { wordId: 2845370, reading: 'ジュウイチジ' }],
  ['十二時', { wordId: 1334960, reading: 'ジュウニジ' }],
  ['零時', { wordId: 1557690, reading: 'レイジ' }],
]);

/** Duration readings for numeral+分/日/月 homographs, applied only before a temporal anchor. */
export const TEMPORAL_DURATION_PINS: ReadonlyMap<string, { wordId: number; readingIndex: number }> = new Map([
  ['一分', { wordId: 1166290, readingIndex: 1 }],
  ['１分', { wordId: 1166290, readingIndex: 0 }],
  ['十分', { wordId: 1335070, readingIndex: 1 }],
  ['１０分', { wordId: 1335070, readingIndex: 0 }],
  ['五分', { wordId: 2039350, readingIndex: 1 }],
  ['５分', { wordId: 2039350, readingIndex: 0 }],
  ['二分', { wordId: 2219180, readingIndex: 1 }],
  ['２分', { wordId: 2219180, readingIndex: 0 }],
  ['三分', { wordId: 1814040, readingIndex: 1 }],
  ['３分', { wordId: 1814040, readingIndex: 0 }],
  ['四分', { wordId: 2863218, readingIndex: 1 }],
  ['４分', { wordId: 2863218, readingIndex: 0 }],
  ['六分', { wordId: 2056150, readingIndex: 1 }],
  ['６分', { wordId: 2056150, readingIndex: 0 }],
  ['七分', { wordId: 2864067, readingIndex: 1 }],
  ['７分', { wordId: 2864067, readingIndex: 0 }],
  ['何分', { wordId: 1189320, readingIndex: 0 }],
  ['三十日', { wordId: 1300670, readingIndex: 1 }],
  ['一月', { wordId: 1162130, readingIndex: 0 }],
]);

export const TEMPORAL_ANCHOR_TEXTS: ReadonlySet<string> = new Set([
  '前',
  '後',
  '間',
  'ぐらい',
  'くらい',
  'ほど',
  '経つ',
  '経った',
  '経って',
  '待っ',
]);
