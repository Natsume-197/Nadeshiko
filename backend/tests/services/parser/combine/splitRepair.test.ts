import { describe, expect, it } from 'vitest';
import { type Group, InMemoryLexicon, toGroups } from '@app/services/parser/combine';
import { applyContextPins, fixReadingAmbiguity } from '@app/services/parser/combine/stages/disambiguation';
import {
  collapseReduplicatedMimetic,
  recombineHiraganaTokens,
  repairClippedAdjective,
  repairColloquialNegativeNee,
  repairColloquialRanNai,
  repairDanTobashi,
  repairFusedInterjectionParticle,
  repairIntensifierKaeru,
  repairOrphanedAuxiliary,
  repairQuotativeTte,
  repairSakkiMoraTheft,
  repairVowelElongation,
} from '@app/services/parser/combine/stages/repair';
import { combineCompounds } from '@app/services/parser/combine/stages/sentence';
import {
  splitTatteParticle,
  splitTawakeNoun,
  splitUnresolvableSuruCompounds,
} from '@app/services/parser/combine/stages/split';
import { deconjugate } from '@app/services/parser/deconjugator';
import { morphemes } from './fixtures';

const groups = (text: string) => toGroups(morphemes(text));
const surfaces = (list: readonly Group[]) => list.map((group) => group.s);

/** The JMdict keys these shapes consult, with the classes the typed lookups ask for. */
const lexicon = new InMemoryLexicon(
  ['ごめんなさい', 'ごろごろ', 'みごと', 'さっき', 'お祝い', '投げ', '売る', 'のさばる', '返る', 'ちょっと', '分の一'],
  {
    verb: ['のさばる', '売る', '戦う', '返る'],
    'adj-i': ['寒い'],
    kana: ['このまま'],
    common: ['ちょっと'],
  },
);
const ctx = { lexicon, deconjugate };

describe('split stages', () => {
  it('SplitTatteParticle: 買っ|たって → 買っ|た|って, so the past reaches the deconjugator', () => {
    const out = splitTatteParticle(groups('買ったって'), ctx);
    expect(out.map((group) => [group.s, group.cls, group.r])).toEqual([
      ['買っ', 'Verb', 'カッ'],
      ['た', 'Auxiliary', 'タ'],
      ['って', 'Particle', 'ッテ'],
    ]);
    expect(out[2]?.members[0]).toMatchObject({ s: 'って', b: 3, e: 5, synthetic: true });
  });

  it('SplitTawakeNoun: たわけ after a past is た + わけ, after a noun the 戯け stays', () => {
    expect(surfaces(splitTawakeNoun(groups('帰ってきたたわけ'), ctx)).slice(-2)).toEqual(['た', 'わけ']);
  });

  it('SplitUnresolvableSuruCompounds: お祝いさせて (no お祝いする in JMdict) is お祝い + させて', () => {
    const merged = groups('お祝いさせて');
    // CombineInflections has fused the noun and its する form by the time this runs.
    const fused: Group = {
      ...(merged[0] as Group),
      s: 'お祝いさせて',
      e: 6,
      cls: 'Verb',
      d: 'お祝いする',
      members: merged.flatMap((group) => group.members),
    };
    const out = splitUnresolvableSuruCompounds([fused], ctx);
    expect(out.map((group) => [group.s, group.d, group.cls])).toEqual([
      ['お祝い', 'お祝い', 'Noun'],
      ['させて', 'する', 'Verb'],
    ]);
    expect(out[1]?.members.map((member) => member.s)).toEqual(['さ', 'せ', 'て']);
  });
});

describe('repair stages', () => {
  it('RepairVowelElongation: ちょっとぉ links ちょっと, keeping its surface', () => {
    expect(repairVowelElongation(groups('ちょっとぉ'), ctx)[0]).toMatchObject({ s: 'ちょっとぉ', d: 'ちょっと' });
  });

  it('RepairColloquialNegativeNee: し|て|ね|え → し|て|ねえ (ない)', () => {
    const out = repairColloquialNegativeNee(groups('対戦してねえゲーム'), ctx);
    expect(surfaces(out)).toEqual(['対戦', 'し', 'て', 'ねえ', 'ゲーム']);
    expect(out[3]).toMatchObject({ d: 'ない', cls: 'Auxiliary', r: 'ネエ' });
  });

  it('RepairColloquialRanNai: て|らん|ない → て|らんない (られない)', () => {
    const out = repairColloquialRanNai(groups('生きてらんない'), ctx);
    expect(out.at(-1)).toMatchObject({ s: 'らんない', d: 'られない', cls: 'Auxiliary', r: 'ランナイ' });
  });

  it('RepairIntensifierKaeru: のさばりかえっ|て → のさばり + かえって (返る, pinned)', () => {
    const out = repairIntensifierKaeru(groups('のさばりかえって'), ctx);
    expect(out.map((group) => [group.s, group.d, group.r])).toEqual([
      ['のさばり', 'のさばる', 'ノサバリ'],
      ['かえって', '返る', 'カエッテ'],
    ]);
    expect(out[1]?.flags.pin).toBe(1512150);
    expect(out[1]?.deconjugation?.text).toBe('かえる');
  });

  it('RepairQuotativeTte: ついと|けっ|て → ついとけ|って (the っ of って was stolen)', () => {
    const out = repairQuotativeTte(groups('ウソついとけって'), ctx);
    expect(surfaces(out)).toEqual(['ウソ', 'ついとけ', 'って']);
    expect(out[2]).toMatchObject({ b: 6, e: 8, cls: 'Particle', r: 'ッテ' });
  });

  it('RecombineHiraganaTokens: この|まま → このまま, a kana-written word', () => {
    expect(surfaces(recombineHiraganaTokens(groups('このままじゃ'), ctx))).toEqual(['このまま', 'じゃ']);
  });

  it('RepairSakkiMoraTheft: さっ|きみ|ごと → さっき|みごと', () => {
    const out = repairSakkiMoraTheft(groups('さっきみごと'), ctx);
    expect(out.map((group) => [group.s, group.r])).toEqual([
      ['さっき', 'サッキ'],
      ['みごと', 'ミゴト'],
    ]);
    expect(out[0]?.members.map((member) => member.s)).toEqual(['さっ', 'き']);
  });

  it('CollapseReduplicatedMimetic: ごろごろ|ごろ is one adverb linking ごろごろ', () => {
    expect(collapseReduplicatedMimetic(groups('ごろごろごろ'), ctx)[0]).toMatchObject({
      s: 'ごろごろごろ',
      d: 'ごろごろ',
      cls: 'Adverb',
    });
  });

  it('RepairClippedAdjective: 寒|っ is the clipped adjective 寒い', () => {
    expect(repairClippedAdjective(groups('寒っ'), ctx)[0]).toMatchObject({ s: '寒っ', d: '寒い', cls: 'IAdjective' });
  });

  it('RepairFusedInterjectionParticle: ごめんなさいね → ごめんなさい + ね', () => {
    expect(surfaces(repairFusedInterjectionParticle(groups('ごめんなさいね'), ctx))).toEqual(['ごめんなさい', 'ね']);
  });

  it('RepairOrphanedAuxiliary: 投げ売|られ → 投げ|売られ (売る)', () => {
    const out = repairOrphanedAuxiliary(groups('投げ売られて'), ctx);
    expect(out.map((group) => [group.s, group.d])).toEqual([
      ['投げ', '投げ'],
      ['売られ', '売る'],
      ['て', 'て'],
    ]);
  });

  it('RepairDanTobashi: 一段|飛ばし → 一 + 段飛ばし (pinned); the numeral is read later, at lookup', () => {
    const out = repairDanTobashi(groups('一段飛ばし'), ctx);
    expect(out.map((group) => [group.s, group.r])).toEqual([
      ['一', ''],
      ['段飛ばし', 'ダントバシ'],
    ]);
    expect(out[1]?.flags.pin).toBe(2746000);
  });
});

describe('disambiguation re-cuts', () => {
  it('splits 方 off an unlisted 連用形 compound: 戦い方 → 戦い (戦う) + 方 (かた)', () => {
    const out = applyContextPins(groups('戦い方'), ctx);
    expect(out.map((group) => [group.s, group.d, group.r, group.cls])).toEqual([
      ['戦い', '戦う', 'タタカイ', 'Verb'],
      ['方', '方', 'カタ', 'Noun'],
    ]);
  });

  it('hard-pins 分 in N分のN, so no compound pass swallows it', () => {
    const out = fixReadingAmbiguity(groups('二分の一'), ctx);
    expect(out[1]).toMatchObject({ s: '分', r: 'ブン', flags: { hardPin: true } });
    const withEntry = { ...ctx, lexicon: new InMemoryLexicon([], { exp: ['二分の一'] }) };
    expect(surfaces(combineCompounds(out, withEntry))).toEqual(['二', '分', 'の', '一']);
  });
});
