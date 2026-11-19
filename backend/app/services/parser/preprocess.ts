import { analyse, type Morpheme, type SplitMode } from './sudachi';

/**
 * Upstream's `PreprocessText`: the text rewrites made before Sudachi sees a sentence. Most of them only force a word
 * boundary (upstream inserts a stop token: は|やめ, 日|間, 不|適応); some delete or replace characters (the emphatic
 * っ of だめっ, stretched vowels as in わかるう or 行けぇーー, ですぅ → です).
 *
 * Unlike upstream we must keep the reader's text: every token's surface is a span of the original sentence. So the
 * text is rewritten as a list of units, each a normalised character with the original text it stands for; a forced
 * boundary is a unit with no original text, and a deleted character survives as a unit with no normalised text.
 * Sudachi reads the normalised text chunk by chunk (a forced boundary ends a chunk), and each morpheme is mapped back
 * to the original span its units cover. Deleted characters join the morpheme before them (だめっ reads as だめ), except
 * deleted punctuation, which stays a symbol of its own.
 *
 * Left out, because they would drop or rewrite reader text rather than repair a cut: the removal of non-Japanese
 * characters and of Chinese subtitle lines, full-width digits, and the visual-novel ruby markup.
 */

const STOP = '';

interface Unit {
  /** Normalised text: one code point, '' for a deleted character, or STOP / an inserted blank for a boundary. */
  n: string;
  /** The original text this unit stands for ('' when the unit was inserted). */
  o: string;
}

type Replacement = string | ((match: RegExpExecArray) => string);

/** Text as units, rewritten by regular expressions over its normalised form. */
class UnitText {
  units: Unit[];

  constructor(text: string) {
    this.units = [...text].map((char) => ({ n: char, o: char }));
  }

  get text(): string {
    return this.units.map((unit) => unit.n).join('');
  }

  /** Replaces every match of `pattern` (a global regex) in the normalised text. */
  replace(pattern: RegExp, replacement: Replacement): void {
    // Map normalised code-point positions to unit indexes; units with n === '' sit between positions.
    const visible: number[] = [];
    this.units.forEach((unit, index) => {
      if (unit.n !== '') visible.push(index);
    });
    const text = visible.map((index) => (this.units[index] as Unit).n).join('');
    const codeUnitToPoint: number[] = [];
    let point = 0;
    for (const char of text) {
      for (let k = 0; k < char.length; k++) codeUnitToPoint.push(point);
      point++;
    }
    codeUnitToPoint.push(point);

    const matches: Array<{ start: number; end: number; out: string }> = [];
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const out =
        typeof replacement === 'function'
          ? replacement(m)
          : replacement.replace(/\$(\d)/g, (_, group: string) => m?.[Number(group)] ?? '');
      matches.push({
        start: codeUnitToPoint[m.index] as number,
        end: codeUnitToPoint[m.index + m[0].length] as number,
        out,
      });
      if (m[0].length === 0) pattern.lastIndex++;
    }
    if (matches.length === 0) return;

    const result: Unit[] = [];
    let unitCursor = 0;
    for (const { start, end, out } of matches) {
      // Units before the match (and deleted units inside it) are kept or re-aligned below.
      const firstUnit = start < visible.length ? (visible[start] as number) : this.units.length;
      const lastUnit = end < visible.length ? (visible[end] as number) : this.units.length;
      for (; unitCursor < firstUnit; unitCursor++) result.push(this.units[unitCursor] as Unit);
      result.push(...align(this.units.slice(firstUnit, lastUnit), out));
      unitCursor = lastUnit;
    }
    for (; unitCursor < this.units.length; unitCursor++) result.push(this.units[unitCursor] as Unit);
    this.units = result;
  }

  /** `string.Replace(from, to)` for a literal. */
  replaceAll(from: string, to: string): void {
    this.replace(new RegExp(escapeRegExp(from), 'gu'), () => to);
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Aligns a replacement with the units it replaces: replacement characters equal to the next original ones keep them;
 * an original skipped over is kept as a deleted unit; a replacement character with no original is inserted.
 */
function align(originals: Unit[], out: string): Unit[] {
  const result: Unit[] = [];
  const outChars = [...out];
  let k = 0;
  for (const char of outChars) {
    // Skip deleted units already in the span.
    while (k < originals.length && (originals[k] as Unit).n === '') result.push(originals[k++] as Unit);
    let found = -1;
    for (let look = k; look < originals.length; look++) {
      if ((originals[look] as Unit).n === char) {
        found = look;
        break;
      }
    }
    if (found >= 0) {
      for (; k < found; k++) result.push({ n: '', o: (originals[k] as Unit).o });
      result.push(originals[k++] as Unit);
    } else {
      result.push({ n: char, o: '' });
    }
  }
  for (; k < originals.length; k++) result.push({ n: '', o: (originals[k] as Unit).o });
  // A pure replacement (せぇ → さい) keeps its original text on the first new unit rather than after the new text.
  const firstNew = result.findIndex((unit) => unit.o === '' && unit.n !== '' && unit.n !== STOP && !/\s/u.test(unit.n));
  if (firstNew >= 0 && result.slice(firstNew).every((unit) => unit.o === '' || unit.n === '')) {
    const moved = result.filter((unit, index) => index > firstNew && unit.n === '').map((unit) => unit.o);
    if (moved.length > 0) {
      const kept = result.filter((unit, index) => !(index > firstNew && unit.n === ''));
      const target = kept.indexOf(result[firstNew] as Unit);
      kept[target] = { ...(kept[target] as Unit), o: moved.join('') };
      return kept;
    }
  }
  return result;
}

const HB = '\\u3040-\\u309F'; // hiragana block (.NET IsHiragana)
const KB = '\\u30A0-\\u30FF'; // katakana block (.NET IsKatakana)
const CJK = '\\u4E00-\\u9FFF'; // .NET IsCJKUnifiedIdeographs
const CONSONANT_KANA =
  'かきくけこがぎぐげござじずぜぞさしすせそたちつてとだぢづでどぱぴぷぺぽばびぶべぼカキクケコガギグゲゴザジズゼゾサシスセソタチツテトダヂヅデドパピプペポバビブベボ';
const re = (source: string) => new RegExp(source, 'gu');

const TILDE_AFTER_KANA = re(`(?<=[${HB}${KB}])[～〜]+`);
const MULTIPLE_LONG_VOWEL = re('ー{2,}');
const EMPH_LONG_VOWEL_KANJI_HIRAGANA = re(`(?<=[一-龯])ー(?=[぀-ゟ])`);
const EMPH_LONG_VOWEL_SOKUON = re(`(?<=[぀-ゟ])ー+[っッ]+(?!と)`);
const SMALL_VOWEL_BEFORE_SOKUON_TO = re(`([ぁ-ゖァ-ヴ])([ぁぃぅぇぉァィゥェォ]+)(?=[っッ]と)`);
const SMALL_VOWEL_BEFORE_FINAL_LONG_VOWEL = re(`(?<=[ぁ-ゖ])[ぁぃぅぇぉ](?=ー+(?:[\\s！？!?]|$))`);
const ELONGATED_ARU = re('(が|なら)あら[ァぁ]');
const SCRIPT_CROSSING_SMALL_VOWEL = re(`(?<=[ぁ-ゖ])([ァィゥェォ]+[っッ]?)|(?<=[ァ-ヴ])([ぁぃぅぇぉ]+[っッ]?)`);
const SAME_SCRIPT_SMALL_VOWEL_RUN = re(`(?<=[ぁ-ゖ])[ぁぃぅぇぉ]{2,}`);
const SHOUTED_IMPERATIVE_SMALL_VOWEL = re(`(?<=[ぁ-ゖ])[ぁぃぅぇぉ]([っッ]+)(?=\\s|$)`);
const LONG_VOWEL_BEFORE_FINAL_I = re(`(?<=[ぁ-ゖ][ぁ-ゖ])(?<!な)(?<!ー[ぁ-ゖ]{1,8})ー+(?=い(?:[\\s！？!?」』）]|$))`);
const STUTTER_FRAGMENT = re(`(?<![ぁ-んァ-ヶー一-龯々])([ぁ-んァ-ヶ])[っッ]?[、,，]\\s*(?=\\1)`);
const STUTTERING_RUN = re(`([ぁ-んァ-ヶ])(?:[\\sっッ]*\\1){3,}`);
const STUTTERING_DIGRAPH_RUN = re(`([ぁ-んァ-ヶ][ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ])(?:[\\sっッ]*\\1){2,}`);
const HAYAME_WITHOUT_WO = re('(?<!を)はやめ');
const HAYARU_WITHOUT_GA = re('(?<!が)はやる');
const TOORI_QUOTATIVE = re('(?<=通り|どおり)(?=って)');
const VOWEL_TAIL_KATAKANA_BOUNDARY = re(`(?<=[ぁ-ゖ][あぁ])(?=[ァ-ヴ])`);
const MOSHI_KATAKANA_BOUNDARY = re('もし(?=[ァ-ヴ])');
const CASE_PARTICLE_TTE = re('(?<=[をへ])(?=って)');
const DEMONSTRATIVE_PRONOUN_TTE = re('([こそあど]いつ|ここ|そこ|あそこ|どこ)って');
const PRONOUN_RA_TTE = re(
  '(?<=(?:キミ|きみ|君|僕|ぼく|俺|おれ|お前|おまえ|あいつ|こいつ|そいつ|あなた|彼|彼女|私|わたし|あたし|うち)ら)(?=って)',
);
const KEIKIZUKE_YO = re('景気づけよ(?!う)');
const DE_NAI_COMPOUND = re('(外|家)出(ない|なかった|なく)');
const YATSURE = re('(?<!あ)やつれ');
const ELLIPSIS_BEFORE_EMPHATIC_TSU = re(`(?<=[${HB}${CJK}])…+(?=[っッ](?![${CONSONANT_KANA}${CJK}]))`);
const EMPHATIC_TSU = re(`(?<=.[${HB}${CJK}])(?<!うわ)([っッ])(?![${CONSONANT_KANA}${CJK}])`);
const BAN_COMPOUND_TSU = re(`(?<=[${CJK}])番っ`);
const HONTO_KATAKANA = re('ホント(バカ|ダメ|マジ|クソ|アホ)');
const KATAKANA_INTERJECTION_TSU = re(`([ァ-ヴ]ンッ)(?=[ァ-ヴぁ-ゔ${CJK}])`);
const COLLOQUIAL_SSHO = re('(?<!い)っしょ[ーう]?(?=\\s|$)');
const I_ADJ_SSHO = re('(?<=[ぁ-ゖ]い)(?<!とい)っしょ[ーう]?(?=\\s|$)');
const I_ADJ_SSU = re('(?<=[ぁ-ゖ]い)(?<!とい)っす(?=[かよねぞなわぜさ、。！？…」]|けど|し|もん|から|が|\\s|$)');
const COLLOQUIAL_DOSHI = re('(?<!な)(?<![りれびきちしい]も)どし(?=[たてよ])');
const COLLOQUIAL_YUU = re('(?<=(?:どー|どう|そー|そう|こー|こう|ああ|あー))ゆう');
const ELLIPSIS_RUN = re('…{2,}');
const MID_SENTENCE_ELLIPSIS = re(`(?<=[${HB}${KB}${CJK}]{2})…+(?=[^\\r\\n…])(?![${HB}${KB}][？！?!、。」』）\\r\\n])`);
const LINE_END_ELLIPSIS = re('…(?=\\r?\\n(?![ 　]*[」』）]))');
const DOT_ELLIPSIS = re('[・･．]{2,}|\\.{2,}');

/** `PreprocessText`, in upstream order, minus the parts listed above. */
export function preprocess(text: string): UnitText {
  const t = new UnitText(text);
  for (const [from, to] of [
    ['<', ' '],
    ['>', ' '],
    ['〝', ' '],
    ['〟', ' '],
    ['‥', '…'],
    ['⋯', '…'],
    ['!', '！'],
    ['?', '？'],
    ['︕', '！'],
    ['︖', '？'],
  ] as const)
    t.replaceAll(from, to);
  t.replace(DOT_ELLIPSIS, '…');

  for (const [from, to] of [
    ['「', '\n「 '],
    ['」', ' 」\n'],
    ['〈', ' \n〈 '],
    ['〉', ' 〉\n'],
    ['\n（', ' （'],
    ['）', ' ）\n'],
    ['《', ' \n《 '],
    ['》', ' 》\n'],
    ['“', ' \n“ '],
    ['”', ' ”\n'],
    ['―', ' ― '],
    ['。', '\n。\n'],
    ['！', '\n！\n'],
    ['？', '\n？\n'],
  ] as const)
    t.replaceAll(from, to);

  t.replace(TILDE_AFTER_KANA, 'ー');
  t.replace(MULTIPLE_LONG_VOWEL, 'ー');
  t.replace(EMPH_LONG_VOWEL_KANJI_HIRAGANA, '');
  t.replace(EMPH_LONG_VOWEL_SOKUON, '');
  // CollapseSameVowelSmallBeforeSokuonTo: すぅっと → すっと (same vowel only; ファ/ティ are digraphs).
  t.replace(SMALL_VOWEL_BEFORE_SOKUON_TO, (m) => {
    const base = m[1] as string;
    const smalls = m[2] as string;
    return [...smalls].every((small) => vowelRow(small) === vowelRow(base) && vowelRow(base) >= 0) ? base : m[0];
  });
  t.replace(SMALL_VOWEL_BEFORE_FINAL_LONG_VOWEL, '');
  t.replace(ELONGATED_ARU, '$1ある');
  t.replace(SCRIPT_CROSSING_SMALL_VOWEL, `${STOP}$1$2`);
  t.replace(SAME_SCRIPT_SMALL_VOWEL_RUN, '');
  t.replace(SHOUTED_IMPERATIVE_SMALL_VOWEL, '$1');
  t.replace(LONG_VOWEL_BEFORE_FINAL_I, '');

  t.replace(STUTTER_FRAGMENT, '');
  t.replace(STUTTERING_DIGRAPH_RUN, '');
  t.replace(STUTTERING_RUN, '');

  t.replaceAll('垣間見', `垣間${STOP}見`);
  t.replaceAll('今手', `今${STOP}手`);
  t.replace(HAYAME_WITHOUT_WO, `は${STOP}やめ`);
  t.replaceAll('もやる', `も${STOP}やる`);
  t.replace(HAYARU_WITHOUT_GA, `は${STOP}やる`);
  t.replaceAll('やるって', `やる${STOP}って`);
  t.replaceAll('なんとなくって', `なんとなく${STOP}って`);
  for (const [from, to] of [
    ['ええんや', `ええ${STOP}んや`],
    ['べや', `べ${STOP}や`],
    ['はいい', `は${STOP}いい`],
    ['元国王', `元${STOP}国王`],
    ['なんだろう', `なん${STOP}だろう`],
    ['一人静かに', `一人${STOP}静かに`],
    ['いやあんま', `いや${STOP}あんま`],
    ['この手紙', `この${STOP}手紙`],
    ['少女の手', `少女${STOP}の手`],
    ['はたまたま', `は${STOP}たまたま`],
    ['悶え苦しむ', `悶え${STOP}苦しむ`],
    ['悶え苦しん', `悶え${STOP}苦しん`],
    ['もうすぐそこ', `もうすぐ${STOP}そこ`],
    ['すみませんでした', `すみません${STOP}でした`],
    ['すいませんでした', `すいません${STOP}でした`],
    ['この世界', `この${STOP}世界`],
    ['だけって', `だけ${STOP}って`],
    ['ははーん', 'ははん'],
    ['にって', `に${STOP}って`],
    ['なんかいな', `なんか${STOP}いな`],
    ['繋がりって', `繋がり${STOP}って`],
    ['んったら', `ん${STOP}ったら`],
    ['にいる', `に${STOP}いる`],
    ['さっきこ', `さっき${STOP}こ`],
    ['ないっていう', `ない${STOP}っていう`],
    ['が行', `が${STOP}行`],
    ['は行', `は${STOP}行`],
    ['金のこと', `金${STOP}のこと`],
    ['なんだあれ', `なんだ${STOP}あれ`],
    ['何だあれ', `何だ${STOP}あれ`],
    ['てくだせえ', `て${STOP}くだせえ`],
    ['るっす', `る${STOP}っす`],
    ['ですまし', `で${STOP}すまし`],
    ['いったらありゃしない', `い${STOP}ったらありゃしない`],
    ['つもらっ', `つ${STOP}もらっ`],
    ['たいって', `たい${STOP}って`],
    ['るっていう', `る${STOP}っていう`],
  ] as const)
    t.replaceAll(from, to);
  t.replace(TOORI_QUOTATIVE, STOP);
  t.replace(VOWEL_TAIL_KATAKANA_BOUNDARY, STOP);
  t.replace(MOSHI_KATAKANA_BOUNDARY, `もし${STOP}`);
  t.replace(CASE_PARTICLE_TTE, STOP);
  t.replace(DEMONSTRATIVE_PRONOUN_TTE, `$1${STOP}って`);
  t.replace(PRONOUN_RA_TTE, STOP);
  t.replace(KEIKIZUKE_YO, `景気づけ${STOP}よ`);
  t.replaceAll('頚', '頸');
  t.replaceAll('前出すぎ', `前${STOP}出すぎ`);
  t.replace(DE_NAI_COMPOUND, `$1${STOP}出$2`);
  t.replaceAll('届出さ', `届${STOP}出さ`);
  t.replaceAll('射出さ', `射出${STOP}さ`);
  t.replaceAll('射出し', `射出${STOP}し`);
  t.replace(YATSURE, `${STOP}やつれ`);
  t.replaceAll('とかぶりを振', `と${STOP}かぶりを振`);
  t.replaceAll('虫を殺', `虫を${STOP}殺`);
  t.replaceAll('小木曽', `小木曽${STOP}`);
  t.replaceAll('するすると', `${STOP}するすると`);
  t.replaceAll('ぶっち切', 'ぶち切');
  t.replaceAll('おっはよ', 'おはよ');
  t.replace(ELLIPSIS_BEFORE_EMPHATIC_TSU, '');
  t.replace(EMPHATIC_TSU, `${STOP}$1`);
  t.replaceAll('ぶっ壊れ', `${STOP}ぶっ${STOP}壊れ`);
  t.replace(BAN_COMPOUND_TSU, `番${STOP}っ`);
  for (const [from, to] of [
    ['水魔法', `水${STOP}魔法`],
    ['不適応', `不${STOP}適応`],
    ['首落と', `首${STOP}落と`],
    ['面の皮', `面${STOP}の皮`],
    ['たっけ', `た${STOP}っけ`],
  ] as const)
    t.replaceAll(from, to);
  t.replace(HONTO_KATAKANA, `ホント${STOP}$1`);
  t.replace(KATAKANA_INTERJECTION_TSU, `$1${STOP}`);
  for (const [from, to] of [
    ['バカバカ', `バカ${STOP}バカ`],
    ['事大', `事${STOP}大`],
    ['前大戦', `前${STOP}大戦`],
    ['人魚姫', `人魚${STOP}姫`],
    ['日間', `日${STOP}間`],
    ['何本', `何${STOP}本`],
    ['年未公開', `年${STOP}未公開`],
    ['足元気', `足元${STOP}気`],
    ['来イ', '来い'],
    ['にちがいねえ', 'にちがいない'],
    ['せぇ', 'さい'],
    ['くせー', 'くさい'],
    ['ですぅ', 'です'],
    ['ごめんなさいっ', 'ごめんなさい'],
    ['でもちょっと', `でも${STOP}ちょっと`],
    ['できんよう', `できん${STOP}よう`],
  ] as const)
    t.replaceAll(from, to);
  t.replace(COLLOQUIAL_SSHO, `${STOP}っしょ`);
  t.replace(I_ADJ_SSHO, `${STOP}っしょ`);
  t.replace(I_ADJ_SSU, `${STOP}っす`);
  t.replace(COLLOQUIAL_DOSHI, 'どうし');
  t.replace(COLLOQUIAL_YUU, 'いう');
  t.replace(ELLIPSIS_RUN, '…');
  t.replace(MID_SENTENCE_ELLIPSIS, '');
  t.replace(LINE_END_ELLIPSIS, '。');
  return t;
}

const VOWEL_ROWS = [
  'あかがさざただなはばぱまやらわゃぁアカガサザタダナハバパマヤラワャァ',
  'いきぎしじちぢにひびぴみりぃイキギシジチヂニヒビピミリィ',
  'うくぐすずつづぬふぶぷむゆるゅぅゔウクグスズツヅヌフブプムユルュゥヴ',
  'えけげせぜてでねへべぺめれぇエケゲセゼテデネヘベペメレェ',
  'おこごそぞとどのほぼぽもよろをょぉオコゴソゾトドノホボポモヨロヲョォ',
];
const vowelRow = (char: string) => VOWEL_ROWS.findIndex((row) => row.includes(char));

/** A unit that ends a Sudachi chunk: the stop token, or a blank or line break upstream inserted. */
const isBoundary = (unit: Unit) => unit.n === STOP || (unit.o === '' && /^\s$/u.test(unit.n));

const PUNCTUATION = /^[\p{P}\p{S}\s]+$/u;
const SOKUON_ONLY = /^[っッ]+$/u;
/** Stretch and emphasis characters, which belong to the word they stretch however many there are. */
const STRETCH = /^[ぁぃぅぇぉァィゥェォーっッ〜～]+$/u;

/** A Sudachi morpheme mapped onto the original text, with the normalised surface Sudachi read (`ns`). */
export type MappedMorpheme = Morpheme & { ns: string };

interface Deleted {
  o: string;
  b: number;
  e: number;
}

interface Chunk {
  /** Normalised text sent to Sudachi. */
  text: string;
  /** Per normalised code point: its [start, end) in the original text (end = start for an inserted character). */
  spans: Array<[number, number]>;
  /** Deleted original text, keyed by the normalised code point it follows (-1: before the first). */
  deleted: Map<number, Deleted[]>;
}

function chunksOf(units: readonly Unit[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { text: '', spans: [], deleted: new Map() };
  let offset = 0;
  const flush = () => {
    if (current.text || current.deleted.size > 0) chunks.push(current);
    current = { text: '', spans: [], deleted: new Map() };
  };
  for (const unit of units) {
    const length = [...unit.o].length;
    if (isBoundary(unit)) {
      flush();
    } else if (unit.n === '') {
      const at = current.spans.length - 1;
      const list = current.deleted.get(at) ?? [];
      // Consecutive deleted characters are one piece (a deleted ハハハハ run stays together).
      const previous = list.at(-1);
      if (previous && previous.e === offset) {
        previous.o += unit.o;
        previous.e = offset + length;
      } else {
        list.push({ o: unit.o, b: offset, e: offset + length });
      }
      current.deleted.set(at, list);
    } else {
      current.text += unit.n;
      current.spans.push([offset, offset + length]);
    }
    offset += length;
  }
  flush();
  return chunks;
}

/** A morpheme that is a word, not a blank or punctuation, so stretched or emphatic characters can join it. */
const isWord = (morpheme: MappedMorpheme) => morpheme.pos[0] !== '空白' && morpheme.pos[0] !== '補助記号';

/** Extends `last` to `end` in the original text. */
function extend(last: MappedMorpheme, end: number, original: readonly string[]): void {
  last.e = end;
  last.s = original.slice(last.b, last.e).join('');
  const a = last.a.at(-1);
  if (a) a.e = end;
}

/**
 * Deleted text: stretch and emphasis characters, or any one or two characters, join the word right before it
 * (行けぇーー, だめっ);
 * punctuation stays a symbol; anything longer (a deleted ハハハハ sound effect) is an interjection of its own.
 */
function pushDeleted(piece: Deleted, out: MappedMorpheme[], original: readonly string[]): void {
  if (!piece.o) return;
  // A deleted stutter keeps its punctuation apart (は、 → は | 、).
  const runs = [...piece.o.matchAll(/[\p{P}\p{S}\s]+|[^\p{P}\p{S}\s]+/gu)];
  if (runs.length > 1) {
    let b = piece.b;
    for (const run of runs) {
      const length = [...run[0]].length;
      pushDeleted({ o: run[0], b, e: b + length }, out, original);
      b += length;
    }
    return;
  }
  const last = out.at(-1);
  const punctuation = PUNCTUATION.test(piece.o);
  if (
    !punctuation &&
    (STRETCH.test(piece.o) || [...piece.o].length <= 2) &&
    last &&
    last.e === piece.b &&
    isWord(last)
  ) {
    extend(last, piece.e, original);
    return;
  }
  out.push({
    s: piece.o,
    b: piece.b,
    e: piece.e,
    pos: punctuation ? ['補助記号', '一般', '*', '*', '*', '*'] : ['感動詞', '一般', '*', '*', '*', '*'],
    d: piece.o,
    n: piece.o,
    r: piece.o,
    a: [],
    ns: punctuation ? '' : piece.o,
  });
}

function mapBack(chunk: Chunk, morphemes: readonly Morpheme[], out: MappedMorpheme[], original: readonly string[]) {
  /** The original [start, end) covered by normalised code points [from, to). */
  const spanOf = (from: number, to: number): [number, number] | undefined => {
    const first = chunk.spans[from];
    const last = chunk.spans[to - 1];
    return first && last ? [first[0], Math.max(last[1], first[0])] : undefined;
  };

  for (const piece of chunk.deleted.get(-1) ?? []) pushDeleted(piece, out, original);

  morphemes.forEach((morpheme) => {
    const span = spanOf(morpheme.b, morpheme.e);
    if (!span) return;
    let [start, end] = span;
    // Deleted text inside the morpheme is part of it; deleted text right after it is pushed after it.
    for (let k = morpheme.b; k < morpheme.e - 1; k++) {
      for (const piece of chunk.deleted.get(k) ?? []) end = Math.max(end, piece.e);
    }
    const a = morpheme.a.map((piece) => {
      const pieceSpan = spanOf(piece.b, piece.e) ?? [start, end];
      return { s: original.slice(pieceSpan[0], pieceSpan[1]).join(''), b: pieceSpan[0], e: pieceSpan[1] };
    });
    if (a.length > 0) (a.at(-1) as { e: number }).e = end;

    const last = out.at(-1);
    // A lone emphatic っ that a boundary cut off joins the word before it (だめ|っ → だめっ, ハハハハ|ッ).
    if (SOKUON_ONLY.test(morpheme.s) && last && last.e === start && isWord(last)) {
      extend(last, end, original);
    } else {
      out.push({ ...morpheme, s: original.slice(start, end).join(''), b: start, e: end, a, ns: morpheme.s });
    }
    for (const piece of chunk.deleted.get(morpheme.e - 1) ?? []) pushDeleted(piece, out, original);
  });
}

/**
 * Sudachi's morphemes for each text, read through {@link preprocess} and mapped back onto the original text: each
 * morpheme's surface and offsets are those of the original span its units cover, and `ns` is what Sudachi read.
 */
export async function analyseSentences(texts: readonly string[], mode: SplitMode = 'B'): Promise<MappedMorpheme[][]> {
  const prepared = texts.map((text) => {
    const original = [...text];
    const chunks = chunksOf(preprocess(text).units).map((chunk) => ({
      chunk,
      stripped: withoutStretch(chunk, original),
    }));
    return { original, chunks };
  });
  const flat = prepared.flatMap(({ chunks }) =>
    chunks.flatMap(({ chunk, stripped }) =>
      chunk.text ? (stripped ? [chunk.text, stripped.text] : [chunk.text]) : [],
    ),
  );
  const analysed = flat.length > 0 ? await analyse(flat, mode) : [];
  let cursor = 0;
  return prepared.map(({ original, chunks }) => {
    const sentence: MappedMorpheme[] = [];
    for (const { chunk, stripped } of chunks) {
      if (!chunk.text) {
        mapBack(chunk, [], sentence, original);
        continue;
      }
      const morphemes = analysed[cursor++] ?? [];
      const alternative = stripped ? (analysed[cursor++] ?? []) : undefined;
      if (stripped && alternative && prefersStripped(morphemes, alternative))
        mapBack(stripped, alternative, sentence, original);
      else mapBack(chunk, morphemes, sentence, original);
    }
    return sentence;
  });
}

/** A chunk ending in hiragana + ー: the same chunk with that ー run read off (it joins the word before it). */
const TRAILING_STRETCH = /(?<=[ぁ-ゖ])ー+$/u;

function withoutStretch(chunk: Chunk, original: readonly string[]): Chunk | undefined {
  const match = TRAILING_STRETCH.exec(chunk.text);
  if (!match) return undefined;
  const cut = [...chunk.text].length - [...match[0]].length;
  if (cut <= 0) return undefined;
  const deleted = new Map<number, Deleted[]>();
  const removed: Deleted[] = [];
  for (const [at, pieces] of chunk.deleted) {
    if (at < cut - 1) deleted.set(at, pieces);
    else removed.push(...pieces);
  }
  for (const [b, e] of chunk.spans.slice(cut)) removed.push({ o: original.slice(b, e).join(''), b, e });
  removed.sort((x, y) => x.b - y.b);
  const merged: Deleted[] = [];
  for (const piece of removed) {
    const last = merged.at(-1);
    if (last && last.e === piece.b) {
      last.o += piece.o;
      last.e = piece.e;
    } else merged.push({ ...piece });
  }
  deleted.set(cut - 1, merged);
  return { text: [...chunk.text].slice(0, cut).join(''), spans: chunk.spans.slice(0, cut), deleted };
}

const WORD_ENDINGS = new Set(['動詞', '形容詞', '助動詞', '副詞', '助詞', '形状詞', '代名詞', '名詞']);

/**
 * (ours) Which reading of a chunk that ends in a stretched ー to keep. Sudachi cuts stretched imperatives badly
 * (行けー → 行 + interjection けー, やめろー → やめ + ろ + ー), but some colloquial words carry their ー
 * (うるせー, すげー): those are kept when Sudachi already reads them as one verb or adjective ending in ー.
 */
function prefersStripped(withStretch: readonly Morpheme[], stripped: readonly Morpheme[]): boolean {
  const last = withStretch.at(-1);
  if (
    last &&
    [...last.s].length >= 3 &&
    last.s.endsWith('ー') &&
    last.d.endsWith('ー') &&
    ['形容詞', '動詞', '助動詞'].includes(last.pos[0])
  )
    return false;
  const strippedLast = stripped.at(-1);
  if (!strippedLast || !WORD_ENDINGS.has(strippedLast.pos[0])) return false;
  return stripped.length <= withStretch.length;
}
