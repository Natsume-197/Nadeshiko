/*
 * Three repair stages for spoken kana, ported from Apache-2.0 C# source (see ../../NOTICE): RepairTeOkuRequest,
 * RepairSplitMimeticAdverb and RepairEmphaticKanaSpelling. Comments are the upstream ones.
 *
 * Modified: every rebuilt token goes through ../recut.ts. Upstream lookups are our lexicon ("non-name" lookups are
 * plain ones, since it has no names). The lexicon has no word id for a kana key, so the mimetic adverbs and the
 * emphatic spellings set the entry as the dictionary form without pinning it; RepairTeOkuRequest pins お呉れ, whose
 * id the rewrite rules also pin. Our groups always tile the sentence, so the adjacency checks on offsets hold.
 */

import { known, knownVerbOrAdjective } from '../group';
import { deconjugationKey, isKana, isKatakanaChar } from '../kana';
import { type Piece, recut, scanRewrite } from '../recut';
import { chars, cpLength } from '../text';
import type { CombineContext, Group } from '../types';

const isSmallTsu = (char: string | undefined) => char === 'っ' || char === 'ッ';
const isEmphasisMark = (char: string | undefined) => isSmallTsu(char) || char === 'ー';

/** `OkureRequestWordId`: お呉れ, the request "please (do for me)". */
export const OKURE_REQUEST_WORD_ID = 2868242;

/** User-dictionary ておく expressions swallow the request お呉れ (やめておく|れ is やめて + おくれ); passive おく would be
 * おか|れ. `RepairTeOkuRequest`. */
export function repairTeOkuRequest(groups: Group[], _ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const teOku = list[i] as Group;
    const re = list[i + 1];
    if (
      !re ||
      (teOku.cls !== 'Verb' && teOku.cls !== 'Expression') ||
      cpLength(teOku.s) < 4 ||
      !(teOku.s.endsWith('ておく') || teOku.s.endsWith('でおく')) ||
      !teOku.r.endsWith('オク')
    )
      return 0;
    if (re.cls !== 'Auxiliary' || re.d !== 'れる' || (re.s !== 'れ' && re.s !== 'れよ')) return 0;

    const teForm = chars(teOku.s).slice(0, -2).join('');
    const pieces: Piece[] = [
      { s: teForm, from: teOku, d: teForm, n: teForm, r: chars(teOku.r).slice(0, -2).join('') },
      {
        s: 'おくれ',
        from: re,
        d: 'おくれ',
        n: 'お呉れ',
        r: 'オクレ',
        cls: 'Expression',
        sec: ['*', re.sec[1], re.sec[2]],
        flags: { ...re.flags, pin: OKURE_REQUEST_WORD_ID, hardPin: true },
      },
    ];
    if (re.s === 'れよ')
      pieces.push({ s: 'よ', fresh: true, d: 'よ', n: 'よ', r: 'ヨ', cls: 'Particle', sec: ['終助詞', '*', '*'] });
    emit().push(...recut(list, i, 2, pieces));
    return 2;
  });
}

/** A mimetic split from its と (フラ|っと, イラッ|として, キューっ|て) rejoins, pinned, when JMDict has the adverb and a
 * hiragana head isn't a compound's tail (言い|が|かりっ|て, で|すかっ|て). `RepairSplitMimeticAdverb`. */
export function repairSplitMimeticAdverb(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (list, i, emit) => {
    const head = list[i] as Group;
    const next = list[i + 1];
    if (
      !next ||
      head.flags.pin !== undefined ||
      next.flags.pin !== undefined ||
      cpLength(head.s) < 2 ||
      cpLength(head.s) > 6 ||
      !chars(head.s).every((char) => isKana(char))
    )
      return 0;

    const headEndsInSokuon = isSmallTsu(chars(head.s).at(-1));
    const stem = headEndsInSokuon ? chars(head.s).slice(0, -1).join('') : head.s;
    const prev = list[i - 1];
    const prev2 = list[i - 2];
    if (
      !chars(stem).every(isKatakanaChar) &&
      ((prev && known(ctx, prev.s + stem)) || (prev && prev2 && known(ctx, prev2.s + prev.s + stem)))
    )
      return 0;

    const mergedMimetic = (text: string, dictForm: string): Piece => ({
      s: text,
      from: head,
      d: dictForm,
      n: dictForm,
      r: head.r + next.r,
      cls: 'Adverb',
    });

    if (
      !headEndsInSokuon &&
      next.s === 'っと' &&
      chars(head.s).every(isKatakanaChar) &&
      head.cls !== 'Particle' &&
      head.cls !== 'Auxiliary' &&
      head.cls !== 'Verb' &&
      known(ctx, `${head.s}っと`)
    ) {
      emit().push(...recut(list, i, 2, [mergedMimetic(`${head.s}っと`, `${head.s}っと`)]));
      return 2;
    }

    if (!headEndsInSokuon || head.cls !== 'Adverb' || !known(ctx, `${head.s}と`)) return 0;

    if (next.s === 'として') {
      emit().push(
        ...recut(list, i, 2, [
          { s: `${head.s}と`, from: head, d: `${head.s}と`, n: `${head.s}と`, r: `${head.r}ト`, cls: 'Adverb' },
          { s: 'して', from: next, d: 'する', n: '為る', r: 'シテ', cls: 'Verb' },
        ]),
      );
      return 2;
    }

    // Ours: our Sudachi leaves と and して apart (イラッ|と|し|て), so the と joins the adverb before する's forms too.
    if (next.s === 'と' && next.cls === 'Particle' && list[i + 2]?.d === 'する') {
      emit().push(
        ...recut(list, i, 2, [
          { s: `${head.s}と`, from: head, d: `${head.s}と`, n: `${head.s}と`, r: `${head.r}ト`, cls: 'Adverb' },
        ]),
      );
      return 2;
    }

    if (next.s === 'て' && next.cls === 'Particle' && list[i + 2]?.cls === 'Verb') {
      emit().push(...recut(list, i, 2, [mergedMimetic(`${head.s}て`, `${head.s}と`)]));
      return 2;
    }

    return 0;
  });
}

const EMPHATIC_RUN_MAX_TOKENS = 4;
const EMPHATIC_PLAIN_MIN_LENGTH = 4;
const EMPHATIC_RUN_CLASSES = new Set(['Adverb', 'Interjection', 'Noun', 'CommonNoun', 'IAdjective']);

const isEmphaticRunToken = (w: Group) =>
  w.flags.pin === undefined &&
  w.s.length > 0 &&
  (w.s === 'ー' ||
    (EMPHATIC_RUN_CLASSES.has(w.cls) && chars(w.s).every((char) => (char >= 'ぁ' && char <= 'ゖ') || char === 'ー')));

/** Repeated cries (わーい|わーい) are separate utterances, never one respelled word. */
function isReduplication(tokens: readonly Group[], start: number, end: number): boolean {
  if (end === start) return false;
  for (let k = start + 1; k <= end; k++) if ((tokens[k] as Group).s !== (tokens[start] as Group).s) return false;
  return true;
}

/** Lookups already fold ー and っ, so a whole-run hit only proves a respelling when Sudachi cut a bare ー off
 * (うっと|ー|しい, not からっ|すか). */
function hasLongVowelShard(tokens: readonly Group[], start: number, end: number): boolean {
  for (let k = start; k <= end; k++) if ((tokens[k] as Group).s === 'ー') return true;
  return false;
}

const hasMark = (text: string) => chars(text).some(isEmphasisMark);

/** Across tokens only an unknown cry carries the emphasis (ほ|んっとー|うに); a lemmatised or adverb shard (からっ|すか,
 * ま|え|かった) is its own word. */
function markedTokensAreCries(tokens: readonly Group[], start: number, end: number): boolean {
  for (let k = start; k <= end; k++) {
    const t = tokens[k] as Group;
    if (t.s !== 'ー' && hasMark(t.s) && t.cls !== 'Interjection') return false;
  }
  return true;
}

/** A marked token that is a word on its own (うーん|そう, もっと|ねた) is a separate word, not part of a respelling. */
function markedTokenIsWord(ctx: CombineContext, tokens: readonly Group[], start: number, end: number): boolean {
  for (let k = start; k <= end; k++) {
    const text = (tokens[k] as Group).s;
    if (text !== 'ー' && hasMark(text) && known(ctx, text)) return true;
  }
  return false;
}

/** Tries every drop of the inner っ and every ー as う, or dropped before a vowel it doubles (とーう); null unless
 * exactly one spelling is a word. */
export function findPlainEmphaticSpelling(ctx: CombineContext, run: string): string | null {
  const cs = chars(run);
  const markers: number[] = [];
  for (let k = 1; k < cs.length; k++) if (isEmphasisMark(cs[k])) markers.push(k);
  if (markers.length === 0 || markers.length > 3) return null;

  let found: string | null = null;
  let choices = 1;
  for (const m of markers) choices *= cs[m] === 'ー' ? 3 : 2;
  for (let combo = 1; combo < choices; combo++) {
    let candidate = '';
    let rest = combo;
    let mi = 0;
    let valid = true;
    for (let k = 0; k < cs.length; k++) {
      const char = cs[k] as string;
      if (mi < markers.length && markers[mi] === k) {
        const options = char === 'ー' ? 3 : 2;
        const pick = rest % options;
        rest = Math.floor(rest / options);
        mi++;
        if (pick === 0) candidate += char;
        else if (pick === 2) candidate += 'う';
        else if (char === 'ー' && (k + 1 >= cs.length || !'あいうえお'.includes(cs[k + 1] as string))) valid = false;
        continue;
      }
      candidate += char;
    }
    if (!valid) continue;
    if (cpLength(candidate) < EMPHATIC_PLAIN_MIN_LENGTH || !known(ctx, candidate)) continue;
    if (found !== null && found !== candidate) return null;
    found = candidate;
  }
  return found;
}

/** A kana word shredded or respelled by emphatic っ/ー (ぬっくぬく, ほんっとーうに, うっと|ー|しい) rejoins its entry.
 * `RepairEmphaticKanaSpelling`. */
export function repairEmphaticKanaSpelling(groups: Group[], ctx: CombineContext): Group[] {
  return scanRewrite(groups, (tokens, i, emit) => {
    const first = tokens[i] as Group;
    if (!isEmphaticRunToken(first) || first.s === 'ー') return 0;

    let maxEnd = i;
    while (
      maxEnd + 1 < tokens.length &&
      maxEnd + 1 - i < EMPHATIC_RUN_MAX_TOKENS &&
      isEmphaticRunToken(tokens[maxEnd + 1] as Group)
    )
      maxEnd++;

    for (let end = maxEnd; end >= i; end--) {
      if ((tokens[end] as Group).s === 'ー' && end > i) continue;
      const span = tokens.slice(i, end + 1);
      const run = span.map((t) => t.s).join('');
      if (isReduplication(tokens, i, end) || (end > i && markedTokenIsWord(ctx, tokens, i, end))) continue;
      const cs = chars(run);
      if (cs.length < EMPHATIC_PLAIN_MIN_LENGTH + 1 || !cs.slice(1).some(isEmphasisMark) || isSmallTsu(cs.at(-1)))
        continue;

      let plain: string | null;
      if (known(ctx, run)) plain = end > i && hasLongVowelShard(tokens, i, end) ? run : null;
      else if (end === i ? first.d.length > 0 && first.d !== run : !markedTokensAreCries(tokens, i, end)) plain = null;
      else plain = findPlainEmphaticSpelling(ctx, run);
      if (plain === null || !known(ctx, plain)) continue;
      // Ours: the entry's own spelling (うっとーしい is listed as うっとうしい), which upstream reaches by word id.
      const entry = ctx.lexicon.has(plain) ? plain : deconjugationKey(plain);

      emit().push(
        ...recut(tokens, i, end - i + 1, [
          {
            s: run,
            from: first,
            d: entry,
            n: entry,
            r: span.map((t) => t.r).join(''),
            cls: entry.endsWith('い') && knownVerbOrAdjective(ctx, entry) ? 'IAdjective' : 'Adverb',
          },
        ]),
      );
      return end - i + 1;
    }
    return 0;
  });
}
