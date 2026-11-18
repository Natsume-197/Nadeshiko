import { describe, expect, it } from 'vitest';
import { type CombineContext, fromMorpheme, type Group, InMemoryLexicon } from '@app/services/parser/combine';
import { isNonWordToken, isPrenominalModifier } from '@app/services/parser/combine/group';
import { toKatakana } from '@app/services/parser/combine/kana';
import { kanjiCompoundsWithPrevious } from '@app/services/parser/combine/stages/auxiliaries';
import { combineFinal } from '@app/services/parser/combine/stages/particles';
import {
  findPlainEmphaticSpelling,
  OKURE_REQUEST_WORD_ID,
  repairEmphaticKanaSpelling,
  repairSplitMimeticAdverb,
  repairTeOkuRequest,
} from '@app/services/parser/combine/stages/repairEmphatic';
import { applyTokenRewriteRulesReading } from '@app/services/parser/combine/stages/rewrite';
import { combineSuffix, reclassifyOrphanedSuffixes } from '@app/services/parser/combine/stages/suffix';
import { deconjugate } from '@app/services/parser/deconjugator';
import type { Morpheme } from '@app/services/parser/sudachi';

const NOUN = '名詞,普通名詞,一般';
const NAME = '名詞,固有名詞,人名';
const VERB = '動詞,一般';
const ADV = '副詞';
const CASE = '助詞,格助詞';
const BOUND = '助詞,係助詞';
const CONJ_PRT = '助詞,接続助詞';
const AUX = '助動詞';
const INTJ = '感動詞,一般';
const SUFFIX = '接尾辞,名詞的,一般';
const SYMBOL = '補助記号,読点';
const NA = '形状詞,一般';
const PRON = '代名詞';
const COUNTER = '接尾辞,名詞的,助数詞';

type Tok = [s: string, pos: string, d?: string, r?: string, n?: string];

function sentence(...tokens: Tok[]): Group[] {
  let b = 0;
  return tokens.map(([s, pos, d = s, r, n = d]) => {
    const e = b + [...s].length;
    const fields = [...pos.split(','), '*', '*', '*', '*', '*', '*'].slice(0, 6) as Morpheme['pos'];
    const morpheme: Morpheme = { s, b, e, pos: fields, d, n, r: r ?? toKatakana(s), a: [] };
    b = e;
    return fromMorpheme(morpheme);
  });
}

const cx = (keys: string[] = [], classes: ConstructorParameters<typeof InMemoryLexicon>[1] = {}): CombineContext => ({
  lexicon: new InMemoryLexicon(keys, classes),
  deconjugate,
});
const empty = cx();
const view = (list: readonly Group[]) => list.map((group) => [group.s, group.d, group.cls]);
const surfaces = (list: readonly Group[]) => list.map((group) => group.s);

describe('repairTeOkuRequest', () => {
  it('splits やめておく|れ into やめて + お呉れ', () => {
    const out = repairTeOkuRequest(
      sentence(['やめておく', VERB, 'やめておく', 'ヤメテオク'], ['れ', AUX, 'れる']),
      empty,
    );
    expect(view(out)).toEqual([
      ['やめて', 'やめて', 'Verb'],
      ['おくれ', 'おくれ', 'Expression'],
    ]);
    expect(out[1]?.flags).toMatchObject({ pin: OKURE_REQUEST_WORD_ID, hardPin: true });
  });

  it('splits off the よ of れよ', () => {
    const out = repairTeOkuRequest(
      sentence(['待っておく', VERB, '待っておく', 'マッテオク'], ['れよ', AUX, 'れる']),
      empty,
    );
    expect(surfaces(out)).toEqual(['待って', 'おくれ', 'よ']);
    expect(out[2]?.cls).toBe('Particle');
  });

  it('leaves the passive alone (おか|れ)', () => {
    const input = sentence(['置かれ', VERB, '置く'], ['た', AUX]);
    expect(repairTeOkuRequest(input, empty)).toBe(input);
  });
});

describe('repairSplitMimeticAdverb', () => {
  const ctx = cx(['ふらっと', 'いらっと']);

  it('rejoins katakana フラ|っと', () => {
    const out = repairSplitMimeticAdverb(sentence(['フラ', NOUN], ['っと', ADV]), ctx);
    expect(view(out)).toEqual([['フラっと', 'フラっと', 'Adverb']]);
  });

  it('rejoins イラッ|として as イラッと + して', () => {
    const out = repairSplitMimeticAdverb(sentence(['イラッ', ADV], ['として', CASE]), ctx);
    expect(view(out)).toEqual([
      ['イラッと', 'イラッと', 'Adverb'],
      ['して', 'する', 'Verb'],
    ]);
  });

  it('rejoins イラッ|と before する, as our Sudachi cuts it', () => {
    const out = repairSplitMimeticAdverb(
      sentence(['イラッ', ADV], ['と', CASE], ['し', VERB, 'する'], ['て', CONJ_PRT]),
      ctx,
    );
    expect(surfaces(out)).toEqual(['イラッと', 'し', 'て']);
  });

  it('keeps a hiragana head that is a compound tail', () => {
    const input = sentence(['言い', VERB, '言う'], ['が', CASE], ['かりっ', ADV], ['て', CONJ_PRT], ['いう', VERB]);
    expect(repairSplitMimeticAdverb(input, cx(['かりっと', '言いがかり']))).toBe(input);
  });
});

describe('repairEmphaticKanaSpelling', () => {
  const ctx = cx(['ほんとうに', 'ぬくぬく', 'うっとうしい'], { 'adj-i': ['うっとうしい'] });

  it('finds the plain spelling of an emphatic respelling', () => {
    expect(findPlainEmphaticSpelling(ctx, 'ほんっとーうに')).toBe('ほんとうに');
    expect(findPlainEmphaticSpelling(ctx, 'ぬっくぬく')).toBe('ぬくぬく');
    expect(findPlainEmphaticSpelling(ctx, 'ほげっとー')).toBeNull();
  });

  it('rejoins a shredded cry (ほ|んっとー|うに)', () => {
    const out = repairEmphaticKanaSpelling(sentence(['ほ', INTJ], ['んっとー', INTJ], ['うに', NOUN]), ctx);
    expect(view(out)).toEqual([['ほんっとーうに', 'ほんとうに', 'Adverb']]);
  });

  it('reads a respelt adjective as an adjective (うっと|ー|しい)', () => {
    const out = repairEmphaticKanaSpelling(sentence(['うっと', ADV], ['ー', NOUN], ['しい', NOUN]), ctx);
    expect(view(out)).toEqual([['うっとーしい', 'うっとうしい', 'IAdjective']]);
  });

  it('keeps repeated cries apart (わーい|わーい)', () => {
    const input = sentence(['わーい', INTJ], ['わーい', INTJ]);
    expect(repairEmphaticKanaSpelling(input, cx(['わいわい']))).toBe(input);
  });
});

describe('guards from the upstream fixes', () => {
  it('treats punctuation as no word', () => {
    const [comma, word] = sentence(['、', SYMBOL], ['猫', NOUN]);
    expect(isNonWordToken(comma as Group)).toBe(true);
    expect(isNonWordToken(word as Group)).toBe(false);
  });

  it('never merges a suffix onto punctuation', () => {
    const input = sentence(['、', NOUN], ['さ', SUFFIX]);
    expect(combineSuffix(input, empty)).toBe(input);
  });

  it('reclassifies a suffix that opens the sentence', () => {
    const out = reclassifyOrphanedSuffixes(sentence(['ども', SUFFIX], ['が', CASE]), empty);
    expect(out[0]?.cls).toBe('CommonNoun');
  });

  it('keeps の|で before は apart (嫌いなの|では)', () => {
    const out = combineFinal(sentence(['の', CASE], ['で', AUX, 'だ'], ['は', BOUND], ['ない', AUX]), empty);
    expect(surfaces(out)).not.toContain('ので');
  });

  it('knows an attributive form', () => {
    const [kirei, na, me] = sentence(['綺麗', NA], ['な', AUX, 'だ'], ['目', NOUN]);
    expect(isPrenominalModifier(na as Group)).toBe(true);
    expect(isPrenominalModifier(kirei as Group)).toBe(false);
    expect(isPrenominalModifier(me as Group)).toBe(false);
  });

  it('sees a kanji that compounds with the word before it (忘れ|物)', () => {
    const groups = sentence(['忘れ', VERB, '忘れる'], ['物', NOUN], ['し', VERB, 'する']);
    expect(kanjiCompoundsWithPrevious(groups, 1, cx(['忘れ物']))).toBe(true);
    expect(kanjiCompoundsWithPrevious(groups, 1, empty)).toBe(false);
  });

  it('reads 何 before a counter as なん', () => {
    const out = applyTokenRewriteRulesReading(sentence(['何', PRON, '何', 'ナニ'], ['冊', COUNTER]), empty);
    expect(out[0]?.r).toBe('ナン');
    expect(out[0]?.flags.pin).toBe(2846738);
  });

  it('keeps a name + たん intact elsewhere too', () => {
    expect(surfaces(sentence(['るみ', NAME], ['たん', SUFFIX]))).toEqual(['るみ', 'たん']);
  });
});
