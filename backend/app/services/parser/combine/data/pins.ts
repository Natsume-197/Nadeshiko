import { HOUR_PINS, TEMPORAL_DURATION_PINS } from './numeralPins';
import { REWRITE_RULES } from './rewriteRules';

/** JMdict words the disambiguation stages and rewrite rules pin by id (`PreMatchedWordId`) and read
 * through `Lexicon.formReading`; ids are the ones the upstream disambiguation and rewrite rules pin. The lexicon
 * keeps the forms of these words only. */
export const PIN = {
  /** 方 かた "way of doing" after a 連用形. */
  kata: 1516925,
  /** 方々 ほうぼう "here and there", before a movement verb. */
  houbou: 1584105,
  /** 方々 かたがた "people", after の or an adnominal. */
  katagata: 1584100,
  /** 重 じゅう prefix "heavy". */
  juu: 2108240,
  /** 度 ど, the counter after a numeral. */
  do: 1445160,
  /** 目 め, the ordinal. */
  me: 1604890,
  /** 分 ぶん "part" in N分のN. */
  bun: 1502860,
  /** 項 こう, the counter. */
  kou: 1282980,
  /** 体 たい, the counter. */
  tai: 1409150,
  /** 素振り すぶり "practice swing". */
  suburi: 1749550,
} as const;

export const PINNED_WORD_IDS: ReadonlySet<number> = new Set([
  ...Object.values(PIN),
  ...[...HOUR_PINS.values()].map((pin) => pin.wordId),
  ...[...TEMPORAL_DURATION_PINS.values()].map((pin) => pin.wordId),
  ...REWRITE_RULES.flatMap((rule) => rule.replace.flatMap((template) => (template.pin ? [template.pin] : []))),
]);
