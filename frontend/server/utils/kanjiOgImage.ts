import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import satori from 'satori';
import { isJoyoKanji } from '#shared/data/joyoKanji';

// The share image of a kanji page (task 44): the kanji large on a practice grid, its meanings and readings, and its
// levels, 1200×630. Drawn by satori (a tree of flex boxes → SVG) and rasterised by resvg. The font is Noto Sans JP cut
// down to the jōyō and JLPT kanji, kana and Latin (`server/assets/fonts`), so only those kanji get an image.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface KanjiOgCard {
  character: string;
  strokeCount: number;
  jlpt: number | null;
  kanken: string | null;
  readings: Array<{ kind: 'on' | 'kun'; reading: string }>;
  meanings: string[];
}

export type KanjiOgLocale = 'en' | 'es';

/** The kanji and language of `/og/kanji/<locale>/<kanji>.png`, or null when there is no such image: only the jōyō
 *  kanji have one (they are the indexed pages, and the font holds them). */
export function kanjiOgRequest(
  locale: string | undefined,
  file: string | undefined,
): { character: string; locale: KanjiOgLocale } | null {
  if (locale !== 'en' && locale !== 'es') return null;
  let name: string;
  try {
    name = decodeURIComponent(file ?? '');
  } catch {
    return null;
  }
  if (!name.endsWith('.png')) return null;
  const character = name.slice(0, -'.png'.length);
  if ([...character].length !== 1 || !isJoyoKanji(character)) return null;
  return { character, locale };
}

/** satori's input: a tree of elements with inline styles, as React would build it. */
export interface OgNode {
  type: string;
  props: { style?: Record<string, string | number>; children?: Array<OgNode | string> | OgNode | string };
}

const COLORS = {
  page: '#1b1b1c',
  card: '#252526',
  grid: '#3c3c3c',
  ink: '#e8e8e8',
  muted: '#a8a8a8',
  faint: '#8a8a8a',
  accent: '#df848d',
};

const MAX_READINGS = 4;
const SIDE_PADDING = 72;
const GRID_SIZE = 420;
const GAP = 64;
const DETAILS_WIDTH = OG_WIDTH - 2 * SIDE_PADDING - GRID_SIZE - GAP;
const MAX_MEANINGS = 3;

function el(type: string, style: Record<string, string | number>, children?: OgNode['props']['children']): OgNode {
  return { type, props: { style, ...(children === undefined ? {} : { children }) } };
}

/** Readings of one kind as a dictionary lists them, without KANJIDIC's okurigana dot and affix dashes. */
export function readingsOf(card: KanjiOgCard, kind: 'on' | 'kun'): string[] {
  return card.readings
    .filter((reading) => reading.kind === kind)
    .map((reading) => reading.reading.replace('.', '').replace(/^-|-$/g, ''))
    .filter((reading, index, all) => reading && all.indexOf(reading) === index)
    .slice(0, MAX_READINGS);
}

/** The image as a satori tree. Pure, so the layout can be tested without rendering. */
export function kanjiOgTree(card: KanjiOgCard): OgNode {
  const meaning = card.meanings.slice(0, MAX_MEANINGS).join(', ');
  const badges = [
    card.jlpt ? `JLPT N${card.jlpt}` : null,
    card.kanken ? `漢検 ${card.kanken}` : null,
    `${card.strokeCount}画`,
  ].filter((badge): badge is string => badge !== null);

  // Each reading is its own box, so a line breaks between readings and never inside one.
  const rows = (['on', 'kun'] as const)
    .map((kind) => ({ kind, readings: readingsOf(card, kind) }))
    .filter((row) => row.readings.length > 0)
    .map((row) =>
      el('div', { display: 'flex', alignItems: 'baseline', gap: 20 }, [
        el(
          'div',
          { width: 64, flexShrink: 0, fontSize: 24, fontWeight: 700, color: COLORS.faint },
          row.kind === 'on' ? 'ON' : 'KUN',
        ),
        el(
          'div',
          { display: 'flex', flexWrap: 'wrap', fontSize: 38, color: COLORS.ink },
          row.readings.map((reading, index) =>
            el('div', { display: 'flex' }, index < row.readings.length - 1 ? `${reading}、` : reading),
          ),
        ),
      ]),
    );

  // The practice grid: a square with a faint cross through it, like the page header. The cross is the square's
  // background, so the kanji is drawn over it.
  const cross = `${COLORS.grid} calc(50% - 1px), ${COLORS.grid} calc(50% + 1px)`;
  const grid = el(
    'div',
    {
      position: 'absolute',
      left: SIDE_PADDING,
      top: (OG_HEIGHT - GRID_SIZE) / 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: GRID_SIZE,
      height: GRID_SIZE,
      borderRadius: 28,
      border: `2px solid ${COLORS.grid}`,
      backgroundColor: COLORS.card,
      backgroundImage: `linear-gradient(to right, transparent calc(50% - 1px), ${cross}, transparent calc(50% + 1px)), linear-gradient(to bottom, transparent calc(50% - 1px), ${cross}, transparent calc(50% + 1px))`,
      fontSize: 300,
      fontWeight: 700,
      color: COLORS.ink,
    },
    card.character,
  );

  const details = el(
    'div',
    {
      position: 'absolute',
      left: SIDE_PADDING + GRID_SIZE + GAP,
      top: 0,
      bottom: 0,
      width: DETAILS_WIDTH,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 28,
    },
    [
      el(
        'div',
        { display: 'flex', fontSize: 52, fontWeight: 700, lineHeight: 1.15, color: COLORS.ink, lineClamp: 2 },
        meaning || card.character,
      ),
      el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, rows),
      el(
        'div',
        { display: 'flex', gap: 12 },
        badges.map((badge) =>
          el(
            'div',
            {
              display: 'flex',
              padding: '6px 18px',
              borderRadius: 999,
              border: `2px solid ${COLORS.grid}`,
              fontSize: 26,
              color: COLORS.muted,
            },
            badge,
          ),
        ),
      ),
    ],
  );

  return ogFrame([grid, details]);
}

/** The site's name in the bottom-right corner, as every share image signs it. */
function brandMark(): OgNode {
  return el(
    'div',
    {
      position: 'absolute',
      right: SIDE_PADDING,
      bottom: 44,
      display: 'flex',
      fontSize: 28,
      fontWeight: 700,
      color: COLORS.accent,
    },
    'Nadeshiko',
  );
}

/** A whole share image: the page-coloured 1200×630 frame around `children`, signed with the brand mark. */
function ogFrame(children: OgNode[]): OgNode {
  return el(
    'div',
    {
      position: 'relative',
      display: 'flex',
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundColor: COLORS.page,
      fontFamily: 'Noto Sans JP',
    },
    [...children, brandMark()],
  );
}

let fonts: Promise<Array<{ name: string; data: Buffer; weight: 400 | 700; style: 'normal' }>> | null = null;
let wasm: Promise<void> | null = null;

function loadFonts() {
  fonts ??= (async () => {
    const storage = useStorage('assets:server');
    const read = async (file: string) => {
      const raw = await storage.getItemRaw<Buffer | Uint8Array>(`fonts/${file}`);
      if (!raw) throw new Error(`OG font missing: ${file}`);
      return Buffer.from(raw);
    };
    return [
      {
        name: 'Noto Sans JP',
        data: await read('NotoSansJP-Regular-og.ttf'),
        weight: 400 as const,
        style: 'normal' as const,
      },
      {
        name: 'Noto Sans JP',
        data: await read('NotoSansJP-Bold-og.ttf'),
        weight: 700 as const,
        style: 'normal' as const,
      },
    ];
  })().catch((error: unknown) => {
    fonts = null;
    throw error;
  });
  return fonts;
}

function loadWasm() {
  wasm ??= (async () => {
    const path = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
    try {
      await initWasm(await readFile(path));
    } catch (error: unknown) {
      // A dev reload re-runs this module but the wasm instance lives on.
      if (!String((error as Error)?.message).includes('Already initialized')) throw error;
    }
  })().catch((error: unknown) => {
    wasm = null;
    throw error;
  });
  return wasm;
}

/** An image tree as PNG bytes. */
export async function renderOgTree(tree: OgNode): Promise<Uint8Array> {
  const [loadedFonts] = await Promise.all([loadFonts(), loadWasm()]);
  // satori's types want a React element; the tree is the same shape.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: loadedFonts,
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng();
}

/** A kanji page's share image as PNG bytes. */
export function renderKanjiOgImage(card: KanjiOgCard): Promise<Uint8Array> {
  return renderOgTree(kanjiOgTree(card));
}

// The kanji index's share images: one per group (`/og/kanji-index/jlpt-n3.png`). Labels are Japanese so one image
// serves every language, and every character they use is in the font.

/** A group's name on its image. */
export function kanjiIndexGroupLabel(id: string): string | null {
  if (/^n[1-5]$/.test(id)) return `JLPT ${id.toUpperCase()}`;
  if (/^g[1-6]$/.test(id)) return `小学${id.slice(1)}年`;
  if (id === 'none') return 'JLPTなし';
  if (id === 'secondary') return '中学以降';
  if (id === 'other') return 'その他';
  return null;
}

/** The group of `/og/kanji-index/<by>-<group>.png`, or null when there is no such image. */
export function kanjiIndexOgRequest(file: string | undefined): { by: 'jlpt' | 'grade'; level: string } | null {
  const match = /^(jlpt|grade)-([a-z0-9]+)\.png$/.exec(file ?? '');
  if (!match) return null;
  const by = match[1] as 'jlpt' | 'grade';
  const level = match[2] ?? '';
  const fits = by === 'jlpt' ? /^(n[1-5]|none)$/.test(level) : /^(g[1-6]|secondary|other)$/.test(level);
  return fits ? { by, level } : null;
}

const SAMPLE_SIZE = 10;

/** The index image: the group's name and size, and its first kanji as tiles. */
export function kanjiIndexOgTree(group: { id: string; kanji: string[] }): OgNode {
  const tile = (character: string) =>
    el(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 92,
        height: 92,
        borderRadius: 16,
        border: `2px solid ${COLORS.grid}`,
        backgroundColor: COLORS.card,
        fontSize: 56,
        fontWeight: 700,
        color: COLORS.ink,
      },
      character,
    );

  // Positioned, not padded: satori adds padding to the given width, which pushed the site name off the image.
  const content = el(
    'div',
    {
      position: 'absolute',
      left: SIDE_PADDING,
      top: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    },
    [
      el('div', { display: 'flex', fontSize: 34, fontWeight: 700, color: COLORS.faint }, '漢字'),
      el(
        'div',
        { display: 'flex', fontSize: 104, fontWeight: 700, lineHeight: 1.1, color: COLORS.ink },
        kanjiIndexGroupLabel(group.id) ?? group.id,
      ),
      el('div', { display: 'flex', marginTop: 8, fontSize: 40, color: COLORS.muted }, `${group.kanji.length} 字`),
      el('div', { display: 'flex', gap: 12, marginTop: 48 }, group.kanji.slice(0, SAMPLE_SIZE).map(tile)),
    ],
  );

  return ogFrame([content]);
}
