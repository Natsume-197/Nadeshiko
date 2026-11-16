import { describe, it, expect } from 'vitest';
import rules from '@app/services/parser/deconjugator/rules.json';
import { deconjugate } from '@app/services/parser/deconjugator';
import { DETAIL_LABELS, inflectionLabels } from '@app/services/parser/labels';

/** Every label the card shows (the current parser's vocabulary on the dev corpus). */
const CARD_LABELS = new Set([
  'te-form',
  'past',
  'progressive',
  'negative',
  'polite',
  'continuative',
  'passive',
  'desiderative (〜たい)',
  'conditional (〜たら)',
  'adverbial (〜く)',
  'provisional (〜ば)',
  'volitional',
  'imperative',
  'progression toward (〜てくる)',
  'potential / passive',
  'done for me (〜てくれる)',
  'conditional (〜なら)',
  'causative',
  'negative (〜ん)',
  'completive (〜ちゃう)',
  'polite request (〜てください)',
  'having someone do (〜てもらう)',
  'preparatory (〜おく)',
  'slang (〜え)',
  'attempt (〜てみる)',
  'progression away (〜ていく)',
  'doing for someone, plain (〜てやる)',
  'completive (〜しまう)',
  'contracted (〜じゃ)',
  'potential',
  'negative (〜ず)',
  'conditional contraction (〜ゃ)',
  'n-slang',
  'representative (〜たり)',
  'negative (〜ぬ)',
  'negative (〜ないで)',
  'completive (〜ちまう)',
  'looks like (〜そう)',
  'polite imperative (〜なさい)',
  'obligation (〜べき)',
  'contemptuous (〜やがる)',
  'having someone do',
  'having someone do, humble (〜ていただく)',
  'nominalization (〜さ)',
  'obligation (must)',
  'doing for someone (〜てあげる)',
  'resultant state (〜てある)',
  'contracted (〜ちゃ)',
  'excessive (〜過ぎる)',
  'showing signs (〜がる)',
  'simultaneous (〜ながら)',
  'continue (〜続ける)',
  'permission (may)',
  'short causative',
  'prohibition (must not)',
  'begin (〜始める)',
  'easy to (〜やすい)',
  'negative volitional (〜まい)',
  'hard to (〜にくい)',
  'kansai dialect',
  'negative (〜ざる)',
  'done for me',
  'done for me, honorific (〜てくださる)',
  'exemption (need not)',
  'appearance (〜げ)',
  'negative conditional (〜ねば)',
  'left as it is (〜っぱなし)',
  'finish (〜終わる)',
  'tends to (〜がち)',
  'imperative negative (slang)',
  'attributive (〜き)',
  'cannot (〜かねる)',
]);

/** The process of the first candidate that reaches `base`, as the parser would pick it. */
const processOf = (surface: string, base: string) => {
  const form = deconjugate(surface).find((f) => f.text === base);
  if (!form) throw new Error(`${surface} does not deconjugate to ${base}`);
  return form.process;
};

const labelsOf = (surface: string, base: string) => inflectionLabels(processOf(surface, base), surface);

describe('inflectionLabels', () => {
  it('reads 食べました as past, polite', () => {
    expect(inflectionLabels(['past polite', '(infinitive)'], '食べました')).toEqual(['past', 'polite']);
  });

  it('reads 食べさせられたくなかった outermost first', () => {
    expect(
      inflectionLabels(
        ['past', '(ka stem)', 'negative', '(adverbial stem)', 'want', '(infinitive)', 'passive/potential', 'causative'],
        '食べさせられたくなかった',
      ),
    ).toEqual(['past', 'negative', 'desiderative (〜たい)', 'potential / passive', 'causative']);
  });

  it.each([
    ['食べました', '食べる', ['past', 'polite']],
    ['食べている', '食べる', ['progressive']],
    ['食べてる', '食べる', ['progressive']],
    ['食べちゃう', '食べる', ['completive (〜ちゃう)']],
    ['飲んじゃった', '飲む', ['past', 'completive (〜ちゃう)']],
    ['食べちまった', '食べる', ['past', 'completive (〜ちまう)']],
    ['食べてしまう', '食べる', ['completive (〜しまう)']],
    ['食べれば', '食べる', ['provisional (〜ば)']],
    ['高ければ', '高い', ['provisional (〜ば)']],
    ['食べなきゃ', '食べる', ['conditional contraction (〜ゃ)', 'negative']],
    ['食べりゃ', '食べる', ['conditional contraction (〜ゃ)']],
    ['食べなくちゃ', '食べる', ['contracted (〜ちゃ)', 'negative']],
    ['食べて', '食べる', ['te-form']],
    ['食べないで', '食べる', ['negative (〜ないで)']],
    ['食べ', '食べる', ['continuative']],
    ['高く', '高い', ['adverbial (〜く)']],
    ['高くない', '高い', ['negative']],
    ['書かれる', '書く', ['passive']],
    ['書ける', '書く', ['potential']],
    ['食べたら', '食べる', ['conditional (〜たら)']],
    ['食べたり', '食べる', ['representative (〜たり)']],
    ['食べたい', '食べる', ['desiderative (〜たい)']],
    ['食べず', '食べる', ['negative (〜ず)']],
    ['食べぬ', '食べる', ['negative (〜ぬ)']],
    ['食べざる', '食べる', ['negative (〜ざる)']],
    ['食べねば', '食べる', ['negative conditional (〜ねば)']],
    ['食べてください', '食べる', ['polite request (〜てください)']],
    ['食べてみる', '食べる', ['attempt (〜てみる)']],
    ['食べとく', '食べる', ['preparatory (〜おく)']],
    ['分かんない', '分かる', ['n-slang', 'negative']],
    ['すごくねえ', 'すごい', ['slang (〜え)', 'negative']],
    ['食べへん', '食べる', ['negative', 'kansai dialect']],
  ])('labels %s', (surface, base, expected) => {
    expect(labelsOf(surface, base)).toEqual(expected);
  });

  it('drops empty and parenthesised internal steps and de-duplicates consecutive repeats', () => {
    expect(inflectionLabels(['teiru', '', '(te form)', '(unstressed infinitive)'])).toEqual(['progressive']);
    expect(inflectionLabels(['teiru', 'teru (teiru)'])).toEqual(['progressive']);
  });

  it('skips details it does not know', () => {
    expect(inflectionLabels(['past', 'not a rule'])).toEqual(['past']);
  });
});

describe('DETAIL_LABELS', () => {
  const details = [...new Set((rules as Array<{ detail: string }>).map((rule) => rule.detail))];

  it('covers every detail in rules.json', () => {
    expect(details.filter((detail) => !(detail in DETAIL_LABELS))).toEqual([]);
  });

  it('has no detail that rules.json lacks', () => {
    expect(Object.keys(DETAIL_LABELS).filter((detail) => !details.includes(detail))).toEqual([]);
  });

  it('only produces labels from the card vocabulary', () => {
    const surfaces = ['', '食べないで', '食べざる', '飲んじゃ', '食べちまう', '行かなきゃ'];
    const nexts = [undefined, ...details];
    const produced = new Set<string>();
    for (const detail of details) {
      for (const surface of surfaces) {
        for (const next of nexts) {
          const process = next === undefined ? [detail] : [detail, next];
          for (const label of inflectionLabels(process, surface)) produced.add(label);
        }
      }
    }
    expect([...produced].filter((label) => !CARD_LABELS.has(label))).toEqual([]);
  });
});
