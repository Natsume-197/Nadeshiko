import { describe, it, expect } from 'vitest';
import {
  Deconjugator,
  deconjugate,
  MAX_CHAIN_DEPTH_ABOVE_INPUT_LENGTH,
  MAX_TEXT_GROWTH_FROM_ORIGINAL,
  type DeconjugatedForm,
  type DeconjugationRule,
} from '@app/services/parser/deconjugator';

/** Same key as `DeconjugatorTests.FormatForm`: the seen chain is compared as a set. */
const formatForm = (form: DeconjugatedForm) =>
  [form.text, form.originalText, form.tags.join(','), form.process.join(','), [...form.seenText].sort().join(',')].join(
    '|',
  );

describe('deconjugate', () => {
  // Ported from the upstream deconjugator tests.
  it.each([
    ['終わってしまった', '終わる'],
    ['わからない', 'わかる'],
    ['みて', 'みる'],
    ['作る', '作る'],
    ['なかった', 'ない'],
    ['選びださねば', '選びだす'],
    // Colloquial contractions: てしまう → ちゃう/ちまう/じゃう/じまう
    ['食べちゃった', '食べる'],
    ['飲んじゃった', '飲む'],
    ['食べちまった', '食べる'],
    ['飲んじまった', '飲む'],
    // Colloquial contractions: ていく → てく, ておく → とく
    ['食べてく', '食べる'],
    ['なってく', 'なる'],
    ['飲んでく', '飲む'],
    ['食べとく', '食べる'],
    ['飲んどく', '飲む'],
    // Colloquial contractions: conditional けりゃ/きゃ, ては → ちゃ, では → じゃ
    ['食べなくちゃ', '食べる'],
    ['食べなけりゃ', '食べる'],
    ['行かなきゃ', '行く'],
    // Colloquial contractions: slang negative んない, adjective ねえ/ねぇ
    ['わかんない', 'わかる'],
    ['つまんない', 'つまる'],
    ['すごくねえ', 'すごい'],
    ['でしょ', 'です'],
    ['でしょう', 'です'],
    ['行きまひょ', '行く'],
    // Na-adjective adnominal form (な is attributive, not casual request)
    ['和やかな', '和やか'],
    ['大切な', '大切'],
    ['静かな', '静か'],
  ])('finds the dictionary form of %s (%s)', (text, expected) => {
    expect(new Deconjugator().deconjugate(text).map((f) => f.text)).toContain(expected);
  });

  it('is deterministic for the same input', () => {
    const deconjugator = new Deconjugator();
    const first = deconjugator.deconjugate('終わってしまった').map(formatForm);
    const second = deconjugator.deconjugate('終わってしまった').map(formatForm);
    expect(first).toEqual(second);
    // Also identical across instances, i.e. not just a cache hit.
    expect(new Deconjugator().deconjugate('終わってしまった').map(formatForm)).toEqual(first);
  });

  it('does not emit duplicate forms', () => {
    const keys = new Deconjugator().deconjugate('終わってしまった').map(formatForm);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each([
    ['終わってしまった', 200],
    ['食べさせられなかった', 250],
    ['読ませられなかった', 250],
  ])('stays bounded for %s (at most %i forms)', (text, maxForms) => {
    expect(new Deconjugator().deconjugate(text).length).toBeLessThanOrEqual(maxForms);
  });

  it('orders results by text length descending, then by code unit', () => {
    const texts = new Deconjugator().deconjugate('終わってしまった').map((f) => f.text);
    for (let i = 1; i < texts.length; i++) {
      const [prev, cur] = [texts[i - 1] as string, texts[i] as string];
      expect(prev.length > cur.length || (prev.length === cur.length && prev <= cur)).toBe(true);
    }
  });

  it('records rule labels outermost first for 食べました', () => {
    const form = deconjugate('食べました').find((f) => f.text === '食べる');
    expect(form?.process).toEqual(['past polite', '(infinitive)']);
    expect(form?.tags).toEqual(['uninflectable', 'stem-ren', 'v1']);
    expect(form?.seenText).toEqual(['食べました', '食べ', '食べる']);
    expect(form?.originalText).toBe('食べました');
  });

  it('records the full chain for 食べさせられたくなかった', () => {
    const form = deconjugate('食べさせられたくなかった').find((f) => f.text === '食べる');
    expect(form?.process).toEqual([
      'past',
      '(ka stem)',
      'negative',
      '(adverbial stem)',
      'want',
      '(infinitive)',
      'passive/potential',
      'causative',
    ]);
  });

  it('returns the input itself as the first-discovered, untagged form', () => {
    const initial = deconjugate('作る').find((f) => f.process.length === 0);
    expect(initial).toEqual({ text: '作る', originalText: '作る', tags: [], process: [], seenText: [] });
  });

  it('returns nothing for empty input', () => {
    expect(deconjugate('')).toEqual([]);
  });

  describe('growth guards', () => {
    // A rule that matches every form and lengthens it by one character, so only the guards stop the search.
    const growRule: DeconjugationRule = {
      type: 'stdrule',
      dec_end: ['あ'],
      con_end: [''],
      dec_tag: ['x'],
      con_tag: ['x'],
      detail: 'grow',
    };

    it('stops expanding forms more than MAX_TEXT_GROWTH_FROM_ORIGINAL characters longer than the input', () => {
      const input = 'い'.repeat(10);
      const forms = new Deconjugator({ rules: [growRule] }).deconjugate(input);
      // Forms up to input + 10 characters are expanded once more, so the longest emitted form is input + 11.
      expect(Math.max(...forms.map((f) => f.text.length))).toBe(input.length + MAX_TEXT_GROWTH_FROM_ORIGINAL + 1);
      expect(forms).toHaveLength(MAX_TEXT_GROWTH_FROM_ORIGINAL + 2);
    });

    it('stops expanding forms with more than input length + MAX_CHAIN_DEPTH_ABOVE_INPUT_LENGTH tags', () => {
      const input = 'い';
      const forms = new Deconjugator({ rules: [growRule] }).deconjugate(input);
      // Step k >= 1 carries k + 1 tags (con_tag plus one dec_tag per step); the first form over the limit is emitted
      // but not expanded. The text guard would allow 10 steps, so this one is the binding limit.
      const maxTags = input.length + MAX_CHAIN_DEPTH_ABOVE_INPUT_LENGTH + 1;
      expect(Math.max(...forms.map((f) => f.tags.length))).toBe(maxTags);
      // Steps 0 (the untagged input) through maxTags - 1.
      expect(forms).toHaveLength(maxTags);
    });
  });

  describe('cache', () => {
    it('evicts the older generation when capacity is exceeded', () => {
      const deconjugator = new Deconjugator({ maxCacheEntries: 3 });
      for (const text of [
        'わからない',
        'みて',
        'なかった',
        '終わってしまった',
        '食べる',
        '飲んだ',
        '走った',
        '書いた',
      ]) {
        deconjugator.deconjugate(text);
      }
      const stats = deconjugator.getCacheStats();
      expect(stats.evictions).toBeGreaterThan(0);
      expect(stats.stores).toBeGreaterThan(0);
    });

    it('tracks hits and misses', () => {
      const deconjugator = new Deconjugator({ maxCacheEntries: 10 });
      const first = deconjugator.deconjugate('わからない');
      const second = deconjugator.deconjugate('わからない');
      expect(second).toBe(first);
      const stats = deconjugator.getCacheStats();
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.misses).toBeGreaterThan(0);
      expect(stats.bfsCalls).toBe(1);
    });

    it('keeps a small cache by default, so the web app and the frequency job stay within their memory', () => {
      expect(new Deconjugator().getCacheStats().maxEntries).toBe(4_000);
    });

    it('does not cache inputs longer than 40 characters', () => {
      const deconjugator = new Deconjugator();
      deconjugator.deconjugate('あ'.repeat(41));
      expect(deconjugator.getCacheStats().stores).toBe(0);
    });
  });
});
