/*
 * Curated word lists of the combine stages, copied as data (Apache-2.0; see ../../NOTICE):
 *   - SPECIAL_CASES_2/3, AUXILIARY_VERBS, TE_FORM_SUBSIDIARY_VERBS, TE_FORM_AUX_CHAIN_VERBS, AUXILIARY_VERB_STEMS,
 *     COMPOUND_VERB_SPLIT_SUFFIXES, VERB_INDICATING_AUXILIARIES, GODAN_VERB_ENDINGS, GODAN_VOLITIONAL_O_KANA:
 *     the shared rule data
 *   - PREFIX_COMBINE_EXCLUSIONS, COMPLETION_AUX_VERBS: the combine stages
 *   - EXPRESSION_EXCLUSIONS, TWO_TOKEN_EXPRESSION_WHITELIST, TWO_TOKEN_NOUN_VERB_IDIOMS, PARTICLE_EXPRESSION_OPENERS,
 *     LEXICALIZED_ADVERB_PAIRS, NOUN_COMPOUND_EXCLUSIONS: sentence preprocessing
 *   - HONORIFIC_SUFFIXES: the grammar transition rules
 * Comments are the upstream ones. Upstream keeps SPECIAL_CASES in hash sets; the order here is the file order, which
 * is also the order CombineFinal tries them in.
 */
import type { WordClass } from '../types';

export const AUXILIARY_VERBS: ReadonlySet<string> = new Set([
  '続ける',
  '始める',
  '終わる',
  '終える',
  '出す',
  'かける',
  'いたす',
  'いただく',
  '頂く',
  'する',
  '回る',
]);

export const TE_FORM_SUBSIDIARY_VERBS: ReadonlySet<string> = new Set([
  'あげる',
  '上げる',
  'くれる',
  '呉れる',
  'もらう',
  '貰う',
  'やる',
  // 差し上げる is absent: the honorific benefactive is a content verb kept as its own token (判じて + 差し上げる).
  'くださる',
  '下さる',
  'おく',
  '置く',
  'みる',
  '見る',
]);

// Aux for verb + て/で + aux merges; each needs deconjugator rules so the merged token keeps its conjugation info.
export const TE_FORM_AUX_CHAIN_VERBS: ReadonlySet<string> = new Set([
  'いる',
  '居る',
  'ある',
  '有る',
  'おく',
  '置く',
  'しまう',
  '仕舞う',
  'いく',
  '行く',
  'くる',
  '来る',
  'みる',
  '見る',
]);

/** A deconjugation only proves a subsidiary verb when it ends on that verb's own class; おくれ reaches おく via a
 * dead-end stem. */
export const SUBSIDIARY_VERB_CLASSES: ReadonlyMap<string, readonly string[]> = new Map([
  ['あげる', ['v1']],
  ['上げる', ['v1']],
  ['くれる', ['v1', 'v1-s']],
  ['呉れる', ['v1', 'v1-s']],
  ['もらう', ['v5u']],
  ['貰う', ['v5u']],
  ['やる', ['v5r']],
  ['くださる', ['v5aru']],
  ['下さる', ['v5aru']],
  ['おく', ['v5k']],
  ['置く', ['v5k']],
  ['みる', ['v1']],
  ['見る', ['v1']],
  ['いる', ['v1']],
  ['居る', ['v1']],
  ['ある', ['v5r-i', 'v5r']],
  ['有る', ['v5r-i', 'v5r']],
  ['しまう', ['v5u']],
  ['仕舞う', ['v5u']],
  ['いく', ['v5k-s', 'v5k']],
  ['行く', ['v5k-s', 'v5k']],
  ['くる', ['vk']],
  ['来る', ['vk']],
]);

/** `EndsOnSubsidiaryVerbClass`. */
export function endsOnSubsidiaryVerbClass(form: { text: string; tags: readonly string[] }): boolean {
  const last = form.tags.at(-1);
  return last !== undefined && (SUBSIDIARY_VERB_CLASSES.get(form.text)?.includes(last) ?? false);
}

export const PREFIX_COMBINE_EXCLUSIONS: ReadonlySet<string> = new Set(['おつもり', 'おいま', 'おにく']);

// Merged only when JMDict attests the compound (逃げ|切った → 逃げ切る), so 紙を切った is untouched.
export const COMPLETION_AUX_VERBS: ReadonlySet<string> = new Set(['切る']);

export const EXPRESSION_EXCLUSIONS: ReadonlySet<string> = new Set([
  'このように',
  'そのように',
  'あのように',
  'どのように',
  'のように',
  'この様に',
  'その様に',
  'あの様に',
  'どの様に',
  'の様に',
  '何だと',
  'なんだと',
  // Their JMDict interjection/discourse senses rarely apply.
  'それが',
  'それは',
  'これが',
  'これは',
  'あれが',
  'あれは',
  // The temper idiom is rare; fiction means literal insect-killing (小の虫を殺す).
  '虫を殺す',
  'むしをころす',
  '虫を殺し',
  'むしをころし',
  // こと is almost always the nominalizer (関与することを好まない).
  'ことを好む',
  '事を好む',
  'ことをこのむ',
  // The idiom is rare; prose means "know that man" (この男を知っているか).
  '男を知る',
  '男を知って',
  '男を知った',
  '男を知ってる',
  '男を知っている',
  '男を知らない',
  '男を知り',
]);

/** Curated: JMDict also lists compositional pairs (のです, それを, 外に) that must stay split. */
export const TWO_TOKEN_EXPRESSION_WHITELIST: ReadonlySet<string> = new Set([
  'どちらも',
  'どっちも',
  'いつでも',
  '何時でも',
  '一人で',
  'ひとりで',
  '独りで',
  'ものか',
  'もんか',
  'たまるか',
  '堪るか',
  'それとも',
  '至るまで',
  'いたるまで',
  '史上初',
  '綺麗さっぱり',
  'きれいさっぱり',
  'とはいえ',
  'とは言え',
  'あいよ',
  'いいや',
]);

/** Idioms with elided を; curated because compositional 〜を〜 entries (服を着る) must stay split. Keyed by the noun's
 * surface and the verb's dictionary form. */
export const TWO_TOKEN_NOUN_VERB_IDIOMS: ReadonlyMap<string, string> = new Map([
  ['カマ\u0000かける', 'カマをかける'],
  ['かま\u0000かける', 'かまをかける'],
  ['鎌\u0000かける', '鎌をかける'],
  ['鎌\u0000掛ける', '鎌を掛ける'],
]);

// Curated: most particles over-merge (とは, には); しか only ever heads しかない/しかねぇ.
export const PARTICLE_EXPRESSION_OPENERS: ReadonlySet<string> = new Set(['しか']);

// Curated, not entry-derived: many X+に pairs are genuine case particles (それに気づいた, 外に出る).
export const LEXICALIZED_ADVERB_PAIRS: ReadonlySet<string> = new Set([
  'フルに',
  '無性に',
  '意地でも',
  '絶対に',
  '徐々に',
]);

export const NOUN_COMPOUND_EXCLUSIONS: ReadonlySet<string> = new Set(['おつもり', 'ものたち', '雪の下']);

/** Case and binding particles a special-case or repair rule stops at. */
export const CASE_PARTICLES: ReadonlySet<string> = new Set([
  'に',
  'を',
  'が',
  'へ',
  'で',
  'と',
  'は',
  'も',
  'か',
  'から',
  'より',
  'まで',
  'の',
]);

export const HONORIFIC_SUFFIXES: ReadonlySet<string> = new Set(['さん', 'くん', 'ちゃん', '様', '殿', '氏']);

export const SPECIAL_CASES_3: ReadonlyArray<readonly [string, string, string, WordClass]> = [
  ['な', 'の', 'で', 'Expression'],
  ['それ', 'で', 'も', 'Conjunction'],
  ['なく', 'なっ', 'た', 'Verb'],
  ['さ', 'せ', 'て', 'Verb'],
  ['ほう', 'が', 'いい', 'Expression'],
  ['に', 'とっ', 'て', 'Expression'],
  ['に', 'つい', 'て', 'Expression'],
  ['か', 'の', 'ように', 'Expression'],
  ['それ', 'よ', 'か', 'Expression'],
  ['に', '劣ら', 'ず', 'Expression'],
  ['しょう', 'が', 'ねぇ', 'IAdjective'],
  ['しょう', 'が', 'ねー', 'IAdjective'],
  ['いけす', 'か', 'ねぇ', 'IAdjective'],
  ['いけす', 'か', 'ねー', 'IAdjective'],
  ['たら', 'し', 'たら', 'Verb'],
  ['どう', 'あって', 'も', 'Expression'],
  ['じゃ', 'ない', 'か', 'Expression'],
];

export const SPECIAL_CASES_2: ReadonlyArray<readonly [string, string, WordClass]> = [
  ['じゃ', 'ない', 'Expression'],
  ['とんでも', 'なく', 'IAdjective'], // adverbial とんでもない; Sudachi splits off the adverb とんでも
  ['とんでも', 'なかっ', 'IAdjective'],
  ['本当', 'に', 'Adverb'], // 本当に 1611580; Sudachi sometimes splits it
  ['ため', 'に', 'Conjunction'], // ために 1157150
  ['だ', 'ろう', 'Auxiliary'], // Sudachi shreds そりゃそうだろう into …だ|ろう(蝋)
  ['す', 'べき', 'Expression'], // classical す + べき → すべき 1006200 (とすべき戦術)
  ['なさ', 'すぎる', 'Verb'], // なさ[ない]+すぎる → ない via さすぎる excess deconj
  ['なさ', 'すぎ', 'Verb'],
  ['近', 'すぎ', 'Verb'], // adjective stem + すぎ → 近い via excess deconj
  ['近', 'すぎる', 'Verb'],
  ['だ', 'けど', 'Conjunction'],
  ['だ', 'が', 'Conjunction'],
  ['で', 'さえ', 'Expression'],
  ['で', 'すら', 'Expression'],
  ['と', 'いう', 'Expression'],
  ['と', 'して', 'Expression'],
  ['と', 'か', 'Conjunction'],
  ['だ', 'から', 'Conjunction'],
  ['から', 'して', 'Expression'],
  ['これ', 'まで', 'Expression'],
  ['それ', 'も', 'Conjunction'],
  ['それ', 'だけ', 'Noun'],
  ['くせ', 'に', 'Conjunction'],
  ['なの', 'に', 'Conjunction'],
  ['なの', 'で', 'Conjunction'],
  ['の', 'で', 'Particle'],
  ['誰', 'も', 'Expression'],
  ['誰', 'か', 'Expression'],
  ['すぐ', 'に', 'Adverb'],
  ['たしか', 'に', 'Adverb'],
  ['確か', 'に', 'Adverb'], // 確かに 1205770
  ['直', 'に', 'Adverb'], // 直に 1430690 (じかに); the bare 直 otherwise reads ちょく
  ['ゆえ', 'に', 'Conjunction'], // 故に 1267130
  ['故', 'に', 'Conjunction'],
  ['とう', 'に', 'Adverb'], // 疾うに 1633370; the bare とう otherwise strands on 塔
  ['そ', 'も', 'Conjunction'], // そも 2836401; Sudachi emits archaic pronoun そ + も
  ['どう', 'こう', 'Adverb'], // どうこう 2670710
  ['何で', 'も', 'Adverb'], // 何でも 1611030
  ['ただ', '今', 'Adverb'],
  ['ところ', 'で', 'Conjunction'],
  ['度', 'に', 'Expression'],
  ['なん', 'か', 'Particle'],
  ['なん', 'て', 'Particle'],
  ['だっ', 'た', 'Expression'],
  ['だっ', 'たら', 'Conjunction'],
  ['よう', 'に', 'Expression'],
  ['ん', 'です', 'Expression'],
  ['ん', 'だ', 'Expression'],
  ['です', 'か', 'Expression'],
  ['し', 'て', 'Verb'],
  ['し', 'ちゃ', 'Verb'],
  ['何', 'の', 'Pronoun'],
  ['カッコ', 'いい', 'IAdjective'],
  ['ドキッ', 'と', 'Adverb'],
  ['ドキっ', 'と', 'Adverb'],
  ['チラッ', 'と', 'Adverb'],
  ['チラっ', 'と', 'Adverb'],
  ['ニッ', 'と', 'Adverb'],
  ['にっ', 'と', 'Adverb'],
  ['か', 'な', 'Particle'],
  ['わ', 'い', 'Particle'],
  ['だ', 'い', 'Particle'], // familiar question marker だい (思っただけだい！)
  ['よう', 'です', 'Expression'],
  ['何も', 'かも', 'Expression'],
  ['何と', 'も', 'Adverb'],
  ['何と', 'なく', 'Adverb'],
  ['中途', '半端', 'Noun'],
  ['常', 'に', 'Adverb'],
  ['なくて', 'も', 'Expression'],
  ['なんに', 'も', 'Adverb'],
  ['なし', 'で', 'Expression'],
  ['なん', 'で', 'Adverb'],
  ['に', 'とって', 'Expression'],
  ['に', 'ついて', 'Expression'],
  ['だ', 'って', 'Conjunction'],
  ['どこ', 'か', 'Pronoun'],
  ['急', 'に', 'Adverb'],
  ['と', 'ても', 'Adverb'],
  ['で', 'も', 'Conjunction'],
  ['として', 'も', 'Expression'],
  ['多', 'き', 'IAdjective'],
  ['ぶっ', 'た', 'Suffix'],
  ['に', 'よる', 'Expression'],
  ['に', 'より', 'Expression'],
  ['とっく', 'に', 'Adverb'],
  ['おい', 'で', 'Expression'],
  ['どうして', 'も', 'Adverb'],
  ['か', 'も', 'Particle'],
  ['かも', 'しれない', 'Expression'],
  ['何に', 'も', 'Adverb'],
  ['ま', 'だ', 'Adverb'],
  ['いっしょ', 'に', 'Adverb'],
  ['その', '時', 'Expression'],
  ['そう', 'いえば', 'Expression'],
  ['出来', 'なさそう', 'Verb'],
  ['それ', '相応', 'NaAdjective'],
  ['当', 'たった', 'Verb'],
  ['こそ', 'あれ', 'Conjunction'],
  ['こう', 'やって', 'Conjunction'],
  ['そう', 'やって', 'Conjunction'],
  ['って', 'ば', 'Particle'],
  ['かく', 'も', 'NominalAdjective'],
  ['よう', 'さん', 'NominalAdjective'],
  ['と', 'する', 'Expression'],
  ['しきり', 'と', 'Adverb'],
  ['しきり', 'に', 'Adverb'],
  ['ない', 'ない', 'IAdjective'],
  ['ビクと', 'も', 'Adverb'],
  ['びくと', 'も', 'Adverb'],
  ['要する', 'に', 'Expression'],
  ['この', '前', 'Adverb'],
  ['ならび', 'に', 'Conjunction'],
  ['残虐', '非道', 'NaAdjective'],
  ['一緒', 'に', 'Adverb'],
  ['別', 'に', 'Adverb'],
  ['先', 'に', 'Adverb'],
  ['仮', 'に', 'Adverb'],
  ['滅多', 'に', 'Adverb'],
  ['何', 'で', 'Adverb'],
  ['何', 'か', 'Pronoun'],
  ['何', 'も', 'Pronoun'],
  ['実', 'は', 'Expression'],
  ['後', 'で', 'Expression'],
  ['元', 'は', 'Expression'],
  ['当', 'の', 'NominalAdjective'],
  ['真', 'の', 'NominalAdjective'],
  ['大', 'の', 'NominalAdjective'],
  ['例', 'の', 'Adverb'],
  ['か', 'い', 'Particle'],
  ['露', 'にして', 'Expression'],
  ['なれ', 'ど', 'Conjunction'],
  ['ここ', 'ぞ', 'Expression'],
  ['並び', 'に', 'Conjunction'],
  ['真っ先', 'に', 'Adverb'],
  ['です', 'から', 'Conjunction'],
  ['つ', 'か', 'Conjunction'],
  ['それ', 'じゃ', 'Conjunction'],
  ['を', '以って', 'Expression'],
  ['に', 'つれ', 'Conjunction'],
  ['いつまで', 'も', 'Adverb'],
  ['だから', 'こそ', 'Expression'],
  ['では', 'あるまい', 'Expression'],
  ['に', '於いて', 'Expression'],
  ['に', 'せよ', 'Expression'],
  ['どっ', 'か', 'Adverb'],
  ['どっ', 'から', 'Adverb'],
  ['なん', 'ちゃってぇ', 'Expression'],
  ['ばかり', 'に', 'Expression'], // ばかりに 1010250
  ['それ', 'では', 'Conjunction'], // それでは 1406050
  ['に', '対して', 'Expression'], // に対して 1009800
  ['いい', 'ぞ', 'Interjection'],
  ['に', 'よって', 'Expression'],
];

/** SPECIAL_CASES_2 indexed by first token, in file order: what `CombineFinal` and the special-case stage look up. */
export const SPECIAL_2: ReadonlyMap<string, ReadonlyArray<{ second: string; cls: WordClass }>> = (() => {
  const index = new Map<string, Array<{ second: string; cls: WordClass }>>();
  for (const [first, second, cls] of SPECIAL_CASES_2) {
    const list = index.get(first) ?? [];
    list.push({ second, cls });
    index.set(first, list);
  }
  return index;
})();

/** SPECIAL_CASES_3 indexed by first token, in file order. */
export const SPECIAL_3: ReadonlyMap<string, ReadonlyArray<{ second: string; third: string; cls: WordClass }>> = (() => {
  const index = new Map<string, Array<{ second: string; third: string; cls: WordClass }>>();
  for (const [first, second, third, cls] of SPECIAL_CASES_3) {
    const list = index.get(first) ?? [];
    list.push({ second, third, cls });
    index.set(first, list);
  }
  return index;
})();

/** `AuxiliaryVerbStems`: the stem a split-off auxiliary verb's surface must start with. */
export const AUXILIARY_VERB_STEMS: ReadonlyMap<string, string> = new Map([
  ['続ける', '続け'],
  ['始める', '始め'],
  ['終わる', '終わ'],
  ['終える', '終え'],
  ['出す', '出'],
  ['かける', 'かけ'],
  ['回る', '回'],
  ['合う', '合'],
  ['放つ', '放'],
]);

/** `CompoundVerbSplitSuffixes`. */
export const COMPOUND_VERB_SPLIT_SUFFIXES: readonly string[] = [...AUXILIARY_VERBS, '合う', '放つ'];

/** `VerbIndicatingAuxiliaries`. */
export const VERB_INDICATING_AUXILIARIES: ReadonlySet<string> = new Set(['られる', 'れる', 'せる', 'させる']);

/** `GodanVerbEndings`. */
export const GODAN_VERB_ENDINGS: readonly string[] = ['る', 'す', 'つ', 'く', 'ぐ', 'む', 'ぶ', 'ぬ', 'う'];

/** `GodanVolitionalOKana`. */
export const GODAN_VOLITIONAL_O_KANA: ReadonlySet<string> = new Set([
  'お',
  'こ',
  'ご',
  'そ',
  'ぞ',
  'と',
  'ど',
  'の',
  'ほ',
  'ぼ',
  'ぽ',
  'も',
  'よ',
  'ろ',
]);
