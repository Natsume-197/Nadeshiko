/*
 * The token rewrite-rule table and the record types it is written in (`RewriteRulesTable`, `RewritePhase`,
 * `LookupGuardKind`, `TokenPattern`, `TokenTemplate`, `ContextCond`, `WindowCond`, `LookupGuard`, `RewriteRule`;
 * Apache-2.0 data, see ../../NOTICE). All 175 rows (Early 72, Late 11, Cleanup 76, Reading 16) are copied as data,
 * in the upstream order and with the upstream ids and comments; only the C# record syntax became object literals
 * (enum members are strings, `PosAnyOf` is `pos`).
 */

import type { WordClass } from '../types';

/** Where a phase runs (upstream comments): Early where ProcessSpecialCases sits, before the combine stages; Late after
 * RecombineHiraganaTokens; Cleanup just before ApplyContextPins; Reading just before FixReadingAmbiguity. */
export type RewritePhase = 'Early' | 'Late' | 'Cleanup' | 'Reading';

/** `LookupGuardKind`, over the matched surfaces expanded into `pattern` ("{0}{1}", "{0}い", "貸りる"). */
export type LookupGuardKind = 'CompoundExists' | 'NonNameCompoundExists' | 'CompoundAbsent' | 'FrequencyRankUnder';

/** The `PartOfSpeechSection` values the rows set; {@link SECTION_LABELS} maps
 * them to the UniDic labels our groups carry. */
export type PosSection = 'None' | 'SentenceEndingParticle' | 'CaseMarkingParticle';

export const SECTION_LABELS: Record<PosSection, string> = {
  None: '*',
  SentenceEndingParticle: '終助詞',
  CaseMarkingParticle: '格助詞',
};

/** `TokenPattern`: every set field must hold. `requireUnpinned` defaults to true, as upstream. */
export interface TokenPattern {
  text?: string;
  textAnyOf?: readonly string[];
  textStartsWith?: string;
  textEndsWith?: string;
  pos?: readonly WordClass[];
  dictFormAnyOf?: readonly string[];
  normalizedFormAnyOf?: readonly string[];
  readingPrefix?: string;
  notReadingPrefix?: string;
  requireUnpinned?: boolean;
}

/** `TokenTemplate`: `text` '' keeps the matched surface; a split or merge must give each output a `reading`
 * ('' for unknown). `pin` is a JMdict id (with `pinReadingIndex` its form index); `hardPin` keeps the compound
 * passes from swallowing the token; `recoverConjugations` derives the pinned token's inflection chain. */
export interface TokenTemplate {
  text: string;
  dictForm?: string;
  normalizedForm?: string;
  pos?: WordClass;
  posSection?: PosSection;
  reading?: string;
  pin?: number;
  pinReadingIndex?: number;
  hardPin?: boolean;
  recoverConjugations?: boolean;
}

/** `ContextCond`: the constraints AND, `negate` flips. `clauseBoundary` is a symbol or blank neighbour or the
 * edge; `numeral` also matches Sudachi's 名詞-数詞 nouns. */
export interface ContextCond {
  textAnyOf?: readonly string[];
  textEndsWithAnyOf?: readonly string[];
  textStartsWithAnyOf?: readonly string[];
  pos?: readonly WordClass[];
  clauseBoundary?: boolean;
  numeral?: boolean;
  negate?: boolean;
}

/** `WindowCond`: some token in [from, to] relative to the match start satisfies the constraints. */
export interface WindowCond {
  from: number;
  to: number;
  textAnyOf?: readonly string[];
  pos?: readonly WordClass[];
  negate?: boolean;
}

/** `LookupGuard`. */
export interface LookupGuard {
  kind: LookupGuardKind;
  pattern: string;
  rank?: number;
}

export interface RewriteRule {
  id: string;
  phase: RewritePhase;
  match: readonly TokenPattern[];
  replace: readonly TokenTemplate[];
  prev?: ContextCond;
  next?: ContextCond;
  window?: WindowCond;
  guard?: LookupGuard;
}

export const REWRITE_RULES: readonly RewriteRule[] = [
  // Colloquial なんなん ("what the hell?"), unless followed by と (喃々と taru-adverb).
  {
    id: 'nannan',
    phase: 'Cleanup',
    match: [{ text: 'なんなん', requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'なんなん', pos: 'Expression', pin: 2871194 }],
    next: { textAnyOf: ['と'], negate: true },
  },
  // クズ = 屑 "scum", not 葛 "arrowroot".
  {
    id: 'kuzu',
    phase: 'Cleanup',
    match: [{ text: 'クズ', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [{ text: '', pin: 1246510 }],
  },
  // あるある = the "I can relate" expression, not doubled ある.
  {
    id: 'aruaru',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['あるある', 'アルアル'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'あるある', normalizedForm: 'あるある', pos: 'Interjection', pin: 2150380 }],
  },
  // 事 read ゴト after a noun/verb stem is the suffix ごと, not the noun こと.
  {
    id: 'goto-suffix',
    phase: 'Cleanup',
    match: [{ text: '事', readingPrefix: 'ゴト', requireUnpinned: false }],
    replace: [{ text: '', pin: 2613010 }],
    prev: { pos: ['Noun', 'CommonNoun', 'Verb'] },
  },
  // ナシ = the negation なし, not the pear 梨.
  {
    id: 'nashi',
    phase: 'Cleanup',
    match: [{ text: 'ナシ', pos: ['Noun', 'CommonNoun', 'NounSuffix', 'Suffix'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'なし', normalizedForm: 'なし', pin: 1529560 }],
  },
  // Standalone じゃが is the archaic conjunction (じゃが、…; 理由じゃが), not the potato; じゃがバター stays potato.
  {
    id: 'jaga-conjunction',
    phase: 'Cleanup',
    match: [{ text: 'じゃが', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [{ text: '', pos: 'Conjunction', pin: 2856812 }],
    next: { textAnyOf: ['バター', 'いも', 'イモ', '芋'], negate: true },
  },
  // Pronoun おら/オラ is 俺; unpinned, katakana オラ's exact-surface match hands it to hola.
  {
    id: 'ora-pronoun',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['おら', 'オラ'], pos: ['Pronoun'], requireUnpinned: false }],
    replace: [{ text: '', pin: 2080360, pinReadingIndex: 3 }],
  },
  // す before explanatory ん is contracted する (すんだ), not 酢/素/巣; hard, or す+んだ re-fuses into 済んだ.
  {
    id: 'su-contracted-suru',
    phase: 'Cleanup',
    match: [{ text: 'す', pos: ['Verb'], dictFormAnyOf: ['する', '為る'] }],
    replace: [{ text: '', pin: 1157170, pinReadingIndex: 1, hardPin: true }],
    next: { textAnyOf: ['ん', 'んだ', 'んで'] },
  },
  // Sudachi's fused すん (すんの, すんな) is する; unpinned it can only resolve to 済む/住む lookalikes.
  {
    id: 'sun-contracted-suru',
    phase: 'Cleanup',
    match: [{ text: 'すん', pos: ['Verb'], dictFormAnyOf: ['する', '為る'] }],
    replace: [{ text: '', pin: 1157170, pinReadingIndex: 1, hardPin: true }],
  },
  // あ before explanatory ん is contracted ある (あんだ); hard, or あ+んだ re-fuses into 安打.
  {
    id: 'a-contracted-aru',
    phase: 'Cleanup',
    match: [{ text: 'あ', pos: ['Verb'], dictFormAnyOf: ['ある', '有る', '在る'] }],
    replace: [{ text: '', pin: 1296400, pinReadingIndex: 2, hardPin: true }],
    next: { textAnyOf: ['ん', 'んだ', 'んで'] },
  },
  // The same contraction fused by Sudachi as あん (あんの, あんだろ), lemmatised as ある.
  {
    id: 'an-contracted-aru',
    phase: 'Cleanup',
    match: [{ text: 'あん', pos: ['Verb'], dictFormAnyOf: ['ある', '有る', '在る'] }],
    replace: [{ text: '', pin: 1296400, pinReadingIndex: 2, hardPin: true }],
  },
  // カンパン = the food 乾パン, not 肝斑/甲板/乾板.
  {
    id: 'kanpan',
    phase: 'Cleanup',
    match: [{ text: 'カンパン', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: '乾パン', normalizedForm: '乾パン', pin: 1209690 }],
  },
  // Kana した after genitive の is 下, not 舌.
  {
    id: 'shita-shita',
    phase: 'Cleanup',
    match: [{ text: 'した', pos: ['Noun', 'CommonNoun'] }],
    replace: [{ text: '', dictForm: '下', normalizedForm: '下', pin: 1184140 }],
    prev: { textAnyOf: ['の'], pos: ['Particle'] },
  },
  // ならば = the conditional conjunction, not a form of なる.
  {
    id: 'naraba',
    phase: 'Cleanup',
    match: [{ text: 'ならば', dictFormAnyOf: ['なる', '成る', 'ならば', 'だ'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'ならば', normalizedForm: 'ならば', pos: 'Conjunction', pin: 1009470 }],
  },
  // Elongated だろー = だろう.
  {
    id: 'darou',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['だろー', 'だろぉ', 'だろぉー'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'だろう', normalizedForm: 'だろう', pin: 1928670 }],
  },
  // つー before a nominaliser/question is the という contraction.
  {
    id: 'tsuu',
    phase: 'Cleanup',
    match: [{ text: 'つー', requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'という', normalizedForm: 'という', pos: 'Particle', pin: 1922760 }],
    next: { textAnyOf: ['の', 'か', 'こと', 'わけ'] },
  },
  // 向い* lemmatised as 向く is 向く, not 向かう.
  {
    id: 'mukai',
    phase: 'Cleanup',
    match: [{ textStartsWith: '向い', pos: ['Verb'], dictFormAnyOf: ['向く'] }],
    replace: [{ text: '', dictForm: '向く', normalizedForm: '向く', pin: 1277080, recoverConjugations: true }],
  },
  // 共 (noun とも) + に is the adverb 共に "together"; Sudachi leaves the two split.
  {
    id: 'tomoni',
    phase: 'Cleanup',
    match: [
      { text: '共', pos: ['Noun', 'CommonNoun'], readingPrefix: 'トモ', requireUnpinned: false },
      { text: 'に', pos: ['Particle'], requireUnpinned: false },
    ],
    replace: [
      { text: '共に', dictForm: '共に', normalizedForm: '共に', pos: 'Adverb', reading: 'トモニ', pin: 1234260 },
    ],
  },
  // 来 + adnominal たる before a noun is 来たる (きたる, "coming/next"), not 来る with a たる aux.
  {
    id: 'kitaru',
    phase: 'Cleanup',
    match: [
      { text: '来', pos: ['Verb'], dictFormAnyOf: ['来る'], requireUnpinned: false },
      { text: 'たる', pos: ['Auxiliary'], requireUnpinned: false },
    ],
    replace: [
      {
        text: '来たる',
        dictForm: '来たる',
        normalizedForm: '来たる',
        pos: 'PrenounAdjectival',
        reading: 'キタル',
        pin: 1591270,
      },
    ],
    next: { pos: ['Noun', 'CommonNoun'] },
  },
  // そうした/こうした/ああした before a noun is the adnominal "such", not した+もの → 下物; verbal そうしたら stays out.
  {
    id: 'soushita',
    phase: 'Cleanup',
    match: [
      { text: 'そう', pos: ['Adverb'], requireUnpinned: false },
      { text: 'した', pos: ['Verb'], dictFormAnyOf: ['する', '為る'], requireUnpinned: false },
    ],
    replace: [
      {
        text: 'そうした',
        dictForm: 'そうした',
        normalizedForm: 'そうした',
        pos: 'PrenounAdjectival',
        reading: 'ソウシタ',
        pin: 2008650,
      },
    ],
    next: { pos: ['Noun', 'CommonNoun'] },
  },
  {
    id: 'koushita',
    phase: 'Cleanup',
    match: [
      { text: 'こう', pos: ['Adverb'], requireUnpinned: false },
      { text: 'した', pos: ['Verb'], dictFormAnyOf: ['する', '為る'], requireUnpinned: false },
    ],
    replace: [
      {
        text: 'こうした',
        dictForm: 'こうした',
        normalizedForm: 'こうした',
        pos: 'PrenounAdjectival',
        reading: 'コウシタ',
        pin: 2008030,
      },
    ],
    next: { pos: ['Noun', 'CommonNoun'] },
  },
  {
    id: 'aashita',
    phase: 'Cleanup',
    match: [
      { text: 'ああ', pos: ['Adverb'], requireUnpinned: false },
      { text: 'した', pos: ['Verb'], dictFormAnyOf: ['する', '為る'], requireUnpinned: false },
    ],
    replace: [
      {
        text: 'ああした',
        dictForm: 'ああした',
        normalizedForm: 'ああした',
        pos: 'PrenounAdjectival',
        reading: 'アアシタ',
        pin: 2085100,
      },
    ],
    next: { pos: ['Noun', 'CommonNoun'] },
  },
  // Sudachi shreds ほくそ笑む; runs Late, after mora-theft reforms 笑む and before the short-kana filter drops ほく/そ.
  {
    id: 'hokusoemu',
    phase: 'Late',
    match: [
      { text: 'ほく', pos: ['Adverb'], requireUnpinned: false },
      { text: 'そ', requireUnpinned: false },
      { text: '笑む', pos: ['Verb'], dictFormAnyOf: ['笑む'], requireUnpinned: false },
    ],
    replace: [
      {
        text: 'ほくそ笑む',
        dictForm: 'ほくそ笑む',
        normalizedForm: 'ほくそ笑む',
        pos: 'Verb',
        reading: 'ホクソエム',
        pin: 2065260,
        recoverConjugations: true,
      },
    ],
  },
  // 合 after 死 is the 合い suffix あい (死合 = しあい, a duel), not the volume unit ごう.
  {
    id: 'shiai-ai',
    phase: 'Cleanup',
    match: [{ text: '合', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: '合い', normalizedForm: '合い', reading: 'アイ', pin: 1284320 }],
    prev: { textAnyOf: ['死'] },
  },
  // Bare 有り得 at a clause end is the entry 有り得, not the verb 有り得る it deconjugates to.
  {
    id: 'ariu',
    phase: 'Cleanup',
    match: [{ text: '有り得', pos: ['Verb'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: '有り得', normalizedForm: '有り得', pin: 2560320 }],
    next: { clauseBoundary: true },
  },
  // 飛ばし after 首 is 飛ばす "to send flying", not the securities-fraud noun 飛ばし (1637130).
  {
    id: 'kubi-tobashi',
    phase: 'Cleanup',
    match: [{ text: '飛ばし', pos: ['Noun', 'CommonNoun'], dictFormAnyOf: ['飛ばし'], requireUnpinned: false }],
    replace: [
      {
        text: '',
        dictForm: '飛ばす',
        normalizedForm: '飛ばす',
        pos: 'Verb',
        reading: 'トバシ',
        pin: 1485230,
        recoverConjugations: true,
      },
    ],
    prev: { textAnyOf: ['首'] },
  },
  // 羽馬(surname)+車 is a winged carriage (羽 + 馬車); exact two-token match so other names aren't re-cut.
  {
    id: 'hane-basha',
    phase: 'Cleanup',
    match: [
      { text: '羽馬', requireUnpinned: false },
      { text: '車', requireUnpinned: false },
    ],
    replace: [
      { text: '羽', dictForm: '羽', normalizedForm: '羽', pos: 'Noun', reading: 'ハネ', pin: 1171680 },
      { text: '馬車', dictForm: '馬車', normalizedForm: '馬車', pos: 'Noun', reading: 'バシャ', pin: 1471780 },
    ],
  },
  // Sudachi cuts 行かせまい as 行|か|せまい(狭い); no Prev needed since a real 行か、狭い keeps kanji or punctuation.
  {
    id: 'ikasemai',
    phase: 'Cleanup',
    match: [{ text: '行', pos: ['Noun', 'CommonNoun'] }, { text: 'か', pos: ['Particle'] }, { text: 'せまい' }],
    replace: [
      {
        text: '行かせまい',
        dictForm: '行く',
        normalizedForm: '行く',
        pos: 'Verb',
        reading: 'イカセマイ',
        pin: 1578850,
        pinReadingIndex: 0,
        recoverConjugations: true,
      },
    ],
  },
  // っこない after a verb stem (行け|っこ|ない); the verb gate spares nominal っこ (慣れっこ, かけっこ).
  {
    id: 'kkonai',
    phase: 'Cleanup',
    match: [{ text: 'っこ' }, { text: 'ない' }],
    replace: [
      {
        text: 'っこない',
        dictForm: 'っこない',
        normalizedForm: 'っこない',
        pos: 'Expression',
        reading: 'ッコナイ',
        pin: 2145640,
        pinReadingIndex: 0,
      },
    ],
    prev: { pos: ['Verb'] },
  },
  // Explanatory なんです, matched Early before tail fusion; non-question tails rule out 何, Pronoun hosts stay out.
  {
    id: 'nandesu',
    phase: 'Early',
    match: [{ text: 'な' }, { text: 'ん' }, { text: 'です' }],
    replace: [
      {
        text: 'なんです',
        dictForm: 'なんです',
        normalizedForm: 'なんです',
        pos: 'Expression',
        reading: 'ナンデス',
        pin: 2683060,
        pinReadingIndex: 0,
      },
    ],
    prev: { pos: ['Noun', 'CommonNoun', 'Suffix', 'Name', 'NaAdjective'] },
    next: { textAnyOf: ['か', '？'], negate: true },
  },
  // A question tail is ambiguous (趣味なんですか); a na-adjective host rules out 何 (好き何ですか), a bare noun doesn't.
  {
    id: 'nandesu-ka-naadj',
    phase: 'Early',
    match: [{ text: 'な' }, { text: 'ん' }, { text: 'です' }],
    replace: [
      {
        text: 'なんです',
        dictForm: 'なんです',
        normalizedForm: 'なんです',
        pos: 'Expression',
        reading: 'ナンデス',
        pin: 2683060,
        pinReadingIndex: 0,
      },
    ],
    prev: { pos: ['NaAdjective'] },
    next: { textAnyOf: ['か', '？'] },
  },
  // A genitive の before the host also rules out 何: 俺のせいなんですか ("it's MY fault?!").
  {
    id: 'nandesu-ka-no',
    phase: 'Early',
    match: [{ text: 'な' }, { text: 'ん' }, { text: 'です' }],
    replace: [
      {
        text: 'なんです',
        dictForm: 'なんです',
        normalizedForm: 'なんです',
        pos: 'Expression',
        reading: 'ナンデス',
        pin: 2683060,
        pinReadingIndex: 0,
      },
    ],
    prev: { pos: ['Noun', 'CommonNoun', 'Suffix', 'Name'] },
    next: { textAnyOf: ['か', '？'] },
    window: { from: -2, to: -2, textAnyOf: ['の'] },
  },
  // Settles 見るも無残 before the na-adjective merge absorbs the connector な.
  {
    id: 'mirumo-muzan',
    phase: 'Late',
    match: [{ text: '見るも' }, { text: '無残' }],
    replace: [
      {
        text: '見るも無残',
        dictForm: '見るも無残',
        normalizedForm: '見るも無残',
        pos: 'Expression',
        reading: 'ミルモムザン',
        pin: 2871068,
        pinReadingIndex: 0,
      },
    ],
  },
  // Shape where the na-adjective merge already absorbed the connector (無残な).
  {
    id: 'mirumo-muzan-na',
    phase: 'Late',
    match: [{ text: '見るも' }, { text: '無残な' }],
    replace: [
      {
        text: '見るも無残',
        dictForm: '見るも無残',
        normalizedForm: '見るも無残',
        pos: 'Expression',
        reading: 'ミルモムザン',
        pin: 2871068,
        pinReadingIndex: 0,
      },
      { text: 'な', dictForm: 'な', normalizedForm: 'な', pos: 'Auxiliary', reading: 'ナ' },
    ],
  },
  // JMnedict's place entry 養護院 outranks noun+院; per-surface since a blanket recut would shred genuine names.
  {
    id: 'yougoin',
    phase: 'Late',
    match: [{ text: '養護院', requireUnpinned: false }],
    replace: [
      {
        text: '養護',
        dictForm: '養護',
        normalizedForm: '養護',
        pos: 'Noun',
        reading: 'ヨウゴ',
        pin: 1605847,
        pinReadingIndex: 0,
        hardPin: true,
      },
      {
        text: '院',
        dictForm: '院',
        normalizedForm: '院',
        pos: 'Noun',
        reading: 'イン',
        pin: 2414530,
        pinReadingIndex: 0,
        hardPin: true,
      },
    ],
  },
  // 打ち下ろし is deverbal 打ち下ろす; JMDict's only noun entry is the golf term (downhill hole).
  {
    id: 'uchioroshi',
    phase: 'Cleanup',
    match: [{ text: '打ち下ろし', requireUnpinned: false }],
    replace: [
      {
        text: '',
        dictForm: '打ち下ろす',
        normalizedForm: '打ち下ろす',
        pos: 'Verb',
        reading: 'ウチオロシ',
        pin: 1408600,
        pinReadingIndex: 0,
        recoverConjugations: true,
      },
    ],
  },
  // Sentence-final だい after explanatory ん: the fused んだ strands the い, which then drops.
  {
    id: 'ndai',
    phase: 'Late',
    match: [{ text: 'んだ' }, { text: 'い', pos: ['Particle'] }],
    replace: [
      { text: 'ん', dictForm: 'ん', normalizedForm: 'ん', pos: 'Particle', reading: 'ン', pin: 2139720 },
      {
        text: 'だい',
        dictForm: 'だい',
        normalizedForm: 'だい',
        pos: 'Particle',
        reading: 'ダイ',
        pin: 2097680,
        pinReadingIndex: 0,
      },
    ],
  },
  // Sudachi prefers 上様, so 母|上様 never yields 母上; closed host list since a generic re-cut hits 滑走|路上.
  {
    id: 'kinship-uesama',
    phase: 'Early',
    match: [
      { textAnyOf: ['父', '母', '兄', '姉', '祖父', '祖母', '義父', '義母'], pos: ['Noun', 'CommonNoun'] },
      { text: '上様' },
    ],
    replace: [
      { text: '', pos: 'Noun' },
      { text: '上', dictForm: '上', normalizedForm: '上', pos: 'Suffix', reading: 'ウエ' },
      {
        text: '様',
        dictForm: '様',
        normalizedForm: '様',
        pos: 'Suffix',
        reading: 'サマ',
        pin: 1545790,
        pinReadingIndex: 0,
      },
    ],
  },
  // Rustic くだせえ (slurred 下さい) shreds to くだ+せえ; the deconjugator's slur fold recovers ください.
  {
    id: 'kudasee',
    phase: 'Late',
    match: [{ text: 'くだ' }, { text: 'せえ' }],
    replace: [
      {
        text: 'くだせえ',
        dictForm: 'ください',
        normalizedForm: 'ください',
        pos: 'Expression',
        reading: 'クダセエ',
        pin: 1184270,
        pinReadingIndex: 1,
        recoverConjugations: true,
      },
    ],
  },
  // Dialect ちょる (=ておる) after a verb; the verb gate spares the interjection ちょっ (ちょっ、待て).
  {
    id: 'chotta',
    phase: 'Late',
    match: [{ text: 'ちょっ' }, { text: 'た', pos: ['Auxiliary'] }],
    replace: [
      {
        text: 'ちょった',
        dictForm: 'ちょる',
        normalizedForm: 'ちょる',
        pos: 'Auxiliary',
        reading: 'チョッタ',
        pin: 2869627,
        pinReadingIndex: 0,
        recoverConjugations: true,
      },
    ],
    prev: { pos: ['Verb', 'Auxiliary'] },
  },
  // Kansai のうなる ("to disappear"), which Sudachi reads as の + 唸る.
  {
    id: 'nounatta',
    phase: 'Late',
    match: [
      { text: 'の', pos: ['Particle'] },
      { textStartsWith: 'うなっ', pos: ['Verb'] },
      { text: 'た', pos: ['Auxiliary'] },
    ],
    replace: [
      {
        text: 'のうなった',
        dictForm: 'のうなる',
        normalizedForm: 'のうなる',
        pos: 'Verb',
        reading: 'ノウナッタ',
        pin: 2793080,
        pinReadingIndex: 1,
        recoverConjugations: true,
      },
    ],
    // の after a nominal/predicate host is genitive (彼のうなった声); elsewhere it opens のうなる (もうのうなった).
    prev: {
      pos: [
        'Verb',
        'Auxiliary',
        'IAdjective',
        'Noun',
        'CommonNoun',
        'Name',
        'Pronoun',
        'NaAdjective',
        'Prefix',
        'Suffix',
        'Numeral',
        'Counter',
      ],
      negate: true,
    },
  },
  // Dialect じゃった (=だった) after nominal content; after a verb it stays the じゃう contraction (飲んじゃった).
  {
    id: 'jatta',
    phase: 'Late',
    match: [
      { text: 'じゃっ', pos: ['Auxiliary'] },
      { text: 'た', pos: ['Auxiliary'] },
    ],
    replace: [
      {
        text: 'じゃった',
        dictForm: 'じゃった',
        normalizedForm: 'じゃった',
        pos: 'Expression',
        reading: 'ジャッタ',
        pin: 2850797,
        pinReadingIndex: 0,
      },
    ],
    prev: { pos: ['Noun', 'CommonNoun', 'Name', 'Pronoun', 'NaAdjective', 'Suffix'] },
  },
  // Sudachi cuts 立とうと as 立|とうと (a rare adverb); recut to volitional 立とう + と.
  {
    id: 'tatouto',
    phase: 'Cleanup',
    match: [{ text: '立', pos: ['Noun', 'CommonNoun', 'Name'] }, { text: 'とうと' }],
    replace: [
      {
        text: '立とう',
        dictForm: '立つ',
        normalizedForm: '立つ',
        pos: 'Verb',
        reading: 'タトウ',
        pin: 1597040,
        pinReadingIndex: 0,
        recoverConjugations: true,
      },
      { text: 'と', dictForm: 'と', normalizedForm: 'と', pos: 'Particle', reading: 'ト' },
    ],
  },
  // ケダ(surname)+モノ作り is ケダモノ (獣) + 作り; bare ケダモノ already resolves.
  {
    id: 'kedamono',
    phase: 'Cleanup',
    match: [
      { text: 'ケダ', requireUnpinned: false },
      { text: 'モノ作り', requireUnpinned: false },
    ],
    replace: [
      { text: 'ケダモノ', dictForm: '獣', normalizedForm: '獣', pos: 'Noun', reading: 'ケダモノ', pin: 1335590 },
      { text: '作り', dictForm: '作り', normalizedForm: '作り', pos: 'Noun', reading: 'ツクリ', pin: 1297250 },
    ],
  },
  // 虚(そら)+けど+も after a demonstrative is 虚け (うつけ "fool") + the plural suffix ども.
  {
    id: 'utsuke-domo',
    phase: 'Cleanup',
    match: [
      { text: '虚', pos: ['Noun', 'CommonNoun'], requireUnpinned: false },
      { text: 'けど', pos: ['Particle'], requireUnpinned: false },
      { text: 'も', pos: ['Particle'], requireUnpinned: false },
    ],
    replace: [
      { text: '虚け', dictForm: '虚け', normalizedForm: '虚け', pos: 'Noun', reading: 'ウツケ', pin: 2674470 },
      { text: 'ども', dictForm: 'ども', normalizedForm: '共', pos: 'Suffix', reading: 'ドモ' },
    ],
    prev: { textAnyOf: ['この', 'その', 'あの', 'こんな', 'そんな', 'あんな'] },
  },
  // こった after an adjective is the ことだ contraction (いいこった), not 凝る.
  {
    id: 'kotta-kotoda',
    phase: 'Cleanup',
    match: [{ text: 'こった', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [
      {
        text: '',
        dictForm: 'こった',
        normalizedForm: 'こった',
        pos: 'Expression',
        reading: 'コッタ',
        pin: 2106260,
        pinReadingIndex: 0,
      },
    ],
    prev: { pos: ['IAdjective'] },
  },
  // Compound matching probes unattested ざまあみやがる, so shredded ざま|あみ|やがれ never reaches its entry.
  {
    id: 'zamaa-miyagare',
    phase: 'Late',
    match: [
      { text: 'ざま', requireUnpinned: false },
      { text: 'あみ', requireUnpinned: false },
      { text: 'やがれ', requireUnpinned: false },
    ],
    replace: [
      {
        text: 'ざまあみやがれ',
        dictForm: 'ざまあみやがれ',
        normalizedForm: 'ざまあみやがれ',
        pos: 'Expression',
        reading: 'ザマーミヤガレ',
        pin: 2868161,
        pinReadingIndex: 1,
      },
    ],
  },
  // Katakana イイ is the adjective いい, never the イラン・イラク abbreviation that wins on exact surface.
  {
    id: 'ii-katakana',
    phase: 'Cleanup',
    match: [{ text: 'イイ' }],
    replace: [
      {
        text: '',
        dictForm: 'いい',
        normalizedForm: 'いい',
        pos: 'IAdjective',
        reading: 'イイ',
        pin: 2820690,
        pinReadingIndex: 0,
      },
    ],
  },
  // 被っ* near an abstract-damage noun is こうむる (損失を被った); the clothing かぶる keeps everything else.
  {
    id: 'koumutta',
    phase: 'Cleanup',
    match: [{ textStartsWith: '被っ', pos: ['Verb'], dictFormAnyOf: ['被る'] }],
    replace: [{ text: '', dictForm: '被る', normalizedForm: '被る', pin: 1484340, recoverConjugations: true }],
    window: { from: -4, to: -1, textAnyOf: ['損失', '被害', '損害', '迷惑', 'ダメージ', '罰', '不利益'] },
  },
  // あんた = the colloquial pronoun "you", not the past of 編む.
  {
    id: 'anta',
    phase: 'Cleanup',
    match: [{ text: 'あんた', requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'あんた', normalizedForm: 'あんた', pos: 'Pronoun', pin: 1979920 }],
  },
  // うっす = the colloquial greeting, not 臼/薄.
  {
    id: 'ussu',
    phase: 'Cleanup',
    match: [{ text: 'うっす', requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'うっす', normalizedForm: 'うっす', pos: 'Interjection', pin: 2262630 }],
  },
  // Sudachi's adverb 見るも (見るも無残) swallows the も of もの: 見るも|の before anything is 見る|もの.
  {
    id: 'miru-mono',
    phase: 'Cleanup',
    match: [
      { text: '見るも', pos: ['Adverb'], requireUnpinned: false },
      { text: 'の', requireUnpinned: false },
    ],
    replace: [
      { text: '見る', dictForm: '見る', normalizedForm: '見る', pos: 'Verb', reading: 'ミル', pin: 1259290 },
      { text: 'もの', dictForm: 'もの', normalizedForm: '物', pos: 'Noun', reading: 'モノ', pin: 1502390 },
    ],
  },
  // Kana-only text: もうしょう(猛将)|が|ない is もう + しょうがない.
  {
    id: 'mou-shouganai',
    phase: 'Cleanup',
    match: [
      { text: 'もうしょう', requireUnpinned: false },
      { text: 'が', requireUnpinned: false },
      { text: 'ない', requireUnpinned: false },
    ],
    replace: [
      { text: 'もう', dictForm: 'もう', normalizedForm: 'もう', pos: 'Adverb', reading: 'モウ', pin: 1012480 },
      {
        text: 'しょうがない',
        dictForm: 'しょうがない',
        normalizedForm: 'しょうがない',
        pos: 'Expression',
        reading: 'ショウガナイ',
        pin: 1305510,
      },
    ],
  },
  // Kana-only text: そ|れいぜん(霊前) is それ + いぜん (以前).
  {
    id: 'sore-izen',
    phase: 'Cleanup',
    match: [
      { text: 'そ', requireUnpinned: false },
      { text: 'れいぜん', requireUnpinned: false },
    ],
    replace: [
      { text: 'それ', dictForm: 'それ', normalizedForm: '其れ', pos: 'Pronoun', reading: 'ソレ', pin: 1006970 },
      { text: 'いぜん', dictForm: '以前', normalizedForm: '以前', pos: 'Noun', reading: 'イゼン', pin: 1155150 },
    ],
  },
  // An i-adjective never takes ない directly, so いい|ない|しょ is いい + ないしょ (内緒).
  {
    id: 'naisho-after-adjective',
    phase: 'Early',
    match: [
      { text: 'ない', requireUnpinned: false },
      { text: 'しょ', requireUnpinned: false },
    ],
    replace: [
      {
        text: 'ないしょ',
        dictForm: 'ないしょ',
        normalizedForm: '内緒',
        pos: 'Noun',
        reading: 'ナイショ',
        pin: 1458510,
      },
    ],
    prev: { pos: ['IAdjective'] },
  },
  // 割|に is the expression 割に "considering" (の割に); a numeral keeps the counter and 割に合う keeps its own entry.
  {
    id: 'wari-ni',
    phase: 'Cleanup',
    match: [
      { text: '割', pos: ['Noun', 'CommonNoun', 'Suffix'], requireUnpinned: false },
      { text: 'に', pos: ['Particle'], requireUnpinned: false },
    ],
    replace: [
      { text: '割に', dictForm: '割に', normalizedForm: '割に', pos: 'Adverb', reading: 'ワリニ', pin: 1606930 },
    ],
    prev: { numeral: true, negate: true },
    next: { textStartsWithAnyOf: ['合', 'あわ', 'あう', 'あい', 'あっ'], negate: true },
  },
  {
    id: 'wari-ni-wa',
    phase: 'Cleanup',
    match: [
      { text: '割', pos: ['Noun', 'CommonNoun', 'Suffix'], requireUnpinned: false },
      { text: 'には', requireUnpinned: false },
    ],
    replace: [
      { text: '割に', dictForm: '割に', normalizedForm: '割に', pos: 'Adverb', reading: 'ワリニ', pin: 1606930 },
      { text: 'は', dictForm: 'は', normalizedForm: 'は', pos: 'Particle', reading: 'ハ' },
    ],
    prev: { numeral: true, negate: true },
  },
  // After a verb stem 尽くし is the auxiliary 尽くす (燃やし尽くし), not the noun suffix "all sorts of" (花尽くし).
  {
    id: 'tsukushi-aux',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['尽くし', 'つくし'], pos: ['Verb'], requireUnpinned: false }],
    replace: [
      { text: '', dictForm: '尽くす', normalizedForm: '尽くす', pos: 'Verb', pin: 1370090, recoverConjugations: true },
    ],
    prev: { pos: ['Verb'] },
  },
  // The film title 勝手にしやがれ is, in running text, the phrase 勝手に + しやがれ.
  {
    id: 'katte-ni-shiyagare',
    phase: 'Cleanup',
    match: [{ text: '勝手にしやがれ', requireUnpinned: false }],
    replace: [
      {
        text: '勝手に',
        dictForm: '勝手に',
        normalizedForm: '勝手に',
        pos: 'Adverb',
        reading: 'カッテニ',
        pin: 1346200,
      },
      { text: 'しやがれ', dictForm: 'する', normalizedForm: '為る', pos: 'Verb', reading: 'シヤガレ' },
    ],
  },
  // だっけ = the recollection ending, not だけ.
  {
    id: 'dakke',
    phase: 'Cleanup',
    match: [{ text: 'だっけ', requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'だっけ', pos: 'Expression', pin: 2131200 }],
  },
  // いかんせん (如何せん) must not resegment into いかん + せん.
  {
    id: 'ikansen',
    phase: 'Cleanup',
    match: [{ text: 'いかんせん', requireUnpinned: false }],
    replace: [{ text: '', pin: 1919420 }],
  },
  // Prefix-tagged せん is the Kansai negative of する, not the numeral 千.
  {
    id: 'sen-neg',
    phase: 'Cleanup',
    match: [{ text: 'せん', pos: ['Prefix'], requireUnpinned: false }],
    replace: [{ text: '', pos: 'Expression', pin: 2844926 }],
  },
  // セン not after a numeral is 線 "line", not 千.
  {
    id: 'sen-line',
    phase: 'Cleanup',
    match: [{ text: 'セン', requireUnpinned: false }],
    replace: [{ text: '', pin: 1391780 }],
    prev: { numeral: true, negate: true },
  },
  // ヤード after a numeral is the unit (碼), not the working-area ヤード.
  {
    id: 'yard-unit',
    phase: 'Cleanup',
    match: [{ text: 'ヤード', requireUnpinned: false }],
    replace: [{ text: '', pin: 1136260, pinReadingIndex: 1 }],
    prev: { numeral: true },
  },
  // ノリ = 乗り, not 海苔.
  {
    id: 'nori',
    phase: 'Cleanup',
    match: [{ text: 'ノリ', requireUnpinned: false }],
    replace: [{ text: '', pin: 1354720 }],
  },
  // 頚木 = kanji variant of 頸木 (くびき/yoke), absent from lookups.
  {
    id: 'kubiki',
    phase: 'Cleanup',
    match: [{ text: '頚木', requireUnpinned: false }],
    replace: [{ text: '', pin: 1831840 }],
  },
  // Drawn-out かあ is the question particle か, not the noun カア.
  {
    id: 'kaa',
    phase: 'Cleanup',
    match: [{ text: 'かあ', pos: ['Particle'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'か', normalizedForm: 'か', pin: 2028970 }],
  },
  // アリアリ = ありあり "vividly", not the currency ariary.
  {
    id: 'ariari',
    phase: 'Cleanup',
    match: [{ text: 'アリアリ', requireUnpinned: false }],
    replace: [{ text: '', pin: 2007200 }],
  },
  // そうそう = "that's right", unless before たる/たり (錚々たる).
  {
    id: 'sousou',
    phase: 'Cleanup',
    match: [{ text: 'そうそう', requireUnpinned: false }],
    replace: [{ text: '', pin: 1006640 }],
    next: { textAnyOf: ['たる', 'たり'], negate: true },
  },
  // いとおしい = 愛おしい, not the archaic verb 射通す.
  {
    id: 'itooshii',
    phase: 'Cleanup',
    match: [{ text: 'いとおしい', dictFormAnyOf: ['いとおす', '射通す'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'いとおしい', normalizedForm: '愛おしい', pos: 'IAdjective', pin: 2007340 }],
  },
  // してみれば/してみりゃ after から is the connective "from X's standpoint"; 勉強をしてみれば keeps the verb.
  {
    id: 'kara-shitemireba',
    phase: 'Cleanup',
    match: [{ text: 'してみれば' }],
    replace: [{ text: '', dictForm: 'してみれば', pos: 'Expression', pin: 2407670, pinReadingIndex: 1 }],
    prev: { textAnyOf: ['から'] },
  },
  {
    id: 'kara-shitemirya',
    phase: 'Cleanup',
    match: [{ text: 'してみりゃ' }],
    replace: [{ text: '', dictForm: 'してみれば', pos: 'Expression', pin: 2407670, pinReadingIndex: 1 }],
    prev: { textAnyOf: ['から'] },
  },
  // なかれ = the classical negative imperative 勿れ, not 無い/なし.
  {
    id: 'nakare',
    phase: 'Cleanup',
    match: [{ text: 'なかれ', dictFormAnyOf: ['ない', 'なし', '無い'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'なかれ', normalizedForm: 'なかれ', pos: 'Suffix', pin: 1535750 }],
  },
  // Clause-initial つって/つった is the という contraction (釣る needs an object); 魚をつって keeps the verb.
  {
    id: 'tsutte-quotative',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['つって', 'つった'], dictFormAnyOf: ['釣る', '吊る', 'つる'] }],
    replace: [{ text: '', dictForm: 'っつう', pos: 'Particle', pin: 2798260 }],
    prev: { clauseBoundary: true },
  },
  // The っ/ー marks mean the という contraction, never つて "connections" or 行く forms.
  {
    id: 'ttsutte',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['っつって', 'っつった', 'つーて', 'っつー', 'っつう'] }],
    replace: [{ text: '', dictForm: 'っつう', pos: 'Particle', pin: 2798260 }],
  },
  // --- Re-cuts (splits/merges): text is conserved, asserted at load. ---
  // 行く steals ない's い before the という contraction or quotative (できな|いっ|つー, たまんな|いっ|て).
  {
    id: 'nai-ttsuu',
    phase: 'Early',
    match: [
      { text: 'な', pos: ['Auxiliary'], dictFormAnyOf: ['ない'] },
      { text: 'いっ', dictFormAnyOf: ['いく', '行く'] },
      { text: 'つー', dictFormAnyOf: ['つう'] },
    ],
    replace: [
      { text: 'ない', dictForm: 'ない', normalizedForm: 'ない', pos: 'Auxiliary', reading: 'ナイ' },
      {
        text: 'っつー',
        dictForm: 'っつう',
        normalizedForm: 'っつう',
        pos: 'Particle',
        reading: 'ッツー',
        pin: 2798260,
      },
    ],
  },
  {
    id: 'nai-tte-mora',
    phase: 'Early',
    match: [
      { text: 'な', pos: ['Auxiliary'], dictFormAnyOf: ['ない'] },
      { text: 'いっ', dictFormAnyOf: ['いく', '行く'] },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      { text: 'ない', dictForm: 'ない', normalizedForm: 'ない', pos: 'Auxiliary', reading: 'ナイ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
  },
  // Clause-initial てこ+と is the てこと (ということ) contraction; Sudachi tags it Adverb, the lever 梃子 Noun.
  {
    id: 'te-koto',
    phase: 'Early',
    match: [
      { text: 'てこ', pos: ['Adverb'] },
      { text: 'と', pos: ['Particle'] },
    ],
    replace: [
      { text: 'て', dictForm: 'て', normalizedForm: 'て', pos: 'Particle', reading: 'テ' },
      { text: 'こと', dictForm: 'こと', normalizedForm: 'こと', pos: 'Noun', reading: 'コト' },
    ],
    prev: { clauseBoundary: true },
  },
  // しなきゃって: Sudachi reads きゃっ as a scream; it is the ければ-contraction なきゃ + quotative って.
  {
    id: 'nakya-tte',
    phase: 'Early',
    match: [
      { text: 'な', pos: ['Auxiliary'], dictFormAnyOf: ['だ'] },
      { text: 'きゃっ', pos: ['Interjection'] },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      { text: 'なきゃ', dictForm: 'なきゃ', normalizedForm: 'なければ', pos: 'Auxiliary', reading: 'ナキャ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
  },
  // ずっと+いる shreds as ずっ[ずる]|とい[Aux] (ずっといた).
  {
    id: 'zutto-i',
    phase: 'Early',
    match: [
      { text: 'ずっ', dictFormAnyOf: ['ずる'] },
      { text: 'とい', pos: ['Auxiliary'] },
    ],
    replace: [
      { text: 'ずっと', dictForm: 'ずっと', normalizedForm: 'ずっと', pos: 'Adverb', reading: 'ズット' },
      { text: 'い', dictForm: 'いる', normalizedForm: 'いる', pos: 'Verb', reading: 'イ' },
    ],
  },
  // じゃ|あっ|て is じゃあ + って (じゃあってなによ); ある's common-verb protection blocks the mora-theft repair.
  {
    id: 'jaa-tte',
    phase: 'Early',
    match: [
      { text: 'じゃ', pos: ['Conjunction'] },
      { text: 'あっ', dictFormAnyOf: ['ある', '会う'] },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      {
        text: 'じゃあ',
        dictForm: 'じゃあ',
        normalizedForm: 'じゃあ',
        pos: 'Conjunction',
        reading: 'ジャア',
        pin: 1005900,
      },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
  },
  // Clause-final てって is て + quotative って (顔出してって……); 出てってくれ keeps the てく auxiliary.
  {
    id: 'tette-quotative',
    phase: 'Early',
    match: [
      { text: 'てっ', pos: ['Auxiliary'], dictFormAnyOf: ['てく'] },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      { text: 'て', dictForm: 'て', normalizedForm: 'て', pos: 'Particle', reading: 'テ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
    next: { clauseBoundary: true },
  },
  // The contraction's leading っ rides on the previous token (かっ|つー); return it before combines build 買う lookalikes.
  {
    id: 'ka-ttsuu',
    phase: 'Early',
    match: [{ text: 'かっ' }, { text: 'つー', dictFormAnyOf: ['つう'] }],
    replace: [
      { text: 'か', dictForm: 'か', normalizedForm: 'か', pos: 'Particle', reading: 'カ' },
      {
        text: 'っつー',
        dictForm: 'っつう',
        normalizedForm: 'っつう',
        pos: 'Particle',
        reading: 'ッツー',
        pin: 2798260,
      },
    ],
  },
  {
    id: 'ka-cchuu',
    phase: 'Early',
    match: [{ text: 'かっ' }, { text: 'ちゅう', pos: ['Auxiliary'], dictFormAnyOf: ['ちゅう'] }],
    replace: [
      { text: 'か', dictForm: 'か', normalizedForm: 'か', pos: 'Particle', reading: 'カ' },
      {
        text: 'っちゅう',
        dictForm: 'っちゅう',
        normalizedForm: 'っちゅう',
        pos: 'Conjunction',
        reading: 'ッチュウ',
        pin: 2757620,
      },
    ],
  },
  // ども stays a Suffix so a preceding noun can reclaim it (子+ども → 子ども).
  {
    id: 'domo-ttsutte',
    phase: 'Early',
    match: [
      { text: 'どもっ', dictFormAnyOf: ['どもる', '吃る'] },
      { text: 'つっ', dictFormAnyOf: ['つう'] },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      { text: 'ども', dictForm: 'ども', normalizedForm: 'ども', pos: 'Suffix', reading: 'ドモ' },
      {
        text: 'っつって',
        dictForm: 'っつう',
        normalizedForm: 'っつう',
        pos: 'Particle',
        reading: 'ッツッテ',
        pin: 2798260,
      },
    ],
  },
  // ねえ's え becomes an interjection before the contraction (いらね|えっ|つっ|た → え + っつった).
  {
    id: 'e-ttsutta',
    phase: 'Early',
    match: [
      { text: 'えっ', pos: ['Interjection'] },
      { text: 'つっ', dictFormAnyOf: ['つう'] },
      { text: 'た', pos: ['Auxiliary'] },
    ],
    replace: [
      { text: 'え', dictForm: 'え', normalizedForm: 'え', pos: 'Interjection', reading: 'エ' },
      {
        text: 'っつった',
        dictForm: 'っつう',
        normalizedForm: 'っつう',
        pos: 'Particle',
        reading: 'ッツッタ',
        pin: 2798260,
      },
    ],
  },
  // ずつって: the ず arrives as the negative auxiliary, which tsutte-raw's function-word gate would accept.
  {
    id: 'zutsu-tte',
    phase: 'Early',
    match: [{ text: 'ず' }, { text: 'つっ', dictFormAnyOf: ['つう'] }, { text: 'て', pos: ['Particle'] }],
    replace: [
      { text: 'ずつ', dictForm: 'ずつ', normalizedForm: 'ずつ', pos: 'Particle', reading: 'ズツ', pin: 2829645 },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
  },
  // Bare つっ+て/た is the contraction only after a boundary or function word; after content, つ was stolen (待|つっ|て).
  {
    id: 'tsutte-raw',
    phase: 'Early',
    match: [
      { text: 'つっ', dictFormAnyOf: ['つう'] },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      {
        text: 'つって',
        dictForm: 'っつう',
        normalizedForm: 'っつう',
        pos: 'Particle',
        reading: 'ツッテ',
        pin: 2798260,
      },
    ],
    prev: {
      pos: ['Verb', 'Noun', 'CommonNoun', 'Name', 'Pronoun', 'NaAdjective', 'Prefix', 'Suffix', 'Numeral', 'Counter'],
      negate: true,
    },
  },
  {
    id: 'tsutta-raw',
    phase: 'Early',
    match: [
      { text: 'つっ', dictFormAnyOf: ['つう'] },
      { text: 'た', pos: ['Auxiliary'] },
    ],
    replace: [
      {
        text: 'つった',
        dictForm: 'っつう',
        normalizedForm: 'っつう',
        pos: 'Particle',
        reading: 'ツッタ',
        pin: 2798260,
      },
    ],
    prev: {
      pos: ['Verb', 'Noun', 'CommonNoun', 'Name', 'Pronoun', 'NaAdjective', 'Prefix', 'Suffix', 'Numeral', 'Counter'],
      negate: true,
    },
  },
  // Na-adj + だって + quote verb is copula + quotative (大袈裟だって言いたい); Cleanup, after CombineTte and verb merges.
  {
    id: 'datte-quotative',
    phase: 'Cleanup',
    match: [{ text: 'だって', requireUnpinned: false }],
    replace: [
      { text: 'だ', dictForm: 'だ', normalizedForm: 'だ', pos: 'Auxiliary', reading: 'ダ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ', pin: 2086960 },
    ],
    // Noun + だって is too often "even/too" to split (子供だって思ってる, 俺だって).
    prev: { pos: ['NaAdjective'] },
    next: { pos: ['Verb'], textStartsWithAnyOf: ['言', '思', '聞', '考', '感'] },
  },
  // Slang ねえ before quotative って shreds to ね + えっ + て after a verb (堪らねえって).
  {
    id: 'nee-tte',
    phase: 'Early',
    match: [
      { text: 'ね' },
      // Sudachi tags the stolen え as Interjection or Verb by context
      { text: 'えっ' },
      { text: 'て', pos: ['Particle'] },
    ],
    replace: [
      { text: 'ねえ', dictForm: 'ない', normalizedForm: 'ない', pos: 'Auxiliary', reading: 'ネエ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ', pin: 2086960 },
    ],
    prev: { pos: ['Verb'] },
  },
  // たっちゅう after a verb is past た + dialectal という (起こしたっちゅう), not the temple noun 塔頭.
  {
    id: 'ta-cchuu',
    phase: 'Early',
    match: [{ text: 'たっちゅう' }],
    replace: [
      { text: 'た', dictForm: 'た', normalizedForm: 'た', pos: 'Auxiliary', reading: 'タ' },
      {
        text: 'っちゅう',
        dictForm: 'っちゅう',
        normalizedForm: 'っちゅう',
        pos: 'Conjunction',
        reading: 'ッチュウ',
        pin: 2757620,
      },
    ],
    prev: { pos: ['Verb'] },
  },
  // じゃ + bare interjection あ is じゃあ; a genuine interjection あ after じゃ is set off by punctuation.
  {
    id: 'jaa',
    phase: 'Cleanup',
    match: [
      { text: 'じゃ', pos: ['Conjunction'] },
      { text: 'あ', pos: ['Interjection'] },
    ],
    replace: [
      {
        text: 'じゃあ',
        dictForm: 'じゃあ',
        normalizedForm: 'じゃあ',
        pos: 'Conjunction',
        reading: 'ジャア',
        pin: 1005900,
        pinReadingIndex: 0,
      },
    ],
  },
  // Kyushu や + ばい follows a full predicate; after a noun it is a cut やばい.
  {
    id: 'ya-bai',
    phase: 'Cleanup',
    match: [
      { text: 'や', pos: ['Auxiliary'] },
      { text: 'ばい', pos: ['Particle'] },
    ],
    replace: [
      {
        text: 'やばい',
        dictForm: 'やばい',
        normalizedForm: 'やばい',
        pos: 'IAdjective',
        reading: 'ヤバイ',
        pin: 1012840,
        pinReadingIndex: 0,
      },
    ],
  },
  // 何かって is 何か + quotative って, not the adverb かつて.
  {
    id: 'nani-katte',
    phase: 'Cleanup',
    match: [{ text: 'かって', requireUnpinned: false }],
    replace: [
      { text: 'か', dictForm: 'か', normalizedForm: 'か', pos: 'Particle', reading: 'カ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
    prev: { textAnyOf: ['何', '誰', 'だれ', 'なん'] },
  },
  // Kana からだ after a predicate is から + だ, not 体; a following case/topic particle means the body noun.
  {
    id: 'kara-da',
    phase: 'Cleanup',
    match: [{ text: 'からだ', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [
      { text: 'から', dictForm: 'から', normalizedForm: 'から', pos: 'Particle', reading: 'カラ' },
      { text: 'だ', dictForm: 'だ', normalizedForm: 'だ', pos: 'Auxiliary', reading: 'ダ' },
    ],
    prev: { pos: ['Verb', 'IAdjective', 'Auxiliary'] },
    next: { pos: ['Particle'], textAnyOf: ['を', 'が', 'に', 'は', 'も', 'の', 'で', 'へ', 'や'], negate: true },
  },
  // 思いで after an adjective is 思い + で, not the memory noun 思い出.
  {
    id: 'omoi-de',
    phase: 'Cleanup',
    match: [{ text: '思いで', requireUnpinned: false }],
    replace: [
      { text: '思い', dictForm: '思い', normalizedForm: '思い', pos: 'Noun', reading: 'オモイ' },
      { text: 'で', dictForm: 'で', normalizedForm: 'で', pos: 'Particle', reading: 'デ' },
    ],
    prev: { pos: ['IAdjective', 'Adnominal'] },
  },
  // 右手首/左手首 is 右/左 + 手首 "right/left wrist"; the lattice cuts 右手 + 首.
  {
    id: 'migi-tekubi',
    phase: 'Cleanup',
    match: [{ text: '右手首', requireUnpinned: false }],
    replace: [
      { text: '右', dictForm: '右', normalizedForm: '右', pos: 'Noun', reading: 'ミギ' },
      { text: '手首', dictForm: '手首', normalizedForm: '手首', pos: 'Noun', reading: 'テクビ', pin: 1327770 },
    ],
  },
  {
    id: 'hidari-tekubi',
    phase: 'Cleanup',
    match: [{ text: '左手首', requireUnpinned: false }],
    replace: [
      { text: '左', dictForm: '左', normalizedForm: '左', pos: 'Noun', reading: 'ヒダリ' },
      { text: '手首', dictForm: '手首', normalizedForm: '手首', pos: 'Noun', reading: 'テクビ', pin: 1327770 },
    ],
  },
  // 主人格 is 主 + 人格 "primary personality"; the lattice cuts 主人 + 格.
  {
    id: 'shu-jinkaku',
    phase: 'Cleanup',
    match: [{ text: '主人', requireUnpinned: false }, { text: '格' }],
    replace: [
      { text: '主', dictForm: '主', normalizedForm: '主', pos: 'Noun', reading: 'シュ' },
      { text: '人格', dictForm: '人格', normalizedForm: '人格', pos: 'Noun', reading: 'ジンカク', pin: 1366730 },
    ],
  },
  // 存 + 在す is a shredded 存在する (存在すべく); 在す alone is the archaic honorific います.
  {
    id: 'sonzai-su',
    phase: 'Cleanup',
    match: [{ text: '存', requireUnpinned: false }, { text: '在す' }],
    replace: [
      { text: '存在', dictForm: '存在', normalizedForm: '存在', pos: 'Noun', reading: 'ソンザイ' },
      { text: 'す', dictForm: 'する', normalizedForm: 'する', pos: 'Verb', reading: 'ス', pin: 1157170 },
    ],
  },
  // Sentence-final ねえ can't follow 仮定形 なら, so ならねえ is 成る's slang negative (我慢ならねえ), shaped as ねえ IAdjective.
  {
    id: 'nara-nee',
    phase: 'Early',
    match: [
      { text: 'なら', pos: ['Auxiliary'], dictFormAnyOf: ['だ'] },
      { text: 'ねえ', pos: ['Particle'] },
    ],
    replace: [
      { text: 'なら', dictForm: '成る', normalizedForm: '成る', pos: 'Verb', reading: 'ナラ' },
      { text: 'ねえ', dictForm: 'ねえ', normalizedForm: '無い', pos: 'IAdjective', reading: 'ネエ' },
    ],
  },
  // 面さ (面す) is real only before れる/せる; otherwise it is suffix 面 (づら) + さ, Early so it rejoins its noun.
  {
    id: 'tsura-sa',
    phase: 'Early',
    match: [{ text: '面さ', pos: ['Verb'], dictFormAnyOf: ['面す', '面する'] }],
    replace: [
      { text: '面', dictForm: '面', normalizedForm: '面', pos: 'Suffix', reading: 'ヅラ' },
      { text: 'さ', dictForm: 'さ', normalizedForm: 'さ', pos: 'Particle', reading: 'サ' },
    ],
    prev: { pos: ['Noun', 'CommonNoun'] },
    next: { textAnyOf: ['れ', 'れる', 'れた', 'せ', 'せる'], negate: true },
  },
  // Sudachi's adverb もさ is always particle も + さ; kana 猛者 is [uk] in JMdict and would otherwise claim it.
  {
    id: 'demo-sa',
    phase: 'Early',
    match: [{ text: 'で' }, { text: 'もさ', pos: ['Adverb'] }],
    replace: [
      { text: 'でも', dictForm: 'でも', normalizedForm: 'でも', pos: 'Conjunction', reading: 'デモ' },
      { text: 'さ', dictForm: 'さ', normalizedForm: 'さ', pos: 'Particle', reading: 'サ' },
    ],
  },
  {
    id: 'mo-sa',
    phase: 'Early',
    match: [{ text: 'もさ', pos: ['Adverb'] }],
    replace: [
      { text: 'も', dictForm: 'も', normalizedForm: 'も', pos: 'Particle', reading: 'モ' },
      { text: 'さ', dictForm: 'さ', normalizedForm: 'さ', pos: 'Particle', reading: 'サ' },
    ],
  },
  {
    id: 'demo-sa-katakana',
    phase: 'Early',
    match: [{ text: 'で' }, { text: 'もサ', pos: ['Adverb'] }],
    replace: [
      { text: 'でも', dictForm: 'でも', normalizedForm: 'でも', pos: 'Conjunction', reading: 'デモ' },
      { text: 'サ', dictForm: 'さ', normalizedForm: 'さ', pos: 'Particle', reading: 'サ' },
    ],
  },
  {
    id: 'mo-sa-katakana',
    phase: 'Early',
    match: [{ text: 'もサ', pos: ['Adverb'] }],
    replace: [
      { text: 'も', dictForm: 'も', normalizedForm: 'も', pos: 'Particle', reading: 'モ' },
      { text: 'サ', dictForm: 'さ', normalizedForm: 'さ', pos: 'Particle', reading: 'サ' },
    ],
  },
  // あ directly against いつも is あいつ + も; a genuine interjection あ is set off by punctuation.
  {
    id: 'aitsu-mo',
    phase: 'Late',
    match: [{ text: 'あ', pos: ['Interjection'], requireUnpinned: false }, { text: 'いつも' }],
    replace: [
      { text: 'あいつ', dictForm: 'あいつ', normalizedForm: 'あいつ', pos: 'Pronoun', reading: 'アイツ' },
      { text: 'も', dictForm: 'も', normalizedForm: 'も', pos: 'Particle', reading: 'モ' },
    ],
  },
  // --- Single-surface fixes at the ProcessSpecialCases position; none gate on pins. ---
  // そうかいそうかい: Sudachi mashes the middle into OOV かいそうか, which then matches 階層化.
  {
    id: 'kaisouka',
    phase: 'Early',
    match: [{ text: 'かいそうか', pos: ['Noun', 'CommonNoun'], requireUnpinned: false }],
    replace: [
      { text: 'かい', dictForm: 'かい', normalizedForm: 'かい', pos: 'Particle', reading: 'カイ' },
      { text: 'そう', dictForm: 'そう', normalizedForm: 'そう', pos: 'Adverb', reading: 'ソウ' },
      { text: 'か', dictForm: 'か', normalizedForm: 'か', pos: 'Particle', reading: 'カ' },
    ],
  },
  // [noun]がないって: Sudachi cuts がな(仮名)+いっ(言う)+て, which resolves to the rare 我鳴る.
  {
    id: 'ganai-tte',
    phase: 'Early',
    match: [
      { text: 'がな', normalizedFormAnyOf: ['仮名'], requireUnpinned: false },
      { text: 'いっ', normalizedFormAnyOf: ['言う'], requireUnpinned: false },
      { text: 'て', requireUnpinned: false },
    ],
    replace: [
      { text: 'が', dictForm: 'が', normalizedForm: 'が', pos: 'Particle', reading: 'ガ', pin: 2028930 },
      { text: 'ない', dictForm: 'ない', normalizedForm: '無い', pos: 'IAdjective', reading: 'ナイ', pin: 1529520 },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ', pin: 2086960 },
    ],
    prev: { pos: ['Noun', 'CommonNoun', 'Pronoun', 'Counter'] },
  },
  // After a predicate, きっての steals とき's き (→ とき+って+の); after a noun it is real (学校きっての秀才).
  {
    id: 'toki-tteno',
    phase: 'Early',
    match: [
      { text: 'と', requireUnpinned: false },
      { text: 'きっての', requireUnpinned: false },
    ],
    replace: [
      { text: 'とき', dictForm: 'とき', normalizedForm: '時', pos: 'Noun', reading: 'トキ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ', pin: 2086960 },
      { text: 'の', dictForm: 'の', normalizedForm: 'の', pos: 'Particle', reading: 'ノ' },
    ],
    prev: { pos: ['Verb', 'IAdjective', 'Auxiliary', 'Expression'] },
  },
  // Sudachi normalises most ai→ee adjectives whole, but ありがてぇ shreds to あり|が|てぇ.
  {
    id: 'arigatee',
    phase: 'Early',
    match: [
      { text: 'あり', requireUnpinned: false },
      { text: 'が', requireUnpinned: false },
      { text: 'てぇ', requireUnpinned: false },
    ],
    replace: [
      {
        text: 'ありがてぇ',
        dictForm: 'ありがたい',
        normalizedForm: 'ありがたい',
        pos: 'IAdjective',
        reading: 'アリガテェ',
        pin: 1541560,
        recoverConjugations: true,
      },
    ],
  },
  // Non-standard 貸り (借り) cuts as 貸 Noun + り Aux; as a verb stem the inflection combines (貸りたい).
  {
    id: 'kariru',
    phase: 'Early',
    match: [
      { text: '貸', pos: ['Noun', 'CommonNoun'], requireUnpinned: false },
      { text: 'り', requireUnpinned: false },
    ],
    replace: [{ text: '貸り', dictForm: '貸りる', normalizedForm: '貸りる', pos: 'Verb', reading: 'カリ' }],
    guard: { kind: 'NonNameCompoundExists', pattern: '貸りる' },
  },
  // Sudachi cuts こんなの as 連体詞 こん|なの (→ 紺); the POS gate spares the noun (色は紺なの).
  {
    id: 'konna-no',
    phase: 'Early',
    match: [
      { text: 'こん', pos: ['PrenounAdjectival'], requireUnpinned: false },
      { text: 'なの', requireUnpinned: false },
    ],
    replace: [
      { text: 'こんな', dictForm: 'こんな', normalizedForm: 'こんな', reading: 'コンナ' },
      { text: 'の', dictForm: 'の', normalizedForm: 'の', pos: 'Particle', reading: 'ノ' },
    ],
    guard: { kind: 'CompoundExists', pattern: 'こんな' },
  },
  {
    id: 'sonna-no',
    phase: 'Early',
    match: [
      { text: 'そん', pos: ['PrenounAdjectival'], requireUnpinned: false },
      { text: 'なの', requireUnpinned: false },
    ],
    replace: [
      { text: 'そんな', dictForm: 'そんな', normalizedForm: 'そんな', reading: 'ソンナ' },
      { text: 'の', dictForm: 'の', normalizedForm: 'の', pos: 'Particle', reading: 'ノ' },
    ],
    guard: { kind: 'CompoundExists', pattern: 'そんな' },
  },
  {
    id: 'anna-no',
    phase: 'Early',
    match: [
      { text: 'あん', pos: ['PrenounAdjectival'], requireUnpinned: false },
      { text: 'なの', requireUnpinned: false },
    ],
    replace: [
      { text: 'あんな', dictForm: 'あんな', normalizedForm: 'あんな', reading: 'アンナ' },
      { text: 'の', dictForm: 'の', normalizedForm: 'の', pos: 'Particle', reading: 'ノ' },
    ],
    guard: { kind: 'CompoundExists', pattern: 'あんな' },
  },
  {
    id: 'donna-no',
    phase: 'Early',
    match: [
      { text: 'どん', pos: ['PrenounAdjectival'], requireUnpinned: false },
      { text: 'なの', requireUnpinned: false },
    ],
    replace: [
      { text: 'どんな', dictForm: 'どんな', normalizedForm: 'どんな', reading: 'ドンナ' },
      { text: 'の', dictForm: 'の', normalizedForm: 'の', pos: 'Particle', reading: 'ノ' },
    ],
    guard: { kind: 'CompoundExists', pattern: 'どんな' },
  },
  // Sudachi cuts ども+め after a noun as prefix ど + もめ (揉め) (化け物どもめ).
  {
    id: 'domo-me',
    phase: 'Early',
    match: [
      { text: 'ど', pos: ['Prefix'], requireUnpinned: false },
      { text: 'もめ', requireUnpinned: false },
    ],
    replace: [
      { text: 'ども', dictForm: 'ども', normalizedForm: 'ども', pos: 'Suffix', reading: 'ドモ' },
      { text: 'め', dictForm: 'め', normalizedForm: 'め', pos: 'Suffix', reading: 'メ' },
    ],
    prev: { pos: ['Noun', 'CommonNoun', 'Name', 'Pronoun'] },
  },
  // Katakana particles ノヨ, not the name 乃代.
  {
    id: 'no-yo',
    phase: 'Early',
    match: [{ text: 'ノヨ', pos: ['Noun', 'NaAdjective'], requireUnpinned: false }],
    replace: [
      { text: 'ノ', dictForm: 'の', normalizedForm: 'の', pos: 'Particle', reading: 'ノ' },
      { text: 'ヨ', dictForm: 'よ', normalizedForm: 'よ', pos: 'Particle', reading: 'ヨ' },
    ],
  },
  // Clause-initial いいか、/いいか! is "Listen!"; the question keeps its split elsewhere (行っていいか分からない, いいか?).
  {
    id: 'iika-listen',
    phase: 'Early',
    match: [
      { text: 'いい', pos: ['IAdjective'], requireUnpinned: false },
      { text: 'か', pos: ['Particle'], requireUnpinned: false },
    ],
    replace: [
      {
        text: 'いいか',
        dictForm: 'いいか',
        normalizedForm: 'いいか',
        pos: 'Expression',
        reading: 'イイカ',
        pin: 2555520,
      },
    ],
    prev: { clauseBoundary: true },
    next: { textAnyOf: ['、', '!', '！'] },
  },
  // Clause-initial ですが/ですけど are polite conjunctions ("however"); with no predicate before them they cannot be copula + particle.
  {
    id: 'desuga-conj',
    phase: 'Early',
    match: [
      { text: 'です', pos: ['Auxiliary'] },
      { text: 'が', pos: ['Particle'] },
    ],
    replace: [
      {
        text: 'ですが',
        dictForm: 'ですが',
        normalizedForm: 'ですが',
        pos: 'Conjunction',
        reading: 'デスガ',
        pin: 2850805,
      },
    ],
    prev: { clauseBoundary: true },
  },
  {
    id: 'desukedo-conj',
    phase: 'Early',
    match: [
      { text: 'です', pos: ['Auxiliary'] },
      { text: 'けど', pos: ['Particle'] },
    ],
    replace: [
      {
        text: 'ですけど',
        dictForm: 'ですけど',
        normalizedForm: 'ですけど',
        pos: 'Conjunction',
        reading: 'デスケド',
        pin: 2871534,
      },
    ],
    prev: { clauseBoundary: true },
  },
  // Noun ひと with lemma 一 is almost always 人; prefix uses (ひと月) are tagged 接頭辞 or stay fused.
  {
    id: 'hito-dict',
    phase: 'Early',
    match: [{ text: 'ひと', pos: ['Noun'], dictFormAnyOf: ['一'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: '人', normalizedForm: '人' }],
  },
  {
    id: 'hito-norm',
    phase: 'Early',
    match: [{ text: 'ひと', pos: ['Noun'], normalizedFormAnyOf: ['一'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: '人', normalizedForm: '人' }],
  },
  // Suffix かねる + negative is the lexicalised かねない (破りかねない); df=かねる rules out 金.
  {
    id: 'kanenai',
    phase: 'Early',
    match: [
      { text: 'かね', pos: ['Suffix'], dictFormAnyOf: ['かねる'], requireUnpinned: false },
      { text: 'ない', requireUnpinned: false },
    ],
    replace: [
      { text: 'かねない', dictForm: 'かねない', normalizedForm: 'かねない', pos: 'Expression', reading: 'カネナイ' },
    ],
  },
  {
    id: 'kanenakatta',
    phase: 'Early',
    match: [
      { text: 'かね', pos: ['Suffix'], dictFormAnyOf: ['かねる'], requireUnpinned: false },
      { text: 'なかっ', requireUnpinned: false },
      { text: 'た', requireUnpinned: false },
    ],
    replace: [
      {
        text: 'かねなかった',
        dictForm: 'かねない',
        normalizedForm: 'かねない',
        pos: 'Expression',
        reading: 'カネナカッタ',
      },
    ],
  },
  // Imperative たまえ after a verb stem (気をつけたまえ); た前 is ungrammatical ("before" is る前/の前).
  {
    id: 'tamae',
    phase: 'Early',
    match: [
      { text: 'た', pos: ['Auxiliary'], requireUnpinned: false },
      { text: 'まえ', pos: ['Noun'], requireUnpinned: false },
    ],
    replace: [{ text: 'たまえ', dictForm: 'たまえ', normalizedForm: 'たまえ', pos: 'Suffix', reading: 'タマエ' }],
    prev: { pos: ['Verb'] },
  },
  // Suffix-tagged っけ is the recollection sentence-ending particle.
  {
    id: 'kke-sfp',
    phase: 'Early',
    match: [{ text: 'っけ', pos: ['Suffix'], requireUnpinned: false }],
    replace: [{ text: '', pos: 'Particle', posSection: 'SentenceEndingParticle' }],
  },
  // 私戦 + いたく(痛く) is 私 + 戦いたく, not しせん "private war".
  {
    id: 'shisen-itaku',
    phase: 'Early',
    match: [
      { text: '私戦', pos: ['Noun', 'CommonNoun'], requireUnpinned: false },
      { text: 'いたく', normalizedFormAnyOf: ['痛く'], requireUnpinned: false },
    ],
    replace: [
      { text: '私', dictForm: '私', normalizedForm: '私', pos: 'Pronoun', reading: 'ワタシ' },
      { text: '戦いたく', dictForm: '戦う', normalizedForm: '戦う', pos: 'Verb', reading: 'タタカイタク' },
    ],
  },
  // Sudachi glues a trailing particle into these 表現 tokens.
  {
    id: 'hitomae-de',
    phase: 'Early',
    match: [{ text: '人前で', pos: ['Expression'], requireUnpinned: false }],
    replace: [
      { text: '人前', dictForm: '人前', normalizedForm: '人前', pos: 'Noun', reading: '' },
      { text: 'で', dictForm: 'で', normalizedForm: 'で', pos: 'Particle', reading: 'デ' },
    ],
  },
  {
    id: 'sama-ni',
    phase: 'Early',
    match: [{ text: '様に', pos: ['Expression'], requireUnpinned: false }],
    replace: [
      { text: '様', dictForm: '様', normalizedForm: '様', pos: 'Noun', reading: '' },
      { text: 'に', dictForm: 'に', normalizedForm: 'に', pos: 'Particle', reading: 'ニ' },
    ],
  },
  {
    id: 'dare-datte',
    phase: 'Early',
    match: [{ text: '誰だって', pos: ['Expression'], requireUnpinned: false }],
    replace: [
      { text: '誰', dictForm: '誰', normalizedForm: '誰', pos: 'Pronoun', reading: '' },
      { text: 'だって', dictForm: 'だって', normalizedForm: 'だって', pos: 'Particle', reading: 'ダッテ' },
    ],
  },
  // Split so a preceding 放って can form 放っておく.
  {
    id: 'okeba-ii',
    phase: 'Early',
    match: [{ text: 'おけばいい', pos: ['Expression'], requireUnpinned: false }],
    replace: [
      { text: 'おけ', dictForm: 'おく', normalizedForm: 'おく', pos: 'Verb', reading: 'オケ' },
      { text: 'ば', dictForm: 'ば', normalizedForm: 'ば', pos: 'Particle', reading: 'バ' },
      { text: 'いい', dictForm: 'いい', normalizedForm: 'いい', pos: 'IAdjective', reading: 'イイ' },
    ],
  },
  // Suffix-tagged 張り before ます/やがる is 張る's stem (結界張ります, 意地ばっかり張りやがって).
  {
    id: 'hari-verb-stem',
    phase: 'Early',
    match: [{ text: '張り', pos: ['Suffix'] }],
    replace: [{ text: '', dictForm: '張る', normalizedForm: '張る', pos: 'Verb' }],
    next: { textStartsWithAnyOf: ['ます', 'まし', 'ませ', 'やが'] },
  },
  // Sudachi marks the 心 of 心ばかり "small token (of thanks)" as a prefix; the noun 心 + ばかり stays split.
  {
    id: 'kokoro-bakari',
    phase: 'Early',
    match: [{ text: '心', pos: ['Prefix'] }, { text: 'ばかり' }],
    replace: [
      {
        text: '心ばかり',
        dictForm: '心ばかり',
        normalizedForm: '心ばかり',
        pos: 'Noun',
        reading: 'ココロバカリ',
        pin: 1793680,
      },
    ],
    next: { textAnyOf: ['が', 'は', 'を', 'も'], negate: true },
  },
  // 結構人 "good-natured person" is almost always the adverb 結構 + 人 (結構人がいる).
  {
    id: 'kekkou-hito',
    phase: 'Early',
    match: [{ text: '結構人', requireUnpinned: false }],
    replace: [
      {
        text: '結構',
        dictForm: '結構',
        normalizedForm: '結構',
        pos: 'Adverb',
        reading: 'ケッコウ',
        pin: 1254760,
        hardPin: true,
      },
      { text: '人', dictForm: '人', normalizedForm: '人', pos: 'Noun', reading: 'ヒト' },
    ],
  },
  // で + noun しょう is a split でしょう.
  {
    id: 'de-shou',
    phase: 'Early',
    match: [
      { text: 'で', pos: ['Conjunction', 'Auxiliary'], requireUnpinned: false },
      { text: 'しょう', pos: ['Noun'], requireUnpinned: false },
    ],
    replace: [
      {
        text: 'でしょう',
        dictForm: 'でしょう',
        normalizedForm: 'です',
        pos: 'Expression',
        posSection: 'None',
        reading: 'デショウ',
      },
    ],
  },
  // Sudachi parses 何でしょう as 何で(noun) + しょう(noun).
  {
    id: 'nande-shou',
    phase: 'Early',
    match: [
      { text: '何で', pos: ['Noun'], requireUnpinned: false },
      { text: 'しょう', pos: ['Noun'], requireUnpinned: false },
    ],
    replace: [
      { text: '何', dictForm: '何', normalizedForm: '何', pos: 'Pronoun', reading: 'ナニ' },
      {
        text: 'でしょう',
        dictForm: 'でしょう',
        normalizedForm: 'です',
        pos: 'Expression',
        posSection: 'None',
        reading: 'デショウ',
      },
    ],
  },
  // Sudachi sometimes tags でしょう Auxiliary.
  {
    id: 'deshou-expression',
    phase: 'Early',
    match: [{ text: 'でしょう', requireUnpinned: false }],
    replace: [{ text: '', pos: 'Expression', posSection: 'None' }],
  },
  // Standalone ぬ misread as the archaic verb 寝(ぬ) is the classical negative auxiliary (norm ず).
  {
    id: 'nu-negative',
    phase: 'Early',
    match: [{ text: 'ぬ', pos: ['Verb'], normalizedFormAnyOf: ['寝る'], requireUnpinned: false }],
    replace: [{ text: '', normalizedForm: 'ず', pos: 'Auxiliary' }],
  },
  // なれ tagged 汝 (archaic "thou") is 成る's 命令形/可能形 stem in modern text.
  {
    id: 'nare-naru',
    phase: 'Early',
    match: [{ text: 'なれ', pos: ['Pronoun'], normalizedFormAnyOf: ['汝'], requireUnpinned: false }],
    replace: [{ text: '', dictForm: 'なる', normalizedForm: 'なる', pos: 'Verb', reading: 'ナレ' }],
  },
  {
    id: 'ima-adverb',
    phase: 'Early',
    match: [{ text: '今', pos: ['Prefix'], requireUnpinned: false }],
    replace: [{ text: '', pos: 'Adverb' }],
  },
  // Modern 空 almost always reads から; うつろ is usually written 虚ろ.
  {
    id: 'kara-empty',
    phase: 'Early',
    match: [{ text: '空', pos: ['NaAdjective'], readingPrefix: 'ウツロ', requireUnpinned: false }],
    replace: [{ text: '', normalizedForm: '空', pos: 'Noun', reading: 'カラ' }],
  },
  // にしろ ("even if"), except after a noun-ish host (大概にしろ is 大概にする's imperative).
  {
    id: 'ni-shiro',
    phase: 'Early',
    match: [
      { text: 'に', requireUnpinned: false },
      { text: 'しろ', requireUnpinned: false },
    ],
    replace: [{ text: 'にしろ', dictForm: 'にしろ', normalizedForm: 'にしろ', pos: 'Expression', reading: 'ニシロ' }],
    prev: { pos: ['Noun', 'NaAdjective', 'Pronoun'], negate: true },
  },
  // とくと after a verb is とく (ておく) + と, not the adverb 篤と.
  {
    id: 'toku-to',
    phase: 'Early',
    match: [{ text: 'とくと', pos: ['Adverb'], normalizedFormAnyOf: ['篤と'], requireUnpinned: false }],
    replace: [
      { text: 'とく', dictForm: 'とく', normalizedForm: 'とく', pos: 'Auxiliary', reading: 'トク' },
      { text: 'と', dictForm: 'と', normalizedForm: 'と', pos: 'Particle', reading: 'ト' },
    ],
    prev: { pos: ['Verb'] },
  },
  // とくよう is とく (ておく) + よう, not 徳用; noun hosts count since Sudachi often tags verb stems as nouns.
  {
    id: 'toku-you',
    phase: 'Early',
    match: [{ text: 'とくよう', normalizedFormAnyOf: ['徳用'], requireUnpinned: false }],
    replace: [
      { text: 'とく', dictForm: 'とく', normalizedForm: 'とく', pos: 'Auxiliary', reading: 'トク' },
      { text: 'よう', dictForm: 'よう', normalizedForm: 'よう', pos: 'Noun', reading: 'ヨウ' },
    ],
    prev: { pos: ['Verb', 'Noun'] },
  },
  {
    id: 'shiyou-toshite',
    phase: 'Early',
    match: [
      { text: 'しよう', pos: ['Noun'], requireUnpinned: false },
      { text: 'として', requireUnpinned: false },
    ],
    replace: [{ text: 'しようとして', dictForm: 'しようとする', pos: 'Verb', reading: 'シヨウトシテ' }],
  },
  // Sudachi sometimes misreads し as a conjunction here.
  {
    id: 'shi-youtoshite',
    phase: 'Early',
    match: [
      { text: 'し', pos: ['Conjunction'], requireUnpinned: false },
      { text: 'ようとして', requireUnpinned: false },
    ],
    replace: [{ text: 'しようとして', dictForm: 'しようとして', pos: 'Verb', reading: 'シヨウトシテ' }],
  },
  // 恋って is 恋 + quotative って, not archaic 恋う.
  {
    id: 'koi-tte',
    phase: 'Early',
    match: [
      { text: '恋っ', pos: ['Verb'], dictFormAnyOf: ['恋う'], requireUnpinned: false },
      { text: 'て', pos: ['Particle'], requireUnpinned: false },
    ],
    replace: [
      { text: '恋', dictForm: '恋', normalizedForm: '恋', pos: 'Noun', reading: 'コイ' },
      { text: 'って', dictForm: 'って', normalizedForm: 'って', pos: 'Particle', reading: 'ッテ' },
    ],
  },
  // 逆 + copula に is almost always the adverb 逆に ("conversely").
  {
    id: 'gyaku-ni',
    phase: 'Early',
    match: [
      { text: '逆', pos: ['Noun'], requireUnpinned: false },
      { text: 'に', dictFormAnyOf: ['だ'], requireUnpinned: false },
    ],
    replace: [{ text: '逆に', dictForm: '逆に', pos: 'Adverb', reading: 'ギャクニ' }],
  },
  {
    id: 'you-noun',
    phase: 'Early',
    match: [{ text: 'よう', requireUnpinned: false }],
    replace: [{ text: '', pos: 'Noun' }],
  },
  {
    id: 'juugo-numeral',
    phase: 'Early',
    match: [{ text: '十五', requireUnpinned: false }],
    replace: [{ text: '', pos: 'Numeral' }],
  },
  {
    id: 'ore-pronoun',
    phase: 'Early',
    match: [{ text: 'オレ', requireUnpinned: false }],
    replace: [{ text: '', pos: 'Pronoun' }],
  },
  // 飛んだ after a case particle is 飛ぶ past (意識が飛んだ); the 連体詞 とんだ only opens a noun phrase.
  {
    id: 'tonda-tobu',
    phase: 'Cleanup',
    match: [{ text: '飛んだ' }],
    replace: [
      { text: '', dictForm: '飛ぶ', normalizedForm: '飛ぶ', pos: 'Verb', pin: 1429700, recoverConjugations: true },
    ],
    prev: { textAnyOf: ['が', 'は', 'も', 'に', 'を', 'で', 'へ', 'から', 'まで'] },
  },
  // 置き after a case particle is 置く's 連用形 (横に置き、); the interval suffix おき follows a quantity (三日置き).
  {
    id: 'oki-oku',
    phase: 'Cleanup',
    match: [{ text: '置き' }],
    replace: [
      { text: '', dictForm: '置く', normalizedForm: '置く', pos: 'Verb', pin: 1421850, recoverConjugations: true },
    ],
    prev: { textAnyOf: ['に', 'を', 'へ'] },
  },
  // Sudachi shreds 強がって into 強/がっ/て; conjugated forms only, since bare 強がり is the noun.
  {
    id: 'tsuyogaru',
    phase: 'Cleanup',
    match: [{ textAnyOf: ['強がって', '強がった'] }],
    replace: [
      { text: '', dictForm: '強がる', normalizedForm: '強がる', pos: 'Verb', pin: 1928800, recoverConjugations: true },
    ],
  },
  // 強がり before a particle is the noun "bluff"; the がる chain would resolve it to 強い (ながら keeps the verb).
  {
    id: 'tsuyogari-noun',
    phase: 'Cleanup',
    match: [{ text: '強がり' }],
    replace: [{ text: '', dictForm: '強がり', normalizedForm: '強がり', pos: 'Noun', pin: 1236110 }],
    next: { textAnyOf: ['を', 'が', 'は', 'の', 'で'] },
  },
  // 放ってお* is the expression 放っておく, not bare 放る.
  {
    id: 'hotteoku',
    phase: 'Cleanup',
    match: [{ textStartsWith: '放ってお' }],
    replace: [
      { text: '', dictForm: '放っておく', normalizedForm: '放っておく', pin: 1907980, recoverConjugations: true },
    ],
  },
  // まさに never takes a topic particle, so 将に right before は is the noun 将 + に (将には必要な資質).
  {
    id: 'sho-ni',
    phase: 'Cleanup',
    match: [{ text: '将に', pos: ['Adverb'] }],
    replace: [
      { text: '将', dictForm: '将', normalizedForm: '将', pos: 'Noun', reading: 'ショウ' },
      {
        text: 'に',
        dictForm: 'に',
        normalizedForm: 'に',
        pos: 'Particle',
        posSection: 'CaseMarkingParticle',
        reading: 'ニ',
      },
    ],
    next: { textAnyOf: ['は'], pos: ['Particle'] },
  },
  // 表 before へ/に with no noun host is おもて (表へ出る), not the chart ひょう (メニュー表).
  {
    id: 'omote',
    phase: 'Reading',
    match: [{ text: '表', readingPrefix: 'ヒョウ' }],
    replace: [{ text: '', reading: 'オモテ' }],
    prev: { pos: ['Noun'], negate: true },
    next: { textAnyOf: ['へ', 'に'] },
  },
  // 一日 is ついたち only as a date after a month (X月一日).
  {
    id: 'ichinichi',
    phase: 'Reading',
    match: [{ textAnyOf: ['一日', '１日', '1日'], readingPrefix: 'ツイタチ' }],
    replace: [{ text: '', reading: 'イチニチ' }],
    prev: { textEndsWithAnyOf: ['月'], negate: true },
  },
  // Compound-only readings: 禍 カ (コロナ禍), 私 シ (私立), 次 ジ (次回), 隙 ヒマ (obsolete).
  {
    id: 'wazawai',
    phase: 'Reading',
    match: [{ text: '禍', readingPrefix: 'カ' }],
    replace: [{ text: '', reading: 'ワザワイ' }],
  },
  {
    id: 'watashi',
    phase: 'Reading',
    match: [{ text: '私', readingPrefix: 'シ' }],
    replace: [{ text: '', pos: 'Pronoun', reading: 'ワタシ' }],
  },
  {
    id: 'tsugi',
    phase: 'Reading',
    match: [{ text: '次', pos: ['Prefix'], readingPrefix: 'ジ' }],
    replace: [{ text: '', pos: 'CommonNoun', reading: 'ツギ' }],
  },
  {
    id: 'suki',
    phase: 'Reading',
    match: [{ text: '隙', readingPrefix: 'ヒマ' }],
    replace: [{ text: '', reading: 'スキ' }],
  },
  // Rare name/archaic readings: 全機 まさき, 何時 なんどき, 大仰 おおのき.
  {
    id: 'zenki',
    phase: 'Reading',
    match: [{ text: '全機', readingPrefix: 'マサキ' }],
    replace: [{ text: '', reading: 'ゼンキ' }],
  },
  {
    id: 'nanji',
    phase: 'Reading',
    match: [{ text: '何時', readingPrefix: 'ナンドキ' }],
    replace: [{ text: '', reading: 'ナンジ' }],
  },
  {
    id: 'oogyou',
    phase: 'Reading',
    match: [{ text: '大仰', readingPrefix: 'オオノキ' }],
    replace: [{ text: '', pos: 'NaAdjective', reading: 'オオギョウ' }],
  },
  // Suffix 長 チョウ is the noun "chief" (1429740); JMDict's suffix 長 is なが "long".
  {
    id: 'chou-chief',
    phase: 'Reading',
    match: [{ text: '長', pos: ['Suffix'], readingPrefix: 'チョウ' }],
    replace: [{ text: '', pos: 'Noun' }],
  },
  // 通り right after a noun is the suffix どおり "as per" (予定通り), not the street noun.
  {
    id: 'doori',
    phase: 'Reading',
    match: [{ text: '通り', readingPrefix: 'トオリ' }],
    replace: [{ text: '', pin: 1432930 }],
    prev: { pos: ['Noun', 'CommonNoun'] },
  },
  // 縁 after の with a rimmed object is ふち "rim" (浴槽の縁), not えん "fate".
  {
    id: 'fuchi',
    phase: 'Reading',
    match: [{ text: '縁', readingPrefix: 'エン' }],
    replace: [{ text: '', reading: 'フチ' }],
    prev: { textAnyOf: ['の'] },
    window: {
      from: -2,
      to: -2,
      textAnyOf: [
        '浴槽',
        '風呂',
        'プール',
        '池',
        '井戸',
        '窓',
        'テーブル',
        '机',
        '帽子',
        'コップ',
        'グラス',
        '崖',
        '屋根',
        'ベッド',
      ],
    },
  },
  // 生 after 次の/前の… is せい "life" (次の生); なま lists bare 生 with priority, so the reading alone loses.
  {
    id: 'sei-life',
    phase: 'Reading',
    match: [{ text: '生', readingPrefix: 'ナマ' }],
    replace: [{ text: '', reading: 'セイ', pin: 2088240 }],
    prev: { textAnyOf: ['の'] },
    window: { from: -2, to: -2, textAnyOf: ['次', '前', '今', '来', 'この', '別'] },
  },
  // 糞 is くそ unless it reads as literal droppings: after の (犬の糞) or before と (糞と尿).
  {
    id: 'kuso',
    phase: 'Reading',
    match: [{ text: '糞', readingPrefix: 'フン' }],
    replace: [{ text: '', reading: 'クソ' }],
    prev: { textAnyOf: ['の'], negate: true },
    next: { textAnyOf: ['と'], negate: true },
  },
  // Sudachi's あの tags are unreliable: 感動詞 is treated as prenominal, 連体詞 as the filler when no nominal follows.
  {
    id: 'ano-prenoun',
    phase: 'Reading',
    match: [{ text: 'あの', pos: ['Interjection'] }],
    replace: [{ text: '', pos: 'PrenounAdjectival' }],
  },
  {
    id: 'ano-filler',
    phase: 'Reading',
    match: [{ text: 'あの', pos: ['PrenounAdjectival'] }],
    replace: [{ text: '', pos: 'Interjection' }],
    next: { pos: ['Noun', 'Pronoun', 'NaAdjective', 'Counter', 'Numeral'], negate: true },
  },
];
