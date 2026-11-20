import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestSuite, TestDataSource } from '../../helpers/setup';
import { pitchAudioFile, pitchAudioUrl, withPitchAudio } from '@app/services/dictionary/pitchAudio/audioUrl';
import {
  checkAccent,
  checkMorae,
  decodeWav,
  moraPitches,
  pitchTrack,
  type TimedMora,
} from '@app/services/dictionary/pitchAudio/check';
import { generateClips, registerManifest, type Manifest } from '@app/services/dictionary/pitchAudio/generate';
import { accentFor, haPlan, sameMora, splitMorae, synthesisText } from '@app/services/dictionary/pitchAudio/kana';
import { selectClips } from '@app/services/dictionary/pitchAudio/select';
import {
  type AudioQuery,
  applyHaPlan,
  CLIP_SETTINGS,
  lengthenVoiced,
  makeClip,
  METAN_LEVELS,
  shapePitch,
  type VoicevoxClient,
  type VoicevoxMora,
} from '@app/services/dictionary/pitchAudio/voicevox';

setupTestSuite();

/** A mora as VOICEVOX's `audio_query` gives it. */
const mora = (text: string, vowel: string, consonant: string | null = null, pitch = 5.6): VoicevoxMora => ({
  text,
  consonant,
  consonant_length: consonant ? 0.06 : null,
  vowel,
  vowel_length: 0.12,
  pitch,
});

/** 16-bit mono WAV of one sine tone per mora, at the pitch the mora asks for (silence where it is 0), laid out the
 * way VOICEVOX lays out a clip. `follow` false plays every voiced mora at one pitch, an engine ignoring the accent. */
function fakeWav(query: AudioQuery, follow = true): Buffer {
  const rate = 24000;
  const morae = query.accent_phrases.flatMap((phrase) => phrase.moras);
  const flat = morae.find((m) => m.pitch > 0)?.pitch ?? 0;
  const parts: number[] = new Array(Math.round(query.prePhonemeLength * rate)).fill(0);
  for (const m of morae) {
    const seconds = (m.consonant_length ?? 0) + m.vowel_length;
    const hz = m.pitch > 0 ? Math.exp(follow ? m.pitch : flat) : 0;
    for (let i = 0; i < Math.round(seconds * rate); i++)
      parts.push(hz ? 0.5 * Math.sin((2 * Math.PI * hz * i) / rate) : 0);
  }
  parts.push(...new Array(Math.round(query.postPhonemeLength * rate)).fill(0));
  const data = Buffer.alloc(parts.length * 2);
  parts.forEach((value, i) => {
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** An engine that knows a few readings and synthesises sine tones. */
function fakeEngine(words: Record<string, VoicevoxMora[][]>, follow = true): VoicevoxClient & { texts: string[] } {
  const texts: string[] = [];
  return {
    texts,
    audioQuery: async (text) => {
      texts.push(text);
      const phrases = words[text];
      if (!phrases) throw new Error(`unknown ${text}`);
      return {
        accent_phrases: phrases.map((moras) => ({ moras, accent: 1, pause_mora: null, is_interrogative: false })),
        speedScale: 1,
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.1,
        outputSamplingRate: 24000,
      };
    },
    synthesis: async (query) => fakeWav(query, follow),
  };
}

const HASHI = [[mora('ハ', 'a', 'h'), mora('シ', 'i', 'sh')]];
const KOKORO = [[mora('コ', 'o', 'k'), mora('コ', 'o', 'k'), mora('ロ', 'o', 'r')]];
/** VOICEVOX reads はは as two particles. */
const HAHA = [[mora('ワ', 'a', 'w'), mora('ワ', 'a', 'w')]];

describe('kana', () => {
  it('splits a reading into morae, small kana joined to the one before', () => {
    expect(splitMorae('きょう')).toEqual(['キョ', 'ウ']);
    expect(splitMorae('がっこう')).toEqual(['ガ', 'ッ', 'コ', 'ウ']);
    expect(splitMorae('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー']);
    expect(splitMorae('ふぁいる')).toEqual(['ファ', 'イ', 'ル']);
    // A small vowel that repeats the one before lengthens it, as VOICEVOX says it.
    expect(splitMorae('まぁ')).toEqual(['マ', 'ァ']);
    expect(splitMorae('そぅ')).toEqual(['ソ', 'ゥ']);
  });

  it('writes flat as the number of morae, as VOICEVOX does', () => {
    expect(accentFor(0, 3)).toBe(3);
    expect(accentFor(1, 3)).toBe(1);
    expect(accentFor(5, 3)).toBe(3);
  });

  it('gives VOICEVOX hiragana, which reads こう as a long vowel', () => {
    expect(synthesisText('キョウ')).toBe('きょう');
    expect(synthesisText('こーひー')).toBe('こーひー');
  });

  it('decides each は from the ruby of the kanji spellings', () => {
    // 母 はは: inside the ruby. 今日は こんにちは: kana after the kanji. はなび: the first mora.
    expect([...haPlan('はは', [[{ text: '母', ruby: 'はは' }]])]).toEqual([
      [0, 'literal'],
      [1, 'literal'],
    ]);
    expect([...haPlan('こんにちは', [[{ text: '今日', ruby: 'こんにち' }, { text: 'は' }]])]).toEqual([
      [4, 'particle'],
    ]);
    expect([...haPlan('はなび', [])]).toEqual([[0, 'literal']]);
    expect([...haPlan('あはは', [])]).toEqual([
      [1, 'either'],
      [2, 'either'],
    ]);
  });

  it('counts VOICEVOX’s spelling of long vowels and はs as the same mora', () => {
    expect(sameMora('ウ', 'オ', 'o')).toBe(true);
    expect(sameMora('ー', 'イ', 'i')).toBe(true);
    expect(sameMora('イ', 'エ', 'e')).toBe(true);
    expect(sameMora('ウ', 'オ', 'U')).toBe(false);
    expect(sameMora('ヅ', 'ズ', null)).toBe(true);
    expect(sameMora('ァ', 'ア', 'a')).toBe(true);
    expect(sameMora('ハ', 'ワ', null, 'literal')).toBe(false);
    expect(sameMora('ハ', 'ワ', null, 'particle')).toBe(true);
    expect(sameMora('ヘ', 'エ', null, 'either')).toBe(true);
  });
});

describe('shaping a clip', () => {
  const semitones = (morae: VoicevoxMora[]) =>
    morae.map((m) => (m.pitch === 0 ? 0 : Math.round(12 * Math.log2(Math.exp(m.pitch) / 100) * 10) / 10));
  const four = [mora('イ', 'i'), mora('モ', 'o', 'm'), mora('ウ', 'o'), mora('ト', 'o', 't')];

  it('sets each mora’s pitch from the downstep, low-high Tokyo style', () => {
    const { high, low, fallen, slope } = METAN_LEVELS;
    expect(semitones(shapePitch(four, 0, METAN_LEVELS))).toEqual([low, high, high - slope, high - 2 * slope]);
    expect(semitones(shapePitch(four, 1, METAN_LEVELS))).toEqual([high, fallen, fallen - slope, fallen - 2 * slope]);
    expect(semitones(shapePitch(four, 2, METAN_LEVELS))).toEqual([low, high, fallen, fallen - slope]);
    // A drop after the last mora is flat said alone.
    expect(shapePitch(four, 4, METAN_LEVELS)).toEqual(shapePitch(four, 0, METAN_LEVELS));
  });

  it('leaves voiceless morae voiceless', () => {
    const kitte = [mora('キ', 'i', 'k'), { ...mora('ッ', 'cl'), pitch: 0 }, mora('テ', 'e', 't')];
    expect(shapePitch(kitte, 0, METAN_LEVELS)[1]?.pitch).toBe(0);
  });

  it('lengthens voiced consonants', () => {
    const [ba, ka] = lengthenVoiced([{ ...mora('バ', 'a', 'b'), consonant_length: 0.03 }, mora('カ', 'a', 'k')]);
    expect(ba?.consonant_length).toBe(0.1);
    expect(ka?.consonant_length).toBe(0.06);
  });

  it('turns a は VOICEVOX took for a particle back into ha', () => {
    const fixed = applyHaPlan(HAHA[0] ?? [], 'はは', haPlan('はは', [[{ text: '母', ruby: 'はは' }]]));
    expect(fixed.map((m) => [m.text, m.consonant])).toEqual([
      ['ハ', 'h'],
      ['ハ', 'h'],
    ]);
  });
});

describe('the check', () => {
  const timed = (texts: string[]): TimedMora[] =>
    texts.map((text) => ({ text, vowel: 'a', consonant_length: 0.05, vowel_length: 0.1 }));

  it('wants the reading’s morae', () => {
    expect(checkMorae('はし', timed(['ハ', 'シ']), new Map())).toEqual([]);
    expect(checkMorae('はし', timed(['ハ', 'シ', 'イ']), new Map())[0]).toMatch(/^morae: expected ハシ \(2\)/);
    expect(checkMorae('はは', timed(['ワ', 'ワ']), haPlan('はは', [[{ text: '母', ruby: 'はは' }]]))).toHaveLength(2);
  });

  it('wants the biggest fall right after the downstep', () => {
    expect(checkAccent([20, 24, 19], 2)).toBeNull();
    expect(checkAccent([24, 19, 18.5], 1)).toBeNull();
    expect(checkAccent([20, 24, 23.8], 0)).toBeNull();
    // The drop came a mora late.
    expect(checkAccent([20, 24, 23.9, 19], 2)).toMatch(/fell after mora 3 instead/);
    // No drop at all where one is due, or one where none is.
    expect(checkAccent([21.4, 21.6], 1)).toMatch(/expected a drop after mora 1/);
    expect(checkAccent([21.8, 24.7, 20.9], 0)).toMatch(/expected no drop/);
  });

  it('lets the pitch keep falling after the drop, not before it', () => {
    expect(checkAccent([23.6, 21.6, 18.3], 1)).toBeNull();
    expect(checkAccent([24, 19.5, 24, 18], 3)).toMatch(/fell already after mora 1/);
  });

  it('allows a final ん to fade, unless it falls as far as a drop', () => {
    expect(checkAccent([21.5, 24.5, 22.6], 0, ['ジ', 'カ', 'ン'])).toBeNull();
    expect(checkAccent([19.0, 24.6, 19.7], 2, ['ニ', 'ホ', 'ン'])).toBeNull();
    expect(checkAccent([19.9, 24.4, 24.3, 20.3], 0, ['イ', 'チ', 'バ', 'ン'])).toMatch(/expected no drop/);
    expect(checkAccent([21.5, 24.5, 22.6], 2, ['ジ', 'カ', 'ン'])).toMatch(/expected a drop after mora 2/);
  });

  it('folds back a mora the tracker measured an octave off', () => {
    expect(checkAccent([19.4, 11.6], 0, ['ナ', 'ン'], [19.5, 23.5])).toBeNull();
  });

  it('measures nothing across a voiceless mora at the edge of the drop, but wants some mora measured', () => {
    expect(checkAccent([null, 18.9], 1)).toBeNull();
    expect(checkAccent([null, null], 1)).toMatch(/no mora could be measured/);
  });

  it('reads the pitch of each mora from the audio', async () => {
    const query = await fakeEngine({ こころ: KOKORO }).audioQuery('こころ');
    const shaped = shapePitch(query.accent_phrases[0]?.moras ?? [], 2, METAN_LEVELS);
    const wav = fakeWav({
      ...query,
      ...CLIP_SETTINGS,
      accent_phrases: [{ ...query.accent_phrases[0]!, moras: shaped }],
    });
    const { samples, sampleRate } = decodeWav(wav);
    const pitches = moraPitches(pitchTrack(samples, sampleRate), shaped, CLIP_SETTINGS.prePhonemeLength);

    expect(pitches.map((value) => Math.round(value ?? 0))).toEqual([
      Math.round(METAN_LEVELS.low),
      Math.round(METAN_LEVELS.high),
      Math.round(METAN_LEVELS.fallen),
    ]);
  });
});

describe('makeClip', () => {
  it('makes a clip that follows the downstep, from the hiragana reading', async () => {
    const engine = fakeEngine({ こころ: KOKORO });
    const result = await makeClip(engine, { reading: 'ココロ', downstep: 2, ha: new Map() });

    expect(engine.texts).toEqual(['こころ']);
    expect(result.problems).toEqual([]);
    expect(result.wav?.subarray(0, 4).toString()).toBe('RIFF');
  });

  it('fails a clip whose audio does not fall where it should', async () => {
    const result = await makeClip(fakeEngine({ こころ: KOKORO }, false), {
      reading: 'こころ',
      downstep: 2,
      ha: new Map(),
    });

    expect(result.problems).toEqual([expect.stringMatching(/^accent: expected a drop after mora 2/)]);
  });

  it('fails without synthesising when the morae do not count up', async () => {
    const result = await makeClip(fakeEngine({ はし: [[mora('ハ', 'a', 'h')]] }), {
      reading: 'はし',
      downstep: 1,
      ha: new Map(),
    });

    expect(result.wav).toBeNull();
    expect(result.problems[0]).toMatch(/^morae/);
  });

  it('says はは with ha, not wa', async () => {
    const result = await makeClip(fakeEngine({ はは: HAHA }), {
      reading: 'はは',
      downstep: 1,
      ha: haPlan('はは', [[{ text: '母', ruby: 'はは' }]]),
    });

    expect(result.problems).toEqual([]);
  });
});

describe('generateClips', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pitch-audio-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const encode = async (wav: Buffer) => Buffer.concat([Buffer.from('OggS'), wav.subarray(0, 8)]);

  it('writes the clips that pass, lists the ones that fail, and keeps what a rerun finds', async () => {
    const engine = fakeEngine({
      はし: HASHI,
      こころ: KOKORO,
      あめ: [[mora('ア', 'a'), mora('メ', 'e', 'm'), mora('ガ', 'a')]],
    });
    const clips = [
      { reading: 'はし', downstep: 2, rank: 1, ha: haPlan('はし', []) },
      { reading: 'こころ', downstep: 2, rank: 2, ha: new Map() },
      { reading: 'あめ', downstep: 1, rank: 3, ha: new Map() },
    ];

    const first = await generateClips(clips, { outDir: dir, voice: 'metan-v1', client: engine, encode });

    expect(first.made).toBe(2);
    expect(first.manifest.clips.map((clip) => clip.file)).toEqual(['はし_2.opus', 'こころ_2.opus']);
    expect(first.report.failed).toEqual([expect.objectContaining({ reading: 'あめ', downstep: 1, rank: 3 })]);
    expect((await readdir(dir)).sort()).toEqual(
      ['manifest.json', 'report.json', 'こころ_2.opus', 'はし_2.opus'].sort(),
    );

    const second = await generateClips(clips, { outDir: dir, voice: 'metan-v1', client: engine, encode });
    expect(second).toMatchObject({ made: 0, kept: 2 });
    expect(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).clips).toHaveLength(2);
  });
});

describe('registerManifest', () => {
  const manifest: Manifest = {
    voice: 'metan-v1',
    generatedAt: '2026-11-20T00:00:00.000Z',
    clips: [
      { reading: 'はし', downstep: 2, file: 'はし_2.opus', bytes: 3000 },
      { reading: 'はし', downstep: 1, file: 'はし_1.opus', bytes: 3000 },
    ],
  };

  it('replaces the registered clips once their URLs answer', async () => {
    await TestDataSource.query(`INSERT INTO dict.pitch_audio (reading, downstep, voice) VALUES ('あめ', 1, 'old')`);
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      asked.push(url);
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    await registerManifest(TestDataSource, manifest, { baseUrl: 'https://cdn.example.com', fetchImpl });

    expect(asked).toEqual([
      'https://cdn.example.com/pitch-audio/metan-v1/%E3%81%AF%E3%81%97_2.opus',
      'https://cdn.example.com/pitch-audio/metan-v1/%E3%81%AF%E3%81%97_1.opus',
    ]);
    expect(
      await TestDataSource.query(`SELECT reading, downstep, voice FROM dict.pitch_audio ORDER BY downstep`),
    ).toEqual([
      { reading: 'はし', downstep: 1, voice: 'metan-v1' },
      { reading: 'はし', downstep: 2, voice: 'metan-v1' },
    ]);
  });

  it('writes nothing when the clips are not uploaded', async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    await expect(
      registerManifest(TestDataSource, manifest, { baseUrl: 'https://cdn.example.com', fetchImpl }),
    ).rejects.toThrow(/answered 404/);
    expect(await TestDataSource.query(`SELECT * FROM dict.pitch_audio`)).toEqual([]);
  });
});

describe('selectClips', () => {
  async function word(id: number, rank: number | null, forms: Array<[string, boolean, string[]?]>) {
    await TestDataSource.query(`INSERT INTO dict.word (id, source) VALUES ($1, 'jmdict')`, [id]);
    for (const [idx, [text, kana, applies]] of forms.entries()) {
      await TestDataSource.query(
        `INSERT INTO dict.form (word_id, idx, text, kana, applies_to_kanji) VALUES ($1, $2, $3, $4, $5)`,
        [id, idx, text, kana, applies ?? (kana ? ['*'] : [])],
      );
    }
    if (rank === null) return;
    await TestDataSource.query(
      `INSERT INTO dict.frequency (word_id, count, per_million, rank) VALUES ($1, 10, 1, $2)`,
      [id, rank],
    );
  }

  it('takes the first two accents of the most frequent words, one clip per reading and downstep', async () => {
    await word(1, 1, [
      ['橋', false],
      ['はし', true],
    ]);
    await word(2, 2, [
      ['端', false],
      ['はし', true],
    ]);
    await word(3, 3, [
      ['母', false],
      ['はは', true],
    ]);
    await word(4, 4, [
      ['雨', false],
      ['あめ', true],
    ]);
    await TestDataSource.query(
      `INSERT INTO dict.pitch (text, reading, downsteps, source) VALUES
         ('橋', 'はし', '{2}', 'unidic'), ('端', 'はし', '{0,2,1}', 'unidic'),
         ('母', 'はは', '{1}', 'unidic'), ('母', 'はは', '{2}', 'kanjium'),
         ('雨', 'あめ', '{1}', 'unidic')`,
    );
    await TestDataSource.query(
      `INSERT INTO dict.furigana (text, reading, source, segments) VALUES ('母', 'はは', 'jmdict-furigana', $1)`,
      [JSON.stringify([{ text: '母', ruby: 'はは' }])],
    );

    const top3 = await selectClips(TestDataSource, 3);

    expect(top3.map(({ reading, downstep, rank }) => [reading, downstep, rank])).toEqual([
      ['はし', 2, 1],
      ['はし', 0, 2],
      ['はは', 1, 3],
    ]);
    expect([...(top3.find((clip) => clip.reading === 'はは')?.ha ?? [])]).toEqual([
      [0, 'literal'],
      [1, 'literal'],
    ]);
  });

  it('takes every word with a pitch, the ones never seen in the corpus last', async () => {
    await word(1, 1, [
      ['橋', false],
      ['はし', true],
    ]);
    await word(5, null, [
      ['飴', false],
      ['あめ', true],
    ]);
    await word(6, null, [['ぬえ', true]]);
    await TestDataSource.query(
      `INSERT INTO dict.pitch (text, reading, downsteps, source) VALUES ('橋', 'はし', '{2}', 'unidic'), ('飴', 'あめ', '{0}', 'unidic')`,
    );

    const all = await selectClips(TestDataSource, 'all');

    expect(all.map(({ reading, downstep, rank }) => [reading, downstep, rank])).toEqual([
      ['はし', 2, 1],
      ['あめ', 0, null],
    ]);
  });
});

describe('withPitchAudio', () => {
  it('sets the clip URL on the patterns that have one', async () => {
    await TestDataSource.query(
      `INSERT INTO dict.pitch_audio (reading, downstep, voice) VALUES ('はし', 2, 'metan-v1')`,
    );
    const candidates = [
      { id: 'a', reading: 'ハシ', pitch: [{ downstep: 2 }, { downstep: 1 }] },
      { id: 'b', reading: null, pitch: [{ downstep: 2 }] },
      { id: 'c', reading: 'ハシ' },
    ];

    const out = await withPitchAudio(TestDataSource, 'https://cdn.example.com/', candidates);

    expect(out[0]?.pitch).toEqual([
      { downstep: 2, audioUrl: 'https://cdn.example.com/pitch-audio/metan-v1/%E3%81%AF%E3%81%97_2.opus' },
      { downstep: 1 },
    ]);
    expect(out.slice(1)).toEqual(candidates.slice(1));
  });

  it('names a clip by its hiragana reading and downstep', () => {
    expect(pitchAudioFile('ハシ', 2)).toBe('はし_2.opus');
    expect(pitchAudioUrl('https://cdn.example.com', 'metan-v1', 'はし', 0)).toBe(
      'https://cdn.example.com/pitch-audio/metan-v1/%E3%81%AF%E3%81%97_0.opus',
    );
  });
});
